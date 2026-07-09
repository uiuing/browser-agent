import type { Bridge } from '../contracts/bridge';
import { CHANNEL_LOST_DURING_EXECUTE } from '../contracts/bridge';
import type { ActionOutcome } from '../contracts/action';
import type { PageSnapshot } from '../contracts/perception';
import type { PostCondition, Baseline } from '../contracts/verification';
import type { RunRecord, StepRecord, TraceEvent } from '../contracts/trace';
import type { AgentDecision, Decider, TurnSummary } from '../contracts/agent';
import type { OrchestratorDeps } from './types';
import { computeObservedDelta, renderObserved, looksLikeSuccessEffect } from './observe';
import { RunAborted } from './run';

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const nowIso = () => new Date().toISOString();

interface LoopOptions {
  runId?: string;
  signal?: AbortSignal;
  maxTurns?: number;
  onUpdate?: (run: RunRecord) => void;
}

/**
 * The closed-loop orchestrator — the product's primary mode for free-form tasks.
 *
 * observe (fresh snapshot + page signals) → the model decides ONE action →
 * execute → verify against the live DOM → feed the evidence back → repeat,
 * until the model declares done. A success declaration is only accepted after
 * its evidence conditions verify against the page.
 *
 * The model is the healer: failures aren't retried blindly — the next turn sees
 * exactly what failed (expected vs actual) on the CURRENT page and adapts.
 * Verification stays the engine's job; the model never grades its own work.
 */
export class AgentLoop {
  /** Last action whose observed delta looked like a durable success effect. */
  private lastEffect: { action: string; observed: string; warned: boolean } | null = null;

  constructor(
    private bridge: Bridge,
    private decider: Decider,
    private deps: OrchestratorDeps,
  ) {}

  private trace(runId: string, type: TraceEvent['type'], payload: Record<string, unknown>, stepId?: string): void {
    this.deps.trace.emit({ runId, type, payload, stepId });
  }

  async run(task: string, opts: LoopOptions = {}): Promise<RunRecord> {
    const runId = opts.runId ?? uid('run');
    const maxTurns = opts.maxTurns ?? 16;
    const hello = await this.bridge.call('hello');

    const run: RunRecord = {
      id: runId,
      kind: 'task',
      instruction: task,
      url: hello.url,
      title: '',
      startedAt: nowIso(),
      status: 'running',
      steps: [],
      verify: { passed: 0, failed: 0 },
    };
    const emit = () => opts.onUpdate?.(structuredClone(run));
    const checkAbort = () => {
      if (opts.signal?.aborted) throw new RunAborted('aborted');
    };

    this.trace(runId, 'run_started', { task, url: run.url, mode: 'loop' });
    emit();

    const history: TurnSummary[] = [];
    /** Evidence declared-done but failed → tell the model instead of looping silently. */
    let evidenceFeedback: string | null = null;
    /** Transient model-call failures (timeout / rate limit / network blip) must not
     *  kill the run — back off and re-ask. Only persistent failure ends it. */
    let deciderFailures = 0;

    try {
      for (let turn = 1; turn <= maxTurns; turn++) {
        checkAbort();
        await this.bridge.call('waitReady', { timeoutMs: 6000, quietMs: 300 });
        const snapshot = await this.bridge.call('snapshot', { maxNodes: 220 });
        run.title = snapshot.title;
        run.url = snapshot.url;

        if (evidenceFeedback) {
          history.push({ turn: turn - 1, thought: '(verifier)', note: evidenceFeedback });
          evidenceFeedback = null;
        }

        // Stagnation brake: a model that keeps issuing the same action isn't
        // converging — tell it so explicitly instead of letting it burn the budget.
        const acts = history.filter(h => h.action).map(h => h.action as string);
        const tail = acts.slice(-3);
        const lastNote = history[history.length - 1]?.note ?? '';
        if (tail.length === 3 && new Set(tail).size === 1 && !lastNote.startsWith('STAGNATION')) {
          history.push({
            turn: turn - 1,
            thought: '(system)',
            note: `STAGNATION: "${tail[0]}" has now been tried 3 times without achieving the goal. STOP repeating it. Either (a) the goal state may already be reached — declare done with evidence and let the engine verify; (b) try a genuinely different route (different element, press Enter in the filled input, dismiss an overlay); or (c) declare done with success=false and explain the blocker.`,
          });
        }

        let decision: AgentDecision;
        try {
          decision = await this.decider.decide({ task, snapshot, url: snapshot.url, history });
          deciderFailures = 0;
        } catch (e) {
          checkAbort();
          deciderFailures++;
          const msg = e instanceof Error ? e.message : String(e);
          this.trace(runId, 'note', { turn, deciderError: msg, failures: deciderFailures }, `t${turn}`);
          if (deciderFailures >= 3) {
            throw new Error(`Model unreachable after ${deciderFailures} attempts: ${msg}`);
          }
          await new Promise(r => setTimeout(r, 3000 * deciderFailures));
          continue; // page state is re-observed on the next iteration anyway
        }
        this.trace(runId, 'note', { turn, thought: decision.thought, done: decision.done }, `t${turn}`);

        if (decision.done) {
          const finished = await this.finishAttempt(run, decision, turn, history);
          if (finished) break;
          continue; // evidence failed → loop continues with feedback
        }

        if (!decision.action) {
          history.push({ turn, thought: decision.thought, note: 'INVALID: neither done nor action — decide again' });
          continue;
        }

        // Anti-duplicate arbitration by observed FACT: when the previous identical
        // action already produced a durable effect (row added / form reset clean),
        // re-firing it would duplicate the submission. Block once and say why.
        const actionDesc = describeAction(decision.action);
        if (this.lastEffect && this.lastEffect.action === actionDesc && !this.lastEffect.warned) {
          this.lastEffect.warned = true;
          history.push({
            turn,
            thought: decision.thought,
            action: actionDesc,
            note: `BLOCKED (once): this exact action already produced a durable effect last time — ${this.lastEffect.observed}. Re-firing it would duplicate the submission. Judge from the OBSERVED facts: if the goal is reached, declare done with evidence based on what is VISIBLE now; only repeat the action if you truly need a second submission.`,
          });
          continue;
        }

        await this.executeTurn(run, decision, snapshot, turn, history, checkAbort, emit);
        emit();
      }

      if (run.status === 'running') {
        run.status = 'failed';
        run.failure = { diagnosis: 'unknown', message: `Turn budget exhausted (${maxTurns}) without a verified finish` };
      }
    } catch (e) {
      if (e instanceof RunAborted) {
        run.status = 'cancelled';
      } else {
        run.status = 'failed';
        run.failure = { diagnosis: 'unknown', message: e instanceof Error ? e.message : String(e) };
      }
    } finally {
      await this.bridge.call('clearHighlight').catch(() => undefined);
    }

    run.finishedAt = nowIso();
    this.trace(runId, run.status === 'succeeded' ? 'run_completed' : 'run_failed', {
      status: run.status,
      passed: run.verify.passed,
      failed: run.verify.failed,
    });
    emit();
    return run;
  }

  /** Handle a done-declaration. Returns true when the run is finished. */
  private async finishAttempt(run: RunRecord, decision: AgentDecision, turn: number, history: TurnSummary[]): Promise<boolean> {
    if (decision.success === false) {
      run.status = 'failed';
      run.failure = { diagnosis: 'no_success_signal', message: decision.answer || decision.thought || 'Model declared failure' };
      run.finalAnswer = decision.answer;
      return true;
    }

    const evidence = decision.evidence.filter(c => c.kind !== 'list_count_delta'); // deltas need anchors; not valid as end-state proof
    if (evidence.length === 0) {
      history.push({
        turn,
        thought: decision.thought,
        note: 'REJECTED: success claimed without checkable evidence. Provide durable evidence (text_present/url_matches/value_equals/element_exists).',
      });
      return false;
    }

    const results = await this.bridge.call('verify', { conditions: evidence });
    results.forEach(r => (r.passed ? run.verify.passed++ : run.verify.failed++));
    this.trace(run.id, 'verify_result', { scope: 'final_evidence', results }, `t${turn}`);

    const failed = results.filter(r => !r.passed);
    if (failed.length === 0) {
      run.status = 'succeeded';
      run.finalAnswer = decision.answer;
      return true;
    }

    history.push({
      turn,
      thought: decision.thought,
      checks: failed.map(f => ({ kind: f.condition.kind, passed: false, expected: f.expected, actual: f.actual })),
      note: 'Success claim REJECTED by the page — evidence did not verify. Fix the task or declare failure honestly.',
    });
    return false;
  }

  /** Execute one acting turn: gate → baseline → act → observe → verify → reconcile. */
  private async executeTurn(
    run: RunRecord,
    decision: AgentDecision,
    beforeSnapshot: PageSnapshot,
    turn: number,
    history: TurnSummary[],
    checkAbort: () => void,
    emit: () => void,
  ): Promise<void> {
    const action = decision.action!;
    const stepId = `t${turn}`;
    const step = { id: stepId, intent: decision.thought || action.type, action, expect: decision.expect };
    const rec: StepRecord = {
      step,
      status: 'running',
      attempts: 1,
      healings: [],
      verifications: [],
      startedAt: nowIso(),
    };
    run.steps.push(rec);
    this.trace(run.id, 'step_started', { intent: step.intent, action: action.type, turn }, stepId);
    emit();

    const summary: TurnSummary = { turn, thought: decision.thought, action: describeAction(action) };

    // security gate
    const gate = this.deps.security?.check(action, run.url) ?? { allowed: true as const };
    if ('allowed' in gate && gate.allowed === false) {
      rec.status = 'failed';
      rec.finishedAt = nowIso();
      this.trace(run.id, 'security_blocked', { reason: gate.reason }, stepId);
      summary.note = `BLOCKED by policy: ${gate.reason}`;
      history.push(summary);
      return;
    }
    if ('needsConfirm' in gate && gate.needsConfirm) {
      this.trace(run.id, 'confirmation_required', { reason: gate.reason }, stepId);
      run.status = 'awaiting_confirmation';
      emit();
      const proceed = (await this.deps.confirmer?.confirm(step, gate.reason)) ?? true;
      run.status = 'running';
      this.trace(run.id, 'confirmation_resolved', { proceed }, stepId);
      emit();
      checkAbort();
      if (!proceed) {
        rec.status = 'skipped';
        rec.finishedAt = nowIso();
        summary.note = 'User declined the confirmation — choose a different way or declare failure.';
        history.push(summary);
        return;
      }
    }

    // highlight for observability (best effort)
    if ('target' in action && action.target?.fingerprint) {
      const g = await this.bridge.call('resolve', { fingerprint: action.target.fingerprint }).catch(() => null);
      if (g && g.nodeId !== null) {
        await this.bridge.call('highlight', { nodeId: g.nodeId, label: step.intent }).catch(() => undefined);
        this.trace(run.id, 'grounded', { confidence: g.confidence, nodeId: g.nodeId }, stepId);
      }
    }

    // pre-action anchors for delta expectations
    const baseline: Baseline | undefined = decision.expect.some(c => c.kind === 'list_count_delta')
      ? await this.bridge.call('baseline', { conditions: decision.expect })
      : undefined;

    let outcome: ActionOutcome;
    try {
      outcome = await this.bridge.call('execute', { action });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes(CHANNEL_LOST_DURING_EXECUTE)) throw e;
      // The action itself navigated the page (form submit unloading the document),
      // killing the reply channel AFTER the action fired. Not a failure — settle
      // the truth by verifying the post-conditions against the new document.
      outcome = { ok: true, durationMs: 0, channel: 'dom', readback: 'page navigated during action; verifying on the new document' };
      await this.bridge.call('waitReady', { timeoutMs: 8000, quietMs: 400 }).catch(() => undefined);
    }
    rec.outcome = outcome;
    this.trace(run.id, 'action_executed', { ok: outcome.ok, channel: outcome.channel, error: outcome.error, readback: outcome.readback }, stepId);
    summary.outcome = { ok: outcome.ok, error: outcome.error?.message };
    emit();

    const conditions: PostCondition[] = decision.expect;
    if (outcome.ok && conditions.length > 0) {
      const results = await this.bridge.call('verify', { conditions, baseline });
      rec.verifications = results;
      results.forEach(r => (r.passed ? run.verify.passed++ : run.verify.failed++));
      this.trace(run.id, 'verify_result', { results }, stepId);
      summary.checks = results.map(r => ({
        kind: r.condition.kind,
        passed: r.passed,
        expected: r.expected,
        actual: r.actual,
      }));
    }

    // Observation channel: measure what ACTUALLY changed, independent of the
    // model's predicted post-conditions. Predictions can be phrased wrong in both
    // directions; the diff is ground truth and it feeds the next decision.
    let effectLanded = false;
    if (outcome.ok) {
      const afterSnapshot = await this.bridge
        .call('snapshot', { maxNodes: 220 })
        .catch(() => null);
      if (afterSnapshot) {
        const delta = computeObservedDelta(beforeSnapshot, afterSnapshot);
        summary.observed = renderObserved(delta);
        this.trace(run.id, 'note', { turn, observed: summary.observed }, stepId);
        effectLanded = looksLikeSuccessEffect(delta);

        const checksFailed = rec.verifications.length > 0 && rec.verifications.some(v => !v.passed);
        if (checksFailed && effectLanded) {
          // Fact beats prediction: the page shows a durable effect, so the action
          // worked — the expectation was just phrased against the wrong signal.
          summary.note =
            'RECONCILE: your expected checks failed, but the OBSERVED facts show the action took durable effect. Trust OBSERVED. Do NOT redo the action — move on, or declare done with evidence matching what is actually visible.';
        } else if (!checksFailed && delta.quiet && action.type === 'click') {
          summary.note =
            'CAUTION: checks passed but the page did not observably change. The expectation may be too weak to prove the click did anything — prefer evidence based on visible page changes.';
        }
      }
    }

    const passed = outcome.ok && (rec.verifications.length === 0 || rec.verifications.every(v => v.passed));
    rec.status = passed ? 'succeeded' : 'failed';
    rec.finishedAt = nowIso();
    this.trace(run.id, passed ? 'step_completed' : 'step_failed', { turn }, stepId);

    // Remember durable effects for the anti-duplicate arbitration in the loop.
    this.lastEffect = effectLanded ? { action: summary.action ?? describeAction(action), observed: summary.observed ?? '', warned: false } : null;
    history.push(summary);
  }
}

function describeAction(action: { type: string } & Record<string, unknown>): string {
  const t = action as { type: string; target?: { fingerprint?: { name?: string } }; value?: string; keys?: string };
  const name = t.target?.fingerprint?.name ? ` "${t.target.fingerprint.name}"` : '';
  const value = t.value !== undefined ? ` = "${String(t.value).slice(0, 60)}"` : t.keys ? ` keys=${t.keys}` : '';
  return `${action.type}${name}${value}`;
}

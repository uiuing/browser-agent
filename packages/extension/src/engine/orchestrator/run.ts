import type { Bridge } from '../contracts/bridge';
import { CHANNEL_LOST_DURING_EXECUTE } from '../contracts/bridge';
import type { Plan, PlanStep } from '../contracts/plan';
import type { Action, ActionOutcome } from '../contracts/action';
import type { PostCondition, Baseline } from '../contracts/verification';
import type { RunRecord, StepRecord, TraceEvent } from '../contracts/trace';
import type { Planner, OrchestratorDeps, Budget } from './types';
import { DEFAULT_BUDGET } from './types';
import { diagnose, strategiesFor, isTerminal } from './healing';
import { defaultExpectations } from './expectations';

/** All list_count_delta conditions declared anywhere in a plan (steps + success criteria). */
function deltaConditions(plan: Plan): PostCondition[] {
  const out: PostCondition[] = [];
  for (const s of plan.steps) for (const c of s.expect) if (c.kind === 'list_count_delta') out.push(c);
  for (const c of plan.successCriteria ?? []) if (c.kind === 'list_count_delta') out.push(c);
  return out;
}

/**
 * Plan-time anchors win over step-time captures: a delta expresses "change since
 * the task started". An effect that lands earlier/later than the engine expected
 * still measures correctly, and no re-capture can ever double-count it.
 */
function mergeBaselines(planTime: Baseline | undefined, stepTime: Baseline): Baseline {
  return {
    url: stepTime.url,
    listCounts: { ...stepTime.listCounts, ...(planTime?.listCounts ?? {}) },
    groupCounts: { ...stepTime.groupCounts, ...(planTime?.groupCounts ?? {}) },
  };
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

interface RunOptions {
  runId?: string;
  kind?: RunRecord['kind'];
  batchId?: string;
  skillId?: string;
  signal?: AbortSignal;
  budget?: Partial<Budget>;
  onUpdate?: (run: RunRecord) => void;
  /** Pre-supplied plan (skill/batch path) bypasses the planner. */
  plan?: Plan;
}

export class RunAborted extends Error {}

/** Conditions that stay true once the effect landed — safe to re-check later. */
const DURABLE_KINDS = new Set([
  'list_count_delta',
  'text_present',
  'url_matches',
  'value_equals',
  'attribute_equals',
  'element_state',
]);

/**
 * The heart of the engine. Environment-agnostic: it only talks to a Bridge (page agent)
 * and a Planner (LLM or mock). Executes plan → verify → heal, streaming trace + run state.
 */
export class Orchestrator {
  /** Baselines captured right after planning, before any action mutated the page. */
  private planBaseline: Baseline | undefined;

  constructor(
    private bridge: Bridge,
    private planner: Planner,
    private deps: OrchestratorDeps,
  ) {}

  private trace(runId: string, type: TraceEvent['type'], payload: Record<string, unknown>, stepId?: string): void {
    this.deps.trace.emit({ runId, type, payload, stepId });
  }

  async run(task: string, opts: RunOptions = {}): Promise<RunRecord> {
    const budget = { ...DEFAULT_BUDGET, ...opts.budget };
    const runId = opts.runId ?? uid('run');
    const hello = await this.bridge.call('hello');
    const run: RunRecord = {
      id: runId,
      kind: opts.kind ?? 'task',
      instruction: task,
      skillId: opts.skillId,
      batchId: opts.batchId,
      url: hello.url,
      title: '',
      startedAt: nowIso(),
      status: 'planning',
      steps: [],
      verify: { passed: 0, failed: 0 },
    };
    const emit = () => opts.onUpdate?.(structuredClone(run));
    const checkAbort = () => {
      if (opts.signal?.aborted) throw new RunAborted('aborted');
    };

    this.trace(runId, 'run_started', { task, url: run.url });
    emit();

    try {
      checkAbort();
      await this.bridge.call('waitReady', { timeoutMs: 6000 });
      let plan = opts.plan;
      if (!plan) {
        const snapshot = await this.bridge.call('snapshot', { maxNodes: 220 });
        run.title = snapshot.title;
        plan = await this.planner.plan({ task, snapshot, url: run.url });
      }
      run.plan = plan;
      run.status = 'running';
      this.trace(runId, 'plan_created', { summary: plan.summary, steps: plan.steps.length });
      emit();

      // Anchor every delta condition NOW, before anything mutates the page.
      const deltas = deltaConditions(plan);
      this.planBaseline = deltas.length ? await this.bridge.call('baseline', { conditions: deltas }) : undefined;

      let healingUsed = 0;
      for (let i = 0; i < plan.steps.length; i++) {
        checkAbort();
        const step = plan.steps[i];
        const rec: StepRecord = {
          step,
          status: 'running',
          attempts: 0,
          healings: [],
          verifications: [],
          startedAt: nowIso(),
        };
        run.steps.push(rec);
        this.trace(runId, 'step_started', { intent: step.intent, action: step.action.type }, step.id);
        emit();

        const ok = await this.executeStepWithHealing(run, rec, step, budget, () => {
          healingUsed++;
          return healingUsed <= budget.runHealingBudget;
        }, emit, checkAbort);

        rec.finishedAt = nowIso();
        if (ok) {
          rec.status = 'succeeded';
          this.trace(runId, 'step_completed', {}, step.id);
        } else {
          rec.status = 'failed';
          const diagnosis = rec.healings[rec.healings.length - 1]?.diagnosis ?? 'unknown';
          run.status = 'failed';
          run.failure = { diagnosis, message: `Step ${i + 1} failed: ${step.intent}` };
          this.trace(runId, 'step_failed', { diagnosis }, step.id);
          emit();
          break;
        }
        emit();
      }

      if (run.status === 'running') {
        // final success criteria — the task is only done if these verify.
        // Delta criteria measure against the plan-time anchors.
        const criteria = plan.successCriteria ?? [];
        if (criteria.length > 0) {
          const results = await this.bridge.call('verify', { conditions: criteria, baseline: this.planBaseline });
          results.forEach(r => (r.passed ? run.verify.passed++ : run.verify.failed++));
          this.trace(runId, 'verify_result', { scope: 'success_criteria', results });
          const allPass = results.every(r => r.passed);
          run.status = allPass ? 'succeeded' : 'failed';
          if (!allPass) {
            run.failure = { diagnosis: 'no_success_signal', message: 'Success criteria not met' };
          }
        } else {
          run.status = 'succeeded';
        }
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

  private async executeStepWithHealing(
    run: RunRecord,
    rec: StepRecord,
    step: PlanStep,
    budget: Budget,
    healBudgetOk: () => boolean,
    emit: () => void,
    checkAbort: () => void,
  ): Promise<boolean> {
    let action: Action = step.action;
    let expectations: PostCondition[] = step.expect.length ? step.expect : defaultExpectations(step.action);
    /** Pre-effect baseline from the FIRST attempt — delta checks must not re-anchor
     *  on later attempts, or an effect that landed between attempts reads as delta 0. */
    let stepBaseline: Baseline | undefined;

    for (let attempt = 0; attempt <= budget.stepRetries; attempt++) {
      checkAbort();
      rec.attempts = attempt + 1;

      // Idempotency guard: if a previous attempt's effect already landed (slow
      // toast / late list render), do NOT act again — that's how agents
      // double-submit forms. Judge by the DURABLE conditions only; ephemeral
      // signals (a toast that faded) can't testify about the past.
      if (attempt > 0 && stepBaseline) {
        const durable = expectations.filter(c => DURABLE_KINDS.has(c.kind));
        if (durable.length > 0) {
          const already = await this.bridge.call('verify', { conditions: durable, baseline: stepBaseline });
          if (already.every(v => v.passed)) {
            rec.verifications = already;
            already.forEach(() => run.verify.passed++);
            this.trace(run.id, 'verify_result', { results: already, note: 'effect landed on earlier attempt' }, step.id);
            emit();
            return true;
          }
        }
      }

      // security gate
      const decision = this.deps.security?.check(action, run.url) ?? { allowed: true as const };
      if ('allowed' in decision && decision.allowed === false) {
        this.trace(run.id, 'security_blocked', { reason: decision.reason }, step.id);
        rec.healings.push({ diagnosis: 'policy_blocked', strategy: 'escalate_human', ok: false, note: decision.reason });
        return false;
      }
      if ('needsConfirm' in decision && decision.needsConfirm) {
        this.trace(run.id, 'confirmation_required', { reason: decision.reason }, step.id);
        run.status = 'awaiting_confirmation';
        emit();
        const proceed = (await this.deps.confirmer?.confirm(step, decision.reason)) ?? true;
        run.status = 'running';
        this.trace(run.id, 'confirmation_resolved', { proceed }, step.id);
        emit();
        if (!proceed) {
          rec.healings.push({ diagnosis: 'policy_blocked', strategy: 'escalate_human', ok: false, note: 'user declined' });
          return false;
        }
      }

      // smart wait before acting
      await this.bridge.call('waitReady', { timeoutMs: 5000, quietMs: 250 });

      // highlight target for observability
      if ('target' in action && action.target?.fingerprint) {
        const g = await this.bridge.call('resolve', { fingerprint: action.target.fingerprint });
        if (g.nodeId !== null) {
          await this.bridge.call('highlight', { nodeId: g.nodeId, label: step.intent }).catch(() => undefined);
          this.trace(run.id, 'grounded', { confidence: g.confidence, nodeId: g.nodeId }, step.id);
        }
      }

      // Baseline for delta conditions: captured before the first attempt acts,
      // with plan-time anchors taking precedence (see mergeBaselines).
      const baseline =
        stepBaseline ??
        mergeBaselines(this.planBaseline, await this.bridge.call('baseline', { conditions: expectations }));
      stepBaseline = baseline;

      // execute
      let outcome: ActionOutcome;
      try {
        outcome = await this.bridge.call('execute', { action });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes(CHANNEL_LOST_DURING_EXECUTE)) throw e;
        // The action navigated the page and the reply channel died after the action
        // fired. Verification against the new document settles what really happened.
        outcome = { ok: true, durationMs: 0, channel: 'dom', readback: 'page navigated during action; verifying on the new document' };
        await this.bridge.call('waitReady', { timeoutMs: 8000, quietMs: 400 }).catch(() => undefined);
      }
      rec.outcome = outcome;
      this.trace(run.id, 'action_executed', { ok: outcome.ok, channel: outcome.channel, error: outcome.error, readback: outcome.readback }, step.id);
      emit();

      // verify
      let verifications = outcome.ok || expectations.length > 0
        ? await this.bridge.call('verify', { conditions: expectations, baseline })
        : [];
      rec.verifications = verifications;
      verifications.forEach(v => (v.passed ? run.verify.passed++ : run.verify.failed++));
      this.trace(run.id, 'verify_result', { results: verifications }, step.id);
      emit();

      const passed = outcome.ok && verifications.every(v => v.passed);
      if (passed) return true;

      // heal
      const diagnosis = diagnose(outcome, verifications);
      if (isTerminal(diagnosis) || !healBudgetOk() || attempt >= budget.stepRetries) {
        rec.healings.push({ diagnosis, strategy: 'escalate_human', ok: false });
        this.trace(run.id, 'heal_result', { diagnosis, ok: false, terminal: true }, step.id);
        return false;
      }

      const strategies = strategiesFor(diagnosis);
      const strategy = strategies[Math.min(attempt, strategies.length - 1)];
      this.trace(run.id, 'heal_started', { diagnosis, strategy, attempt: attempt + 1 }, step.id);
      const healed = await this.applyStrategy(strategy, run, step, action, expectations);
      action = healed.action;
      if (healed.expectations !== expectations) stepBaseline = undefined; // replanned expectations → stale baseline
      expectations = healed.expectations;
      rec.healings.push({ diagnosis, strategy, ok: true, note: healed.note });
      this.trace(run.id, 'heal_result', { diagnosis, strategy, ok: true, note: healed.note }, step.id);
      emit();
    }
    return false;
  }

  private async applyStrategy(
    strategy: string,
    run: RunRecord,
    step: PlanStep,
    action: Action,
    expectations: PostCondition[],
  ): Promise<{ action: Action; expectations: PostCondition[]; note?: string }> {
    switch (strategy) {
      case 'smart_wait':
        await this.bridge.call('waitReady', { timeoutMs: 6000, quietMs: 400 });
        return { action, expectations, note: 'waited for readiness' };
      case 'probe_scroll': {
        const r = await this.bridge.call('probeScroll', { maxRounds: 4 });
        return { action, expectations, note: `probed scroll grew=${r.grew}` };
      }
      case 'scroll_into_view': {
        if ('target' in action && action.target) {
          await this.bridge.call('execute', { action: { type: 'scrollTo', target: action.target } });
        }
        return { action, expectations, note: 'scrolled target into view' };
      }
      case 'dismiss_overlay':
        await this.bridge.call('execute', { action: { type: 'press', keys: 'Escape' } });
        return { action, expectations, note: 'dismissed overlay via Escape' };
      case 'switch_channel': {
        // request the cdp channel next time (extension/bench decide capability)
        return { action, expectations, note: 'requested alternate execution channel' };
      }
      case 'switch_adapter_strategy':
        // adapter itself retries strategy internally; a re-execute after wait usually helps
        await this.bridge.call('waitReady', { timeoutMs: 3000, quietMs: 250 });
        return { action, expectations, note: 'retry with alternate input strategy' };
      case 'reground':
      case 'relax_grounding':
        // nothing to change on action; the page agent re-grounds by fingerprint on each execute
        await this.bridge.call('waitReady', { timeoutMs: 3000, quietMs: 250 });
        return { action, expectations, note: 're-grounding on fresh snapshot' };
      case 'retry_backoff':
        await new Promise(r => setTimeout(r, 400));
        return { action, expectations, note: 'backoff retry' };
      case 'replan': {
        const snapshot = await this.bridge.call('snapshot', { maxNodes: 220 });
        const plan = await this.planner.plan({
          task: step.intent,
          snapshot,
          url: run.url,
          failureContext: `Previous attempt for "${step.intent}" failed; re-derive this single step.`,
        });
        if (plan.steps[0]) {
          return { action: plan.steps[0].action, expectations: plan.steps[0].expect.length ? plan.steps[0].expect : expectations, note: 'replanned step' };
        }
        return { action, expectations, note: 'replan produced no step' };
      }
      default:
        return { action, expectations };
    }
  }
}

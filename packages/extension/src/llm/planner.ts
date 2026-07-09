import type { LLMProvider } from './contracts';
import type { Planner, PlanRequest } from '../engine/orchestrator/types';
import type { Plan } from '../engine/contracts/plan';
import { llmPlanSchema } from '../engine/contracts/plan';
import type { PageSnapshot } from '../engine/contracts/perception';
import { agentDecisionSchema, type AgentDecision, type DecideRequest, type Decider, type TurnSummary } from '../engine/contracts/agent';

const SYSTEM_PROMPT = `You are Browser Agent's planning engine. You drive a real web page via a structured action API.
You are given the user's TASK and a PAGE SNAPSHOT (a JSON semantic graph of the page: each node has id, role, name, componentType, value, attrs, anchors, path).

Produce a JSON plan with this exact shape:
{
  "summary": string,
  "steps": [{ "intent": string, "action": Action, "expect": PostCondition[], "risk"?: "safe"|"dangerous" }],
  "successCriteria": PostCondition[]
}

Action is one of:
- { "type":"fill", "target": Target, "value": string }        // text inputs / textareas
- { "type":"setValue", "target": Target, "value": string }     // selects, date pickers, cascaders, switches
- { "type":"click", "target": Target }
- { "type":"press", "keys": string, "target"?: Target }
- { "type":"uploadFile", "target": Target, "file": { "name": string, "mimeType": string, "contentText"?: string } }
- { "type":"scrollTo", "target"?: Target, "yPercent"?: number }
Target = { "fingerprint": { "role"?, "name"?, "tag"?, "componentType"?, "attrs"?, "anchors"?, "path"?, "framePath"? } }
Always identify targets by a fingerprint drawn from the snapshot node (prefer name + role + attrs.id/name/data-testid + path). Never invent a numeric index.

PostCondition (every step MUST prove itself) is one of:
- { "kind":"value_equals", "target": Target, "expected": string }
- { "kind":"element_exists", "fingerprint": Fingerprint }
- { "kind":"element_gone", "fingerprint": Fingerprint }
- { "kind":"url_matches", "pattern": string }
- { "kind":"text_present", "text": string, "within"?: Fingerprint }
- { "kind":"list_count_delta", "list": Fingerprint, "delta": number }
- { "kind":"element_state", "target": Target, "state": "checked"|"disabled"|"expanded"|"selected", "value": boolean }

Rules:
- Every fill/setValue step should expect value_equals on its own field.
- Exactly ONE step performs the submit/save click. Never plan a second "confirm"/"save again" step unless the snapshot actually shows a confirmation dialog element.
- That single submit step must be marked risk:"dangerous" and carry the success signals itself (toast via element_exists, and list_count_delta +1 when a list is present).
- Never plan pure "verify"/"check" steps — verification is expressed in "expect" and "successCriteria", not as actions.
- successCriteria should assert the durable end state (e.g. text_present of the created record).
- Respond with ONLY the JSON. No markdown, no commentary.`;

function snapshotDigest(snapshot: PageSnapshot): PageSnapshot {
  // Trim to the fields the planner needs, keep it compact.
  return {
    ...snapshot,
    nodes: snapshot.nodes.map(n => ({
      ...n,
      rect: { x: n.rect.x, y: n.rect.y, w: n.rect.w, h: n.rect.h },
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Closed-loop mode: one decision per turn against the CURRENT page.   */
/* ------------------------------------------------------------------ */

const AGENT_PROMPT = `You are Browser Agent, operating a real web page one step at a time, like a careful human.

Each turn you receive:
- TASK: what the user wants done.
- PAGE: current URL, title, scroll position, plus page signals — DIALOGS (modal asking something), ERRORS (validation complaints), TOASTS (recent feedback).
- NODES: the interactive/semantic elements of the WHOLE page (not just the viewport): id, role, name, value, componentType, states, attrs, path, anchors.
- HISTORY: your previous turns. Each line can carry two kinds of feedback — READ THEM DIFFERENTLY:
  · OBSERVED: measured page FACTS after your action (URL change, list count changes, new/removed text, toasts, dialogs, validation errors, form fields reset). This is ground truth from diffing the page — it is never wrong about what happened.
  · checks: your own predicted post-conditions evaluated against the DOM. A failed check with a positive OBSERVED usually means your prediction was phrased wrong, NOT that the action failed. Never conclude "the action failed" while OBSERVED shows the effect landed.

Respond with ONLY a JSON object (no markdown). Inside string values use single quotes for quoted phrases — write 'Alan Turing', never nested unescaped double quotes:
{
  "thought": "brief reasoning",
  "done": false,
  "action": { ... },                 // exactly ONE action this turn
  "expect": [ ... ]                  // post-conditions proving THIS action worked
}
or, when the task is fully achieved (or impossible):
{
  "thought": "...",
  "done": true,
  "success": true|false,
  "answer": "conclusion for the user (include extracted info if the task asked for it)",
  "evidence": [ ... ]                // when success: durable checks proving the END STATE
}

Action — the "type" must be EXACTLY one of these (no other type exists; waiting and verifying happen automatically):
- { "type":"fill", "target": T, "value": string }         // text inputs / textareas
- { "type":"setValue", "target": T, "value": string }      // selects, datepickers, cascaders, switches
- { "type":"click", "target": T }
- { "type":"press", "keys": "Enter", "target"?: T }
- { "type":"navigate", "url": string }                     // go straight to a URL when that IS the task
- { "type":"uploadFile", "target": T, "file": { "name": string, "mimeType": string, "contentText"?: string } }
- { "type":"scrollTo", "target"?: T, "yPercent"?: number }
T = { "fingerprint": { "role"?, "name"?, "tag"?, "componentType"?, "attrs"?, "anchors"?, "path"?, "framePath"? } }
Copy fingerprint fields from a NODES entry (prefer name + role + attrs.id/name/data-testid + path). Never invent ids or selectors.

PostCondition kinds:
- { "kind":"value_equals", "target": T, "expected": string }
- { "kind":"element_exists", "fingerprint": F } / { "kind":"element_gone", "fingerprint": F }
- { "kind":"url_matches", "pattern": string }
- { "kind":"text_present", "text": string, "within"?: F } / { "kind":"text_absent", "text": string }
- { "kind":"list_count_delta", "list": F, "delta": number }
- { "kind":"element_state", "target": T, "state": "checked"|"disabled"|"expanded"|"selected", "value": boolean }

Rules:
- ONE action per turn. After a fill/setValue, expect value_equals on that field.
- Write "expect" as the MINIMAL check that proves the action itself worked. Do not predict grand outcomes there — deeper verification happens via OBSERVED facts and your final evidence. For a submit click, ONE list_count_delta or ONE text_present of the key value is enough.
- Submitting usually RESETS the form and prepends the record to a list — expecting field values to persist after submit is a wrong prediction.
- To submit a search box or a simple form, pressing Enter inside the filled input ({ "type":"press", "keys":"Enter", "target": <the input> }) is usually more reliable than hunting for the button.
- READ the page signals: a DIALOG must be answered before anything else; ERRORS explain what to fix; a TOAST often confirms your last action.
- After an action, FIRST read OBSERVED on the previous history line. If it shows the effect landed (count grew, record text appeared, URL moved), the job of that action is DONE — never re-submit; a duplicate submission corrupts user data.
- If HISTORY shows the same approach failed twice, change it: different element, scrollTo it first, dismiss the dialog, or press Escape. Do not repeat a failing action verbatim.
- To CONFIRM or CHECK something, do NOT click around — declare done with evidence; the engine verifies it against the DOM. If HISTORY already shows the goal state (e.g. url_matches passed, the text is present), finish now.
- url_matches "pattern" is a substring or regular expression of the URL (no surrounding slashes needed).
- The page may have navigated — always ground your next action in the CURRENT nodes, not remembered ones.
- "evidence" must be durable state (text_present / url_matches / value_equals / element_exists). No toasts — they fade. Avoid list_count_delta in evidence.
- Build evidence from what is VISIBLE: pick short distinctive texts you can see in NODES or OBSERVED (the record's name, an id) — one value per condition. NEVER concatenate several field values into one text_present string; that never matches the DOM.
- Login walls, captchas, 2FA: done=true, success=false, answer explains what the user must do — never try to bypass.
- If the task asks a question / extraction, put the answer text in "answer" and back it with text_present evidence.`;

function turnLine(t: TurnSummary): string {
  const parts = [`#${t.turn} ${t.thought || '(no thought)'}`];
  if (t.action) parts.push(`action=${t.action}`);
  if (t.outcome) parts.push(t.outcome.ok ? 'executed' : `EXEC_FAILED: ${t.outcome.error ?? 'unknown'}`);
  if (t.observed) parts.push(`OBSERVED: ${t.observed}`);
  if (t.checks?.length) {
    parts.push(
      'checks: ' +
        t.checks.map(c => `${c.kind}${c.passed ? '✓' : `✗(expected ${c.expected}; actual ${c.actual})`}`).join(', '),
    );
  }
  if (t.note) parts.push(t.note);
  return parts.join(' | ');
}

/**
 * The one planner used for BOTH real and mock providers. It builds the prompt,
 * asks for structured output (validated by llmPlanSchema — identical for every
 * provider), and normalizes to a Plan with stable step ids.
 *
 * It also implements the closed-loop Decider contract: one decision per turn
 * against the current page, with full history fed back — the mode the product
 * uses for free-form tasks on real websites.
 */
export class LLMPlanner implements Planner, Decider {
  readonly id: string;
  constructor(private provider: LLMProvider) {
    this.id = `planner:${provider.id}`;
  }

  async decide(req: DecideRequest): Promise<AgentDecision> {
    const s = req.snapshot;
    const meta = [
      `URL: ${s.url}`,
      `TITLE: ${s.title}`,
      `SCROLL: ${s.scrollY}/${s.scrollHeight} (viewport ${s.viewportH})`,
      s.dialogs.length ? `DIALOGS: ${JSON.stringify(s.dialogs)}` : '',
      s.errors.length ? `ERRORS: ${JSON.stringify(s.errors)}` : '',
      s.toasts.length ? `TOASTS: ${JSON.stringify(s.toasts)}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const history = req.history.length
      ? `HISTORY (oldest→latest):\n${req.history.map(turnLine).join('\n')}`
      : 'HISTORY: (first turn)';

    const user = [
      `TASK: ${req.task}`,
      history,
      `PAGE:\n${meta}`,
      `NODES (JSON):\n${JSON.stringify(snapshotDigest(s).nodes)}`,
    ].join('\n\n');

    return this.provider.structuredOutput(
      agentDecisionSchema,
      [
        { role: 'system', content: AGENT_PROMPT },
        { role: 'user', content: user },
      ],
      // Generous timeout + retries: relayed/aggregator endpoints routinely take
      // >60s under load, and a lost turn costs more than the extra wait.
      { schemaName: 'AgentDecision', temperature: 0, repairAttempts: 2, timeoutMs: 90000, retries: 2 },
    );
  }

  async plan(req: PlanRequest): Promise<Plan> {
    const user = [
      `TASK: ${req.task}`,
      req.failureContext ? `NOTE: ${req.failureContext}` : '',
      `PAGE SNAPSHOT (JSON):`,
      JSON.stringify(snapshotDigest(req.snapshot)),
    ]
      .filter(Boolean)
      .join('\n\n');

    const llmPlan = await this.provider.structuredOutput(
      llmPlanSchema,
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: user },
      ],
      { schemaName: 'Plan', temperature: 0, repairAttempts: 2 },
    );

    return {
      summary: llmPlan.summary || req.task,
      steps: llmPlan.steps.map((s, i) => ({
        id: `s${i + 1}`,
        intent: s.intent,
        action: s.action,
        expect: s.expect,
        risk: s.risk,
      })),
      successCriteria: llmPlan.successCriteria,
    };
  }
}

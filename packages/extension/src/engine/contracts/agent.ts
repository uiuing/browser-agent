import { z } from 'zod';
import { actionSchema } from './action';
import { postConditionSchema } from './verification';
import type { PageSnapshot } from './perception';

/**
 * Closed-loop agent contract. Each turn the model sees the CURRENT page (fresh
 * snapshot + browser state + what happened so far) and returns exactly one
 * decision: act, or declare the task done with checkable evidence.
 */
/** Models routinely emit explicit nulls for omitted fields ("action": null) — accept them. */
const orUndefined = (v: unknown): unknown => v ?? undefined;
const orEmpty = (v: unknown): unknown => v ?? [];

export const agentDecisionSchema = z.object({
  /** Model's reasoning for this turn (shown in the run timeline). */
  thought: z.preprocess(orUndefined, z.string().default('')),
  /** True when the task is finished (successfully or not). */
  done: z.preprocess(orUndefined, z.boolean().default(false)),
  /** Only meaningful when done: did the task succeed? */
  success: z.preprocess(orUndefined, z.boolean().optional()),
  /** Only when done: user-facing conclusion / extracted answer. */
  answer: z.preprocess(orUndefined, z.string().optional()),
  /** The single action to perform this turn (required when not done). */
  action: z.preprocess(orUndefined, actionSchema.optional()),
  /** Post-conditions proving THIS action took effect. */
  expect: z.preprocess(orEmpty, z.array(postConditionSchema).default([])),
  /** Only when done && success: durable checks proving the END STATE. */
  evidence: z.preprocess(orEmpty, z.array(postConditionSchema).default([])),
});
export type AgentDecision = z.infer<typeof agentDecisionSchema>;

/** Compact record of a past turn, fed back to the model as history. */
export interface TurnSummary {
  turn: number;
  thought: string;
  action?: string;
  outcome?: { ok: boolean; error?: string };
  checks?: Array<{ kind: string; passed: boolean; expected: string; actual: string }>;
  /** Page FACTS measured by diffing snapshots around the action — not a prediction. */
  observed?: string;
  note?: string;
}

export interface DecideRequest {
  task: string;
  snapshot: PageSnapshot;
  url: string;
  history: TurnSummary[];
}

export interface Decider {
  readonly id: string;
  decide(req: DecideRequest): Promise<AgentDecision>;
}

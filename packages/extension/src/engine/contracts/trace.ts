import { z } from 'zod';
import { planStepSchema, planSchema } from './plan';
import { actionOutcomeSchema } from './action';
import { verificationResultSchema } from './verification';

export const diagnosisSchema = z.enum([
  'element_not_found',
  'occluded',
  'value_not_applied',
  'no_success_signal',
  'timeout_flaky',
  'blocked_by_challenge',
  'policy_blocked',
  'unknown',
]);
export type Diagnosis = z.infer<typeof diagnosisSchema>;

export const healStrategySchema = z.enum([
  'smart_wait',
  'reground',
  'relax_grounding',
  'scroll_into_view',
  'probe_scroll',
  'dismiss_overlay',
  'switch_adapter_strategy',
  'switch_channel',
  'retry_backoff',
  'replan',
  'isolate_row',
  'escalate_human',
]);
export type HealStrategy = z.infer<typeof healStrategySchema>;

export const healingAttemptSchema = z.object({
  diagnosis: diagnosisSchema,
  strategy: healStrategySchema,
  ok: z.boolean(),
  note: z.string().optional(),
});
export type HealingAttempt = z.infer<typeof healingAttemptSchema>;

export const stepStatusSchema = z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped']);
export type StepStatus = z.infer<typeof stepStatusSchema>;

export const stepRecordSchema = z.object({
  step: planStepSchema,
  status: stepStatusSchema,
  attempts: z.number().int(),
  healings: z.array(healingAttemptSchema),
  verifications: z.array(verificationResultSchema),
  outcome: actionOutcomeSchema.optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
});
export type StepRecord = z.infer<typeof stepRecordSchema>;

export const runStatusSchema = z.enum([
  'planning',
  'running',
  'awaiting_confirmation',
  'succeeded',
  'failed',
  'cancelled',
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const runRecordSchema = z.object({
  id: z.string(),
  kind: z.enum(['task', 'skill', 'batch-row']),
  instruction: z.string().optional(),
  skillId: z.string().optional(),
  batchId: z.string().optional(),
  /** Chat provenance: which session/tool call spawned this run (page.act, skills.run). */
  sessionId: z.string().optional(),
  toolCallId: z.string().optional(),
  url: z.string(),
  title: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  status: runStatusSchema,
  plan: planSchema.optional(),
  steps: z.array(stepRecordSchema),
  verify: z.object({ passed: z.number().int(), failed: z.number().int() }),
  failure: z.object({ diagnosis: diagnosisSchema, message: z.string() }).optional(),
  finalAnswer: z.string().optional(),
});
export type RunRecord = z.infer<typeof runRecordSchema>;

export const traceEventTypeSchema = z.enum([
  'run_started',
  'plan_created',
  'step_started',
  'grounded',
  'action_executed',
  'verify_result',
  'heal_started',
  'heal_result',
  'step_completed',
  'step_failed',
  'confirmation_required',
  'confirmation_resolved',
  'security_blocked',
  'run_completed',
  'run_failed',
  'note',
]);
export type TraceEventType = z.infer<typeof traceEventTypeSchema>;

export const traceEventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  seq: z.number().int(),
  ts: z.string(),
  type: traceEventTypeSchema,
  stepId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()),
});
export type TraceEvent = z.infer<typeof traceEventSchema>;

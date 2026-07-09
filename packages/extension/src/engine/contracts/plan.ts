import { z } from 'zod';
import { actionSchema } from './action';
import { postConditionSchema } from './verification';

export const riskSchema = z.enum(['safe', 'dangerous']);
export type Risk = z.infer<typeof riskSchema>;

export const planStepSchema = z.object({
  id: z.string(),
  intent: z.string(),
  action: actionSchema,
  expect: z.array(postConditionSchema),
  risk: riskSchema.optional(),
});
export type PlanStep = z.infer<typeof planStepSchema>;

export const planSchema = z.object({
  steps: z.array(planStepSchema),
  successCriteria: z.array(postConditionSchema),
  summary: z.string(),
});
export type Plan = z.infer<typeof planSchema>;

/**
 * The compact shape an LLM must return. We keep it flat and forgiving, then
 * normalize + validate against planStepSchema. This is what providers (incl. mock)
 * are asked to produce and what the robust parser validates.
 */
export const llmPlanStepSchema = z.object({
  intent: z.string(),
  action: actionSchema,
  expect: z.array(postConditionSchema).default([]),
  risk: riskSchema.optional(),
});
export const llmPlanSchema = z.object({
  summary: z.string().default(''),
  steps: z.array(llmPlanStepSchema),
  successCriteria: z.array(postConditionSchema).default([]),
});
export type LlmPlan = z.infer<typeof llmPlanSchema>;

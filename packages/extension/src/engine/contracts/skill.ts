import { z } from 'zod';
import { planStepSchema } from './plan';
import { postConditionSchema } from './verification';

export const slotTypeSchema = z.enum(['text', 'number', 'date', 'select', 'file']);
export type SlotType = z.infer<typeof slotTypeSchema>;

export const slotDefSchema = z.object({
  name: z.string(),
  label: z.string(),
  type: slotTypeSchema,
  required: z.boolean(),
  sensitive: z.boolean().optional(),
  example: z.string().optional(),
});
export type SlotDef = z.infer<typeof slotDefSchema>;

export const skillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string().optional(),
  urlPattern: z.string(),
  slots: z.array(slotDefSchema),
  steps: z.array(planStepSchema),
  successCriteria: z.array(postConditionSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastRunAt: z.string().optional(),
  runCount: z.number().int(),
  version: z.literal(1),
});
export type Skill = z.infer<typeof skillSchema>;

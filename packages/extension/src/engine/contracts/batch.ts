import { z } from 'zod';
import { diagnosisSchema } from './trace';

export const batchRowStatusSchema = z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped']);
export type BatchRowStatus = z.infer<typeof batchRowStatusSchema>;

export const batchRowSchema = z.object({
  index: z.number().int(),
  data: z.record(z.string(), z.string()),
  status: batchRowStatusSchema,
  runId: z.string().optional(),
  attempts: z.number().int(),
  error: z
    .object({
      diagnosis: diagnosisSchema,
      message: z.string(),
    })
    .optional(),
});
export type BatchRow = z.infer<typeof batchRowSchema>;

export const batchStatusSchema = z.enum(['draft', 'running', 'paused', 'completed', 'cancelled']);
export type BatchStatus = z.infer<typeof batchStatusSchema>;

export const batchRunSchema = z.object({
  id: z.string(),
  skillId: z.string(),
  name: z.string(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  status: batchStatusSchema,
  cursor: z.number().int(),
  rows: z.array(batchRowSchema),
  stats: z.object({
    total: z.number().int(),
    succeeded: z.number().int(),
    failed: z.number().int(),
    skipped: z.number().int(),
    pending: z.number().int(),
  }),
});
export type BatchRun = z.infer<typeof batchRunSchema>;

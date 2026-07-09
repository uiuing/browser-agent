import { z } from 'zod';
import { targetRefSchema } from './grounding';

export const uploadFileSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  contentText: z.string().optional(),
  contentBase64: z.string().optional(),
});
export type UploadFile = z.infer<typeof uploadFileSchema>;

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('navigate'), url: z.string() }),
  z.object({ type: z.literal('click'), target: targetRefSchema }),
  z.object({
    type: z.literal('fill'),
    target: targetRefSchema,
    value: z.string(),
    sensitive: z.boolean().optional(),
  }),
  z.object({ type: z.literal('setValue'), target: targetRefSchema, value: z.string() }),
  z.object({ type: z.literal('uploadFile'), target: targetRefSchema, file: uploadFileSchema }),
  z.object({ type: z.literal('hover'), target: targetRefSchema }),
  z.object({ type: z.literal('press'), keys: z.string(), target: targetRefSchema.optional() }),
  z.object({
    type: z.literal('scrollTo'),
    target: targetRefSchema.optional(),
    yPercent: z.number().optional(),
  }),
  z.object({ type: z.literal('extract'), target: targetRefSchema.optional(), attr: z.string().optional() }),
]);
export type Action = z.infer<typeof actionSchema>;

export const actionErrorCodeSchema = z.enum([
  'element_not_found',
  'occluded',
  'value_not_applied',
  'not_interactable',
  'timeout',
  'channel_error',
  'blocked_by_policy',
  'unsupported',
]);
export type ActionErrorCode = z.infer<typeof actionErrorCodeSchema>;

export const channelSchema = z.enum(['dom', 'cdp']);
export type Channel = z.infer<typeof channelSchema>;

export const actionOutcomeSchema = z.object({
  ok: z.boolean(),
  error: z
    .object({
      code: actionErrorCodeSchema,
      message: z.string(),
    })
    .optional(),
  readback: z.string().optional(),
  durationMs: z.number(),
  channel: channelSchema,
});
export type ActionOutcome = z.infer<typeof actionOutcomeSchema>;

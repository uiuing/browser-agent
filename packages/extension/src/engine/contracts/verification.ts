import { z } from 'zod';
import { targetRefSchema, semanticFingerprintSchema } from './grounding';

export const postConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('value_equals'), target: targetRefSchema, expected: z.string() }),
  z.object({ kind: z.literal('element_exists'), fingerprint: semanticFingerprintSchema }),
  z.object({ kind: z.literal('element_gone'), fingerprint: semanticFingerprintSchema }),
  z.object({ kind: z.literal('url_matches'), pattern: z.string() }),
  z.object({ kind: z.literal('text_present'), text: z.string(), within: semanticFingerprintSchema.optional() }),
  z.object({ kind: z.literal('text_absent'), text: z.string(), within: semanticFingerprintSchema.optional() }),
  z.object({ kind: z.literal('list_count_delta'), list: semanticFingerprintSchema, delta: z.number().int() }),
  z.object({ kind: z.literal('attribute_equals'), target: targetRefSchema, attr: z.string(), expected: z.string() }),
  z.object({
    kind: z.literal('element_state'),
    target: targetRefSchema,
    state: z.enum(['checked', 'disabled', 'expanded', 'selected']),
    value: z.boolean(),
  }),
]);
export type PostCondition = z.infer<typeof postConditionSchema>;

export const verificationResultSchema = z.object({
  condition: postConditionSchema,
  passed: z.boolean(),
  expected: z.string(),
  actual: z.string(),
  evidence: z.string().optional(),
  durationMs: z.number(),
});
export type VerificationResult = z.infer<typeof verificationResultSchema>;

export const baselineSchema = z.object({
  listCounts: z.record(z.string(), z.number()),
  url: z.string(),
  /**
   * Page-wide repeated-element group counts at baseline time (data-testid /
   * role groups). The second pair of eyes for list_count_delta: when the
   * planner's list fingerprint never grounds (counts 0), the delta is judged
   * against these page-truth groups instead of failing on a bad prediction.
   */
  groupCounts: z.record(z.string(), z.number()).default({}),
});
export type Baseline = z.infer<typeof baselineSchema>;

import { z } from 'zod';
import { componentTypeSchema } from './perception';

export const semanticFingerprintSchema = z.object({
  role: z.string().optional(),
  name: z.string().optional(),
  tag: z.string().optional(),
  attrs: z.record(z.string(), z.string()).optional(),
  path: z.string().optional(),
  anchors: z.array(z.string()).optional(),
  componentType: componentTypeSchema.optional(),
  framePath: z.string().optional(),
});
export type SemanticFingerprint = z.infer<typeof semanticFingerprintSchema>;

export const targetRefSchema = z
  .object({
    nodeId: z.number().int().optional(),
    fingerprint: semanticFingerprintSchema.optional(),
  })
  .refine(v => v.nodeId !== undefined || v.fingerprint !== undefined, {
    message: 'TargetRef requires nodeId or fingerprint',
  });
export type TargetRef = z.infer<typeof targetRefSchema>;

export const groundingCandidateSchema = z.object({
  nodeId: z.number().int(),
  score: z.number(),
  name: z.string(),
});
export const groundingResultSchema = z.object({
  nodeId: z.number().int().nullable(),
  confidence: z.number(),
  candidates: z.array(groundingCandidateSchema),
});
export type GroundingResult = z.infer<typeof groundingResultSchema>;

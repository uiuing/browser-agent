import { z } from 'zod';

/**
 * Chat session contracts — the harness's conversational spine.
 *
 * A session is a flat list of turns. A user turn is plain text; an assistant
 * turn is an ordered list of parts (streamed text interleaved with tool calls),
 * mirroring how every provider's tool-calling wire format actually behaves.
 * Everything here is pure data: sessions are persisted as-is and replayed
 * into provider messages on the next turn.
 */

export const toolCallStatusSchema = z.enum([
  'pending',
  'awaiting_confirmation',
  'running',
  'succeeded',
  'failed',
  'denied',
]);
export type ToolCallStatus = z.infer<typeof toolCallStatusSchema>;

/**
 * What a tool hands back to the loop. `summary` is the model-facing text —
 * for page_act it must carry the verification verdict (evidence, not claims).
 */
export const toolResultSchema = z.object({
  ok: z.boolean(),
  /** Fed back to the model as the tool message content. */
  summary: z.string(),
  /** Small structured payload for UI rendering (kept out of the model prompt). */
  data: z.unknown().optional(),
  /** Links the call to a persisted RunRecord (page_act / skills_run). */
  runId: z.string().optional(),
  error: z.string().optional(),
});
export type ToolResult = z.infer<typeof toolResultSchema>;

export const toolCallRecordSchema = z.object({
  /** Provider-issued tool_call id (or locally generated for prompted-JSON fallback). */
  id: z.string(),
  toolId: z.string(),
  /** Raw arguments as parsed from the model (validated by the registry before execution). */
  params: z.unknown(),
  status: toolCallStatusSchema,
  result: toolResultSchema.optional(),
  /** Duplicated from result for quick lookup in lists. */
  runId: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
});
export type ToolCallRecord = z.infer<typeof toolCallRecordSchema>;

export const assistantPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('tool'), call: toolCallRecordSchema }),
]);
export type AssistantPart = z.infer<typeof assistantPartSchema>;

export const chatMessageSchema = z.discriminatedUnion('role', [
  z.object({
    role: z.literal('user'),
    id: z.string(),
    text: z.string(),
    at: z.string(),
  }),
  z.object({
    role: z.literal('assistant'),
    id: z.string(),
    parts: z.array(assistantPartSchema),
    at: z.string(),
    /** Set when the turn aborted (model error, budget, user stop) — shown inline. */
    error: z.string().optional(),
  }),
]);
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type UserMessage = Extract<ChatMessage, { role: 'user' }>;
export type AssistantMessage = Extract<ChatMessage, { role: 'assistant' }>;

export const chatSessionSchema = z.object({
  id: z.string(),
  /** First user utterance, trimmed — good enough as a title. */
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messages: z.array(chatMessageSchema),
});
export type ChatSession = z.infer<typeof chatSessionSchema>;

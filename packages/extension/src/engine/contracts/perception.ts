import { z } from 'zod';

export const componentTypeSchema = z.enum([
  'native-input',
  'native-select',
  'custom-select',
  'datepicker',
  'cascader',
  'multiselect',
  'checkbox',
  'radio',
  'switch',
  'button',
  'link',
  'textarea',
  'contenteditable',
  'file-upload',
  'listitem',
  'generic',
]);
export type ComponentType = z.infer<typeof componentTypeSchema>;

export const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});
export type Rect = z.infer<typeof rectSchema>;

export const semanticNodeSchema = z.object({
  id: z.number().int(),
  tag: z.string(),
  role: z.string(),
  name: z.string(),
  value: z.string().optional(),
  states: z.array(z.string()),
  componentType: componentTypeSchema,
  interactive: z.number().min(0).max(1),
  visible: z.boolean(),
  inViewport: z.boolean(),
  occluded: z.boolean(),
  rect: rectSchema,
  attrs: z.record(z.string(), z.string()),
  path: z.string(),
  anchors: z.array(z.string()),
  framePath: z.string(),
});
export type SemanticNode = z.infer<typeof semanticNodeSchema>;

export const pageSnapshotSchema = z.object({
  url: z.string(),
  title: z.string(),
  at: z.string(),
  scrollY: z.number(),
  scrollHeight: z.number(),
  viewportH: z.number(),
  /** Visible modal/dialog texts — the page is asking for something. */
  dialogs: z.array(z.string()).default([]),
  /** Visible validation/error texts — the page is complaining. */
  errors: z.array(z.string()).default([]),
  /** Visible toast/notification texts — ephemeral feedback right now. */
  toasts: z.array(z.string()).default([]),
  /**
   * Counts of repeated-element groups (list rows etc.) measured over the FULL
   * walk, BEFORE any maxNodes truncation — snapshot diffing needs exact counts
   * even when the node list itself is capped.
   */
  groupCounts: z.record(z.string(), z.number()).default({}),
  nodes: z.array(semanticNodeSchema),
});
export type PageSnapshot = z.infer<typeof pageSnapshotSchema>;

export const readyReportSchema = z.object({
  readyState: z.string(),
  pendingRequests: z.number(),
  quietMs: z.number(),
  waitedMs: z.number(),
  timedOut: z.boolean(),
});
export type ReadyReport = z.infer<typeof readyReportSchema>;

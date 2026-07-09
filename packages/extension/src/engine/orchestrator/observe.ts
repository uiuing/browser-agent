import type { PageSnapshot, SemanticNode } from '../contracts/perception';

/**
 * The observation channel — what ACTUALLY changed on the page after an action.
 *
 * Model-declared post-conditions are predictions; predictions can be wrong in both
 * directions (action worked but the expectation was phrased wrong / expectation
 * accidentally matches but the action did nothing). Diffing the pre-action snapshot
 * against a post-action snapshot produces facts that don't depend on the model
 * guessing right, and those facts are fed back into the next turn. Verification
 * still runs — but the loop reconciles it against observed reality.
 */
export interface ObservedDelta {
  urlChanged: boolean;
  url?: { from: string; to: string };
  /** New toast/dialog/error texts that appeared after the action. */
  newToasts: string[];
  newDialogs: string[];
  newErrors: string[];
  /** Repeated-element groups whose count changed (e.g. list rows). */
  listDeltas: Array<{ key: string; before: number; after: number }>;
  /** Node names newly present on the page (top N, deduped). */
  newTexts: string[];
  /** Form fields that HAD a value before and are now empty (typical post-submit reset). */
  clearedFields: string[];
  /** Field value changes (name: from → to). */
  changedValues: Array<{ name: string; from: string; to: string }>;
  /** True when nothing observable changed at all. */
  quiet: boolean;
}

const FORM_TYPES = new Set(['native-input', 'textarea', 'native-select', 'custom-select', 'datepicker', 'cascader', 'multiselect', 'contenteditable']);

/**
 * Repeated-element group counts. Prefer the snapshot's own pre-truncation
 * `groupCounts`; fall back to counting nodes for older snapshots.
 */
function countGroups(s: PageSnapshot): Map<string, number> {
  if (s.groupCounts && Object.keys(s.groupCounts).length > 0) {
    return new Map(Object.entries(s.groupCounts));
  }
  const m = new Map<string, number>();
  for (const n of s.nodes) {
    const tid = n.attrs['data-testid'] ?? n.attrs['data-test'] ?? n.attrs['data-role'];
    const key = tid ? `[data-testid="${tid}"]` : n.role === 'listitem' || n.role === 'row' ? `role=${n.role}` : null;
    if (key) m.set(key, (m.get(key) ?? 0) + 1);
  }
  return m;
}

/** Stable identity for matching the same field across two snapshots. */
function fieldKey(n: SemanticNode): string {
  return `${n.attrs['data-testid'] ?? ''}|${n.attrs.id ?? ''}|${n.attrs.name ?? ''}|${n.path}`;
}

function added(before: string[], after: string[]): string[] {
  const seen = new Set(before);
  return after.filter(t => t && !seen.has(t));
}

export function computeObservedDelta(before: PageSnapshot, after: PageSnapshot): ObservedDelta {
  const urlChanged = before.url !== after.url;

  const listDeltas: ObservedDelta['listDeltas'] = [];
  const cb = countGroups(before);
  const ca = countGroups(after);
  for (const [key, a] of ca) {
    const b = cb.get(key) ?? 0;
    if (a !== b) listDeltas.push({ key, before: b, after: a });
  }
  for (const [key, b] of cb) {
    if (!ca.has(key)) listDeltas.push({ key, before: b, after: 0 });
  }

  const beforeNames = new Set(before.nodes.map(n => n.name).filter(Boolean));
  const newTexts = [...new Set(after.nodes.map(n => n.name).filter(t => t.length >= 2 && !beforeNames.has(t)))].slice(0, 8);

  const clearedFields: string[] = [];
  const changedValues: ObservedDelta['changedValues'] = [];
  if (!urlChanged) {
    const beforeFields = new Map<string, SemanticNode>();
    for (const n of before.nodes) if (FORM_TYPES.has(n.componentType)) beforeFields.set(fieldKey(n), n);
    for (const n of after.nodes) {
      if (!FORM_TYPES.has(n.componentType)) continue;
      const prev = beforeFields.get(fieldKey(n));
      if (!prev) continue;
      const from = prev.value ?? '';
      const to = n.value ?? '';
      if (from === to) continue;
      if (from && !to) clearedFields.push(n.name || prev.name || fieldKey(n));
      else changedValues.push({ name: n.name || prev.name || fieldKey(n), from, to });
    }
  }

  const delta: ObservedDelta = {
    urlChanged,
    ...(urlChanged ? { url: { from: before.url, to: after.url } } : {}),
    newToasts: added(before.toasts, after.toasts),
    newDialogs: added(before.dialogs, after.dialogs),
    newErrors: added(before.errors, after.errors),
    listDeltas,
    newTexts,
    clearedFields: clearedFields.slice(0, 6),
    changedValues: changedValues.slice(0, 6),
    quiet: false,
  };
  delta.quiet =
    !delta.urlChanged &&
    !delta.newToasts.length &&
    !delta.newDialogs.length &&
    !delta.newErrors.length &&
    !delta.listDeltas.length &&
    !delta.newTexts.length &&
    !delta.clearedFields.length &&
    !delta.changedValues.length;
  return delta;
}

const trunc = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Render the delta as one compact line the model reads as ground truth. */
export function renderObserved(d: ObservedDelta): string {
  if (d.quiet) return 'page did NOT observably change (no new text, no count change, no navigation)';
  const parts: string[] = [];
  if (d.url) parts.push(`URL ${trunc(d.url.from, 60)} → ${trunc(d.url.to, 60)}`);
  for (const l of d.listDeltas) parts.push(`${l.key} count ${l.before}→${l.after}`);
  if (d.newToasts.length) parts.push(`toast: ${d.newToasts.map(t => `"${trunc(t)}"`).join(', ')}`);
  if (d.newDialogs.length) parts.push(`dialog opened: ${d.newDialogs.map(t => `"${trunc(t)}"`).join(', ')}`);
  if (d.newErrors.length) parts.push(`errors shown: ${d.newErrors.map(t => `"${trunc(t)}"`).join(', ')}`);
  if (d.newTexts.length) parts.push(`new text on page: ${d.newTexts.map(t => `"${trunc(t, 50)}"`).join(', ')}`);
  if (d.clearedFields.length) parts.push(`fields reset to empty: ${d.clearedFields.map(f => `"${trunc(f, 30)}"`).join(', ')}`);
  if (d.changedValues.length) parts.push(`values changed: ${d.changedValues.map(c => `"${trunc(c.name, 30)}" "${trunc(c.from, 24)}"→"${trunc(c.to, 24)}"`).join(', ')}`);
  return parts.join('; ');
}

/** Signals that an effect durably landed (used to warn against re-submitting). */
export function looksLikeSuccessEffect(d: ObservedDelta): boolean {
  return (
    d.listDeltas.some(l => l.after > l.before) ||
    (d.clearedFields.length > 0 && d.newErrors.length === 0) ||
    // Navigation is a durable effect: the old document (and its form) is gone —
    // re-firing the action there is impossible, judge the goal on the new page.
    (d.urlChanged && d.newErrors.length === 0)
  );
}

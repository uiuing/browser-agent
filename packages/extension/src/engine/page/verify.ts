import type { PostCondition, VerificationResult, Baseline } from '../contracts/verification';
import type { SemanticFingerprint } from '../contracts/grounding';
import { buildSnapshot, getElementByNodeId } from './perception';
import { groundFingerprint, scoreNode } from './grounding';
import { getAdapter } from './adapters';
import { resolveTarget } from './execute';
import { normText, sleep, waitUntil } from './dom-utils';

/**
 * L5 — the signature layer. Every condition is checked against the *real* DOM and
 * returns evidence. This is what makes "done = verified" real, instead of trusting
 * the planner LLM's self-assessment (nanobrowser's approach).
 */

function conditionId(c: PostCondition): string {
  return JSON.stringify(c);
}

/**
 * Derive a CSS selector from a fingerprint's stable attributes. Real planners
 * (LLMs) copy attrs like data-testid from snapshot nodes rather than writing a
 * ready-made `selector`; counting must work for both shapes.
 */
function selectorsFromAttrs(fp: SemanticFingerprint): string[] {
  const attrs = fp.attrs ?? {};
  const out: string[] = [];
  for (const key of ['data-testid', 'data-test', 'data-role'] as const) {
    const v = attrs[key];
    if (v) out.push(`[${key}="${CSS.escape(v)}"]`);
  }
  if (attrs.id) out.push(`#${CSS.escape(attrs.id)}`);
  if (attrs.name) out.push(`[name="${CSS.escape(attrs.name)}"]`);
  return out;
}

/** Count DOM elements that represent a repeated "list row" for a fingerprint. */
export function countMatches(fp: SemanticFingerprint): number {
  const selector = fp.attrs?.selector;
  if (selector) {
    try {
      return document.querySelectorAll(selector).length;
    } catch {
      /* invalid selector, fall through */
    }
  }
  // attrs-derived selectors: authoritative when they match anything
  for (const sel of selectorsFromAttrs(fp)) {
    try {
      const n = document.querySelectorAll(sel).length;
      if (n > 0) return n;
    } catch {
      /* invalid derived selector, keep going */
    }
  }
  const snap = buildSnapshot();
  return snap.nodes.filter(n => scoreNode(fp, n) >= 0.6).length;
}

function elementExists(fp: SemanticFingerprint): { exists: boolean; text: string } {
  const selector = fp.attrs?.selector;
  if (selector) {
    try {
      const el = document.querySelector(selector);
      return { exists: !!el, text: el?.textContent?.trim().slice(0, 80) ?? '' };
    } catch {
      /* fall through */
    }
  }
  const snap = buildSnapshot();
  const res = groundFingerprint(fp, snap);
  if (res.nodeId !== null && res.confidence >= 0.6) {
    const el = getElementByNodeId(res.nodeId);
    return { exists: !!el && el.isConnected, text: el?.textContent?.trim().slice(0, 80) ?? '' };
  }
  return { exists: false, text: '' };
}

function textPresentIn(text: string, within?: SemanticFingerprint): { present: boolean; where: string } {
  let scope: Element | Document = document;
  if (within) {
    if (within.attrs?.selector) {
      // A selector may match many rows; search across all of them.
      try {
        const all = Array.from(document.querySelectorAll(within.attrs.selector));
        if (all.length > 0) {
          const target = normText(text);
          const present = all.some(el => normText((el as HTMLElement).innerText ?? el.textContent ?? '').includes(target));
          return { present, where: `scoped(${all.length})` };
        }
      } catch {
        /* invalid selector, fall through to document */
      }
    } else {
      const snap = buildSnapshot();
      const res = groundFingerprint(within, snap);
      if (res.nodeId !== null) {
        const el = getElementByNodeId(res.nodeId);
        if (el) scope = el;
      }
    }
  }
  const root: Element | null = scope instanceof Document ? scope.body : (scope as Element);
  const hay = normText((root as HTMLElement)?.innerText ?? root?.textContent ?? '');
  const target = normText(text);
  // Whitespace-insensitive fallback: models sometimes expect values run together
  // ("林真实13900002222") while the DOM renders them as separate spans.
  const present = hay.includes(target) || hay.replace(/\s+/g, '').includes(target.replace(/\s+/g, ''));
  return { present, where: within ? 'scoped' : 'document' };
}

async function evaluateOne(condition: PostCondition, baseline?: Baseline): Promise<VerificationResult> {
  const start = performance.now();
  const mk = (passed: boolean, expected: string, actual: string, evidence?: string): VerificationResult => ({
    condition,
    passed,
    expected,
    actual,
    evidence,
    durationMs: Math.round(performance.now() - start),
  });

  switch (condition.kind) {
    case 'value_equals': {
      const { el } = resolveTarget(condition.target);
      if (!el) return mk(false, condition.expected, '(element not found)');
      const actual = getAdapter(el).read(el);
      return mk(normText(actual) === normText(condition.expected), condition.expected, actual);
    }
    case 'attribute_equals': {
      const { el } = resolveTarget(condition.target);
      if (!el) return mk(false, condition.expected, '(element not found)');
      const actual = el.getAttribute(condition.attr) ?? '';
      return mk(normText(actual) === normText(condition.expected), condition.expected, actual);
    }
    case 'element_state': {
      const { el } = resolveTarget(condition.target);
      if (!el) return mk(false, String(condition.value), '(element not found)');
      // Grounding may land on the LABEL wrapping the control (they share the
      // accessible name — httpbin-style `<label><input type=radio> Medium</label>`).
      // Judging `.checked` on the label wrongly fails a click that worked; read the
      // state from the actual control.
      const control = ((): Element => {
        if (condition.state !== 'checked' && condition.state !== 'selected') return el;
        if (el instanceof HTMLInputElement || el instanceof HTMLOptionElement) return el;
        if (el.getAttribute('aria-checked') !== null || el.getAttribute('aria-selected') !== null) return el;
        if (el instanceof HTMLLabelElement && el.control) return el.control;
        const inner = el.querySelector('input[type="radio"], input[type="checkbox"], input, option');
        if (inner) return inner;
        const lbl = el.closest('label');
        if (lbl?.control) return lbl.control;
        return el;
      })();
      const has = ((): boolean => {
        if (condition.state === 'checked')
          return (control as HTMLInputElement).checked === true || control.getAttribute('aria-checked') === 'true';
        if (condition.state === 'disabled')
          return control.hasAttribute('disabled') || control.getAttribute('aria-disabled') === 'true';
        if (condition.state === 'expanded') return control.getAttribute('aria-expanded') === 'true';
        if (condition.state === 'selected')
          return control.getAttribute('aria-selected') === 'true' || (control as HTMLOptionElement).selected === true;
        return false;
      })();
      return mk(has === condition.value, `${condition.state}=${condition.value}`, `${condition.state}=${has}`);
    }
    case 'element_exists': {
      // give late-rendering elements (toasts) a short window to appear
      let r = elementExists(condition.fingerprint);
      if (!r.exists) {
        await waitUntil(() => elementExists(condition.fingerprint).exists, 1500);
        r = elementExists(condition.fingerprint);
      }
      return mk(r.exists, 'element present', r.exists ? `present: "${r.text}"` : 'absent', r.text);
    }
    case 'element_gone': {
      let r = elementExists(condition.fingerprint);
      if (r.exists) {
        await waitUntil(() => !elementExists(condition.fingerprint).exists, 1500);
        r = elementExists(condition.fingerprint);
      }
      return mk(!r.exists, 'element gone', r.exists ? 'still present' : 'gone');
    }
    case 'url_matches': {
      const p = condition.pattern;
      const matches = (): boolean => {
        const url = location.href;
        if (url.includes(p)) return true;
        // LLMs write regex-flavoured patterns ("search\?q=…"), with or without
        // surrounding slashes — accept both, substring remains the fast path.
        const source = p.startsWith('/') && p.endsWith('/') ? p.slice(1, -1) : p;
        try {
          return new RegExp(source).test(url);
        } catch {
          return false;
        }
      };
      // The previous action may have STARTED a navigation that hasn't landed yet —
      // judging the old URL instantly produces a false "didn't work" signal. Poll.
      // (If the document unloads mid-poll, the transport re-verifies on the new one.)
      if (!matches()) await waitUntil(matches, 4000);
      return mk(matches(), condition.pattern, location.href);
    }
    case 'text_present': {
      // Generous window: the text may arrive with a slow async render — or on the
      // NEXT document when the verified action kicked off a navigation (the unload
      // kills this call's channel; the transport re-runs it on the new page).
      let r = textPresentIn(condition.text, condition.within);
      if (!r.present) {
        await waitUntil(() => textPresentIn(condition.text, condition.within).present, 4000);
        r = textPresentIn(condition.text, condition.within);
      }
      return mk(r.present, `text "${condition.text}"`, r.present ? 'found' : 'not found', r.where);
    }
    case 'text_absent': {
      const r = textPresentIn(condition.text, condition.within);
      return mk(!r.present, `no text "${condition.text}"`, r.present ? 'found' : 'absent');
    }
    case 'list_count_delta': {
      const id = conditionId(condition);
      const before = baseline?.listCounts[id];
      if (before === undefined) {
        await sleep(120);
        return mk(false, `delta ${condition.delta}`, `no baseline (now ${countMatches(condition.list)})`, 'missing baseline');
      }

      // The fingerprint groundED at baseline time (counted > 0): trust it.
      if (before > 0) {
        await sleep(120);
        if (countMatches(condition.list) - before !== condition.delta) {
          await waitUntil(() => countMatches(condition.list) - before === condition.delta, 2500);
        }
        const after = countMatches(condition.list);
        const actualDelta = after - before;
        return mk(actualDelta === condition.delta, `delta ${condition.delta} (from ${before})`, `delta ${actualDelta} (now ${after})`);
      }

      // The fingerprint never grounded (baseline 0 — usually a wrongly-phrased
      // prediction, e.g. targeting a container instead of the rows). Do NOT fail
      // the action on a bad prediction: judge the delta against page-truth
      // repeated-element groups captured in the baseline (the observation channel).
      // Transient UI groups (toasts, dialogs) are excluded — a success toast must
      // never masquerade as a list row, or fake-success detection would break.
      const TRANSIENT_GROUP = /toast|alert|notif|dialog|modal|snackbar|message|tip/i;
      const groupsBefore = baseline?.groupCounts ?? {};
      const groupDelta = (): { key: string; d: number } | null => {
        const now = computeGroupCounts();
        const changed: { key: string; d: number }[] = [];
        for (const [key, b] of Object.entries(groupsBefore)) {
          if (TRANSIENT_GROUP.test(key)) continue;
          const d = (now[key] ?? 0) - b;
          if (d !== 0) changed.push({ key, d });
        }
        for (const key of Object.keys(now)) {
          if (TRANSIENT_GROUP.test(key)) continue;
          if (!(key in groupsBefore) && now[key] > 0) changed.push({ key, d: now[key] });
        }
        if (changed.length === 0) return null;
        return changed.find(c => c.d === condition.delta) ?? changed[0];
      };
      await sleep(120);
      if (!groupDelta()) await waitUntil(() => groupDelta() !== null, 2500);
      const g = groupDelta();
      if (g) {
        return mk(
          g.d === condition.delta,
          `delta ${condition.delta}`,
          `delta ${g.d} (page group ${g.key})`,
          'fingerprint never grounded; judged by page-truth group counts',
        );
      }
      return mk(false, `delta ${condition.delta}`, 'delta 0 (no page group changed)', 'fingerprint never grounded');
    }
    default:
      return mk(false, 'unknown', 'unknown');
  }
}

export async function verifyConditions(conditions: PostCondition[], baseline?: Baseline): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  for (const c of conditions) {
    results.push(await evaluateOne(c, baseline));
  }
  return results;
}

/** Page-truth counts of repeated-element groups (same keys as snapshot.groupCounts). */
function computeGroupCounts(): Record<string, number> {
  return buildSnapshot().groupCounts ?? {};
}

export function computeBaseline(conditions: PostCondition[]): Baseline {
  const listCounts: Record<string, number> = {};
  for (const c of conditions) {
    if (c.kind === 'list_count_delta') {
      listCounts[conditionId(c)] = countMatches(c.list);
    }
  }
  return { listCounts, url: location.href, groupCounts: computeGroupCounts() };
}

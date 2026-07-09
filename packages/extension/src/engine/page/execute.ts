import type { Action, ActionOutcome, ActionErrorCode } from '../contracts/action';
import type { TargetRef } from '../contracts/grounding';
import { buildSnapshot, getElementByNodeId } from './perception';
import { groundFingerprint } from './grounding';
import { getAdapter } from './adapters';
import { realisticClick, focus, sleep, waitUntil } from './dom-utils';

export interface ResolveOutcome {
  el: Element | null;
  code?: ActionErrorCode;
}

/**
 * Resolve a TargetRef to a live Element. Fingerprint-first (re-grounds against a
 * fresh snapshot every time — the "认得准 + 重新接地" behaviour). nodeId is a fast
 * path only, verified to still be connected.
 */
export function resolveTarget(target: TargetRef): ResolveOutcome {
  if (target.fingerprint) {
    const snap = buildSnapshot();
    const res = groundFingerprint(target.fingerprint, snap);
    if (res.nodeId !== null) {
      const el = getElementByNodeId(res.nodeId);
      if (el && el.isConnected) return { el };
    }
    // fall through to nodeId if fingerprint failed
  }
  if (target.nodeId !== undefined) {
    const el = getElementByNodeId(target.nodeId);
    if (el && el.isConnected) return { el };
  }
  return { el: null, code: 'element_not_found' };
}

function scrollIntoViewIfNeeded(el: Element): void {
  const r = el.getBoundingClientRect();
  if (r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth) {
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
  }
}

async function synthesizeFileUpload(el: Element, file: { name: string; mimeType: string; contentText?: string; contentBase64?: string }): Promise<boolean> {
  const input = (el.tagName.toLowerCase() === 'input' ? el : el.querySelector('input[type=file]')) as HTMLInputElement | null;
  if (!input) return false;
  let blob: Blob;
  if (file.contentBase64) {
    const bytes = Uint8Array.from(atob(file.contentBase64), c => c.charCodeAt(0));
    blob = new Blob([bytes], { type: file.mimeType });
  } else {
    blob = new Blob([file.contentText ?? ''], { type: file.mimeType });
  }
  const f = new File([blob], file.name, { type: file.mimeType });
  const dt = new DataTransfer();
  dt.items.add(f);
  input.files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(60);
  return input.files.length > 0;
}

export async function executeAction(action: Action): Promise<ActionOutcome> {
  const start = performance.now();
  const done = (partial: Omit<ActionOutcome, 'durationMs' | 'channel'>): ActionOutcome => ({
    ...partial,
    durationMs: Math.round(performance.now() - start),
    channel: 'dom',
  });

  try {
    if (action.type === 'navigate') {
      location.assign(action.url);
      return done({ ok: true });
    }

    if (action.type === 'press') {
      const el = action.target ? resolveTarget(action.target).el : document.activeElement;
      const targetEl = el || document.body;
      const keys = action.keys;
      // support simple combos like Control+a and single keys
      const parts = keys.split('+');
      const key = parts[parts.length - 1];
      const opts: KeyboardEventInit = {
        key,
        bubbles: true,
        ctrlKey: parts.includes('Control') || parts.includes('Ctrl'),
        metaKey: parts.includes('Meta') || parts.includes('Cmd'),
        shiftKey: parts.includes('Shift'),
        altKey: parts.includes('Alt'),
      };
      targetEl.dispatchEvent(new KeyboardEvent('keydown', opts));
      targetEl.dispatchEvent(new KeyboardEvent('keyup', opts));
      if (key === 'Enter' && targetEl instanceof HTMLElement) {
        const form = targetEl.closest('form');
        if (form) form.requestSubmit?.();
      }
      return done({ ok: true });
    }

    if (action.type === 'scrollTo') {
      if (action.target) {
        const { el } = resolveTarget(action.target);
        if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
      } else if (typeof action.yPercent === 'number') {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: (max * action.yPercent) / 100, behavior: 'instant' as ScrollBehavior });
      }
      await sleep(50);
      return done({ ok: true });
    }

    // remaining actions need a target
    if (!('target' in action) || !action.target) {
      if (action.type === 'extract') {
        return done({ ok: true, readback: document.title });
      }
      return done({ ok: false, error: { code: 'unsupported', message: 'action missing target' } });
    }

    const { el, code } = resolveTarget(action.target);
    if (!el) return done({ ok: false, error: { code: code ?? 'element_not_found', message: 'target not resolved' } });

    scrollIntoViewIfNeeded(el);

    if (action.type === 'click') {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      if (top && !(el === top || el.contains(top) || top.contains(el))) {
        // Something else sits at the click point. A giant unrelated surface is a
        // real blocker (modal backdrop, cookie wall) — report it honestly so the
        // agent can deal with the dialog first.
        const tr = top.getBoundingClientRect();
        const coversMostOfViewport = tr.width * tr.height > window.innerWidth * window.innerHeight * 0.5;
        if (coversMostOfViewport) {
          return done({ ok: false, error: { code: 'occluded', message: 'element is covered by another element' } });
        }
        // Small overlap (decorative icon, floating label sitting over the control):
        // do what a real user does — click the point. The top element receives the
        // event and it bubbles; post-conditions judge whether it worked.
        focus(el);
        realisticClick(top);
        await sleep(40);
        return done({ ok: true, readback: 'clicked at point through overlapping element' });
      }
      focus(el);
      realisticClick(el);
      await sleep(40);
      return done({ ok: true });
    }

    if (action.type === 'hover') {
      const { fireMouse } = await import('./dom-utils');
      fireMouse(el, 'mouseover');
      fireMouse(el, 'mousemove');
      return done({ ok: true });
    }

    if (action.type === 'uploadFile') {
      const ok = await synthesizeFileUpload(el, action.file);
      return done({
        ok,
        readback: ok ? action.file.name : undefined,
        error: ok ? undefined : { code: 'value_not_applied', message: 'file input not found' },
      });
    }

    if (action.type === 'extract') {
      const value = action.attr ? el.getAttribute(action.attr) ?? '' : (el.textContent ?? '').trim();
      return done({ ok: true, readback: value });
    }

    if (action.type === 'fill' || action.type === 'setValue') {
      const adapter = getAdapter(el);
      let res = await adapter.apply(el, action.value, 0);
      if (!res.ok) {
        // strategy fallback (per-char / focus-first)
        res = await adapter.apply(el, action.value, 1);
      }
      return done({
        ok: res.ok,
        readback: res.readback,
        error: res.ok ? undefined : { code: 'value_not_applied', message: res.error ?? 'value not applied' },
      });
    }

    return done({ ok: false, error: { code: 'unsupported', message: `unknown action` } });
  } catch (e) {
    return done({
      ok: false,
      error: { code: 'channel_error', message: e instanceof Error ? e.message : String(e) },
    });
  }
}

export { waitUntil };

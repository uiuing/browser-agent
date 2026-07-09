import type { PageSnapshot, SemanticNode, Rect } from '../contracts/perception';
import { accessibleName, ariaStates, directText, getRole } from './aria';
import { detectComponentType } from './component-type';

const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'details', 'summary', 'label']);
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'combobox',
  'listbox',
  'slider',
  'spinbutton',
  'textbox',
  'searchbox',
  'treeitem',
]);
const COMPONENT_CLASS_HINTS =
  /\b(btn|button|clickable|ant-select|el-select|react-select|rc-select|select__control|ant-picker|el-date|datepicker|cascader|switch|toggle|menu-item|dropdown|tab|chip|tag)\b/i;

const STABLE_ATTRS = [
  'id',
  'name',
  'type',
  'placeholder',
  'data-testid',
  'data-test',
  'data-cy',
  'href',
  'role',
  'aria-label',
  'title',
  'value',
];

interface WalkCtx {
  nodes: SemanticNode[];
  idCounter: { n: number };
  elementMap: Map<number, Element>;
  framePath: string;
  offsetX: number;
  offsetY: number;
}

let lastElementMap: Map<number, Element> = new Map();

export function getElementByNodeId(id: number): Element | undefined {
  return lastElementMap.get(id);
}

function computeStyleSafe(el: Element): CSSStyleDeclaration | null {
  try {
    return el.ownerDocument.defaultView?.getComputedStyle(el) || null;
  } catch {
    return null;
  }
}

function isVisible(el: Element, style: CSSStyleDeclaration | null): boolean {
  if (!style) return false;
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  if (parseFloat(style.opacity || '1') === 0) return false;
  const he = el as HTMLElement;
  if (he.offsetWidth === 0 && he.offsetHeight === 0 && el.getClientRects().length === 0) return false;
  return true;
}

const INTERACTIVE_CURSORS = new Set(['pointer', 'text', 'move', 'grab', 'grabbing', 'cell', 'copy']);

/**
 * Multi-signal interactivity confidence in [0,1]. Unlike nanobrowser (primarily
 * computed cursor style) we combine tag/role/tabindex/handlers/component hints and
 * only use cursor as one weak signal. Custom widget shells with cursor:default
 * still get recognized.
 */
function interactivityScore(el: Element, role: string, style: CSSStyleDeclaration | null, componentType: string): number {
  const tag = el.tagName.toLowerCase();
  let score = 0;

  if (INTERACTIVE_TAGS.has(tag)) score += 0.6;
  if (INTERACTIVE_ROLES.has(role)) score += 0.5;
  if (componentType !== 'generic' && componentType !== 'listitem' && componentType !== 'link') score += 0.35;

  const tabindex = el.getAttribute('tabindex');
  if (tabindex !== null && tabindex !== '-1') score += 0.3;
  if (el.getAttribute('contenteditable') === 'true') score += 0.5;
  if (el.getAttribute('aria-haspopup')) score += 0.25;
  if (el.hasAttribute('onclick') || el.hasAttribute('ng-click') || el.hasAttribute('@click')) score += 0.35;

  const cls = el.getAttribute('class') || '';
  if (COMPONENT_CLASS_HINTS.test(cls)) score += 0.25;

  if (style?.cursor && INTERACTIVE_CURSORS.has(style.cursor)) score += 0.2;

  // Disabled reduces but doesn't zero (still reportable)
  if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') score -= 0.3;

  return Math.max(0, Math.min(1, score));
}

function rectOf(el: Element, offsetX: number, offsetY: number): Rect {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + offsetX), y: Math.round(r.top + offsetY), w: Math.round(r.width), h: Math.round(r.height) };
}

function isOccluded(el: Element): boolean {
  try {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return false; // offscreen != occluded
    const top = el.ownerDocument.elementFromPoint(cx, cy);
    if (!top) return false;
    return !(el === top || el.contains(top) || top.contains(el));
  } catch {
    return false;
  }
}

function structuralPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && depth < 6) {
    const node: Element = cur;
    const tag = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((c: Element) => c.tagName === node.tagName);
      const idx = sameTag.indexOf(node) + 1;
      parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${idx})` : tag);
    } else {
      parts.unshift(tag);
    }
    cur = parent;
    depth++;
  }
  return parts.join('>');
}

function collectAnchors(el: Element): string[] {
  const anchors: string[] = [];
  // label chain already captured in name; add preceding sibling text + closest heading/legend
  const prev = el.previousElementSibling;
  if (prev) {
    const t = directText(prev) || prev.textContent?.trim() || '';
    if (t && t.length < 60) anchors.push(t);
  }
  const fieldset = el.closest('fieldset');
  const legend = fieldset?.querySelector('legend');
  if (legend?.textContent) anchors.push(legend.textContent.trim());
  const labelledGroup = el.closest('[data-field],.form-item,.ant-form-item,.el-form-item');
  const groupLabel = labelledGroup?.querySelector('label,.ant-form-item-label,.el-form-item__label');
  if (groupLabel?.textContent) {
    const t = groupLabel.textContent.trim();
    if (t) anchors.push(t);
  }
  return Array.from(new Set(anchors.filter(Boolean))).slice(0, 4);
}

function pickAttrs(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of STABLE_ATTRS) {
    const v = el.getAttribute(a);
    if (v !== null && v !== '') {
      // don't leak password values
      if (a === 'value' && (el.getAttribute('type') || '').toLowerCase() === 'password') continue;
      out[a] = v.slice(0, 120);
    }
  }
  return out;
}

function currentValue(el: Element, componentType: string): string | undefined {
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const input = el as HTMLInputElement;
    if (input.type === 'password') return input.value ? '••••••' : '';
    if (input.type === 'checkbox' || input.type === 'radio') return input.checked ? 'checked' : 'unchecked';
    return input.value;
  }
  if (tag === 'textarea') return (el as HTMLTextAreaElement).value;
  if (tag === 'select') {
    const sel = el as HTMLSelectElement;
    return sel.options[sel.selectedIndex]?.text ?? '';
  }
  if (el.getAttribute('contenteditable') === 'true') return (el as HTMLElement).innerText;
  if (componentType === 'custom-select' || componentType === 'multiselect' || componentType === 'cascader') {
    // read the shell's displayed selection text
    const sel = el.querySelector(
      '.ant-select-selection-item,.el-select__selected-item,.select__single-value,[class*="selection-item"]',
    );
    if (sel?.textContent) return sel.textContent.trim();
    const ph = el.querySelector('.ant-select-selection-placeholder');
    if (ph) return '';
  }
  return undefined;
}

function shouldEmit(el: Element, interactive: number, name: string, role: string): boolean {
  if (interactive >= 0.45) return true;
  // Test anchors (data-testid) are intentional, meaningful nodes (e.g. list rows whose
  // text lives in child spans) — emit them even without an accessible name so the
  // planner/verifier can address and count them.
  if (el.matches('[data-testid],[data-test],[data-role]')) return true;
  // Emit meaningful landmarks / headings / list items with text so planner has context
  if (['heading', 'listitem', 'row', 'cell', 'alert', 'status'].includes(role) && name) return true;
  if (el.matches('[role]') && name) return true;
  return false;
}

function walk(node: Node, ctx: WalkCtx): void {
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (['script', 'style', 'noscript', 'template', 'head', 'meta', 'link'].includes(tag)) return;

  const style = computeStyleSafe(el);
  const visible = isVisible(el, style);

  // Descend into same-origin iframes
  if (tag === 'iframe') {
    try {
      const iframe = el as HTMLIFrameElement;
      const idoc = iframe.contentDocument;
      if (idoc && idoc.body) {
        const r = iframe.getBoundingClientRect();
        const subCtx: WalkCtx = {
          ...ctx,
          framePath: `${ctx.framePath}/iframe${el.id ? '#' + el.id : ''}`,
          offsetX: ctx.offsetX + r.left,
          offsetY: ctx.offsetY + r.top,
        };
        walk(idoc.body, subCtx);
      }
    } catch {
      // cross-origin; skip (never descend, avoids nanobrowser's extension-origin poisoning)
    }
    return;
  }

  if (visible) {
    const role = getRole(el);
    const componentType = detectComponentType(el);
    const interactive = interactivityScore(el, role, style, componentType);
    const name = accessibleName(el);

    if (shouldEmit(el, interactive, name, role)) {
      const id = ctx.idCounter.n++;
      const rect = rectOf(el, ctx.offsetX, ctx.offsetY);
      const inViewport =
        rect.y >= window.scrollY - 5 && rect.y <= window.scrollY + window.innerHeight + 5 && rect.h > 0;
      ctx.nodes.push({
        id,
        tag,
        role,
        name,
        value: currentValue(el, componentType),
        states: ariaStates(el),
        componentType,
        interactive: Math.round(interactive * 100) / 100,
        visible,
        inViewport,
        occluded: interactive >= 0.45 ? isOccluded(el) : false,
        rect,
        attrs: pickAttrs(el),
        path: structuralPath(el),
        anchors: collectAnchors(el),
        framePath: ctx.framePath,
      });
      ctx.elementMap.set(id, el);
    }
  }

  // Shadow DOM (open)
  const shadow = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
  if (shadow) {
    shadow.childNodes.forEach(child => walk(child, ctx));
  }

  // Native <select> children shouldn't be walked as separate nodes (options handled by adapter)
  if (tag === 'select') return;

  el.childNodes.forEach(child => walk(child, ctx));
}

/** Collect visible texts for a selector set: page-level state the model must see. */
function visibleTexts(selectors: string, cap = 6, maxLen = 160): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  try {
    for (const el of Array.from(document.querySelectorAll(selectors))) {
      const style = computeStyleSafe(el);
      if (!isVisible(el, style)) continue;
      const text = ((el as HTMLElement).innerText ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLen);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
      if (out.length >= cap) break;
    }
  } catch {
    /* selector engine hiccup — meta stays partial */
  }
  return out;
}

const DIALOG_SELECTORS =
  '[role="dialog"],[role="alertdialog"],dialog[open],.modal.show,.modal[style*="display: block"],.ant-modal:not([style*="display: none"]),.el-dialog';
const ERROR_SELECTORS =
  '[role="alert"],.field-error,.error-message,.form-error,.invalid-feedback,.ant-form-item-explain-error,.el-form-item__error,[aria-invalid="true"] ~ .help-block';
const TOAST_SELECTORS =
  '[role="status"],.toast,.toastify,.notification,.ant-message-notice,.ant-notification-notice,.el-message,.snackbar';

export function buildSnapshot(opts?: { maxNodes?: number; interactiveOnly?: boolean }): PageSnapshot {
  const ctx: WalkCtx = {
    nodes: [],
    idCounter: { n: 0 },
    elementMap: new Map(),
    framePath: '',
    offsetX: 0,
    offsetY: 0,
  };
  walk(document.body, ctx);

  // Group counts BEFORE truncation: snapshot diffing (the observation channel)
  // compares exact totals; a maxNodes cap must never distort them.
  const groupCounts: Record<string, number> = {};
  for (const n of ctx.nodes) {
    const tid = n.attrs['data-testid'] ?? n.attrs['data-test'] ?? n.attrs['data-role'];
    const key = tid ? `[data-testid="${tid}"]` : n.role === 'listitem' || n.role === 'row' ? `role=${n.role}` : null;
    if (key) groupCounts[key] = (groupCounts[key] ?? 0) + 1;
  }

  let nodes = ctx.nodes;
  if (opts?.interactiveOnly) nodes = nodes.filter(n => n.interactive >= 0.45);
  if (opts?.maxNodes && nodes.length > opts.maxNodes) {
    // keep most-interactive + named nodes
    nodes = [...nodes].sort((a, b) => b.interactive - a.interactive).slice(0, opts.maxNodes).sort((a, b) => a.id - b.id);
  }

  lastElementMap = ctx.elementMap;

  return {
    url: location.href,
    title: document.title,
    at: new Date().toISOString(),
    scrollY: window.scrollY,
    scrollHeight: document.documentElement.scrollHeight,
    viewportH: window.innerHeight,
    dialogs: visibleTexts(DIALOG_SELECTORS, 3, 240),
    errors: visibleTexts(ERROR_SELECTORS),
    toasts: visibleTexts(TOAST_SELECTORS),
    groupCounts,
    nodes,
  };
}

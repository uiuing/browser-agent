/**
 * Accessible name + role derivation. Pure DOM, runs in page context.
 * Deliberately richer than nanobrowser's approach (which leans on computed cursor
 * style for interactivity and does not build an a11y name chain).
 */

const IMPLICIT_ROLE: Record<string, string> = {
  a: 'link',
  button: 'button',
  input: 'textbox',
  select: 'combobox',
  textarea: 'textbox',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  img: 'img',
  ul: 'list',
  ol: 'list',
  li: 'listitem',
  table: 'table',
  nav: 'navigation',
  form: 'form',
  main: 'main',
  header: 'banner',
  footer: 'contentinfo',
  aside: 'complementary',
  section: 'region',
  dialog: 'dialog',
  summary: 'button',
};

const INPUT_TYPE_ROLE: Record<string, string> = {
  checkbox: 'checkbox',
  radio: 'radio',
  button: 'button',
  submit: 'button',
  reset: 'button',
  range: 'slider',
  number: 'spinbutton',
  search: 'searchbox',
  email: 'textbox',
  tel: 'textbox',
  url: 'textbox',
  text: 'textbox',
  password: 'textbox',
  date: 'textbox',
};

export function getRole(el: Element): string {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit.trim().split(/\s+/)[0];
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const t = (el.getAttribute('type') || 'text').toLowerCase();
    return INPUT_TYPE_ROLE[t] || 'textbox';
  }
  return IMPLICIT_ROLE[tag] || 'generic';
}

function textFromLabelledBy(el: Element): string {
  const ids = el.getAttribute('aria-labelledby');
  if (!ids) return '';
  const doc = el.ownerDocument;
  return ids
    .split(/\s+/)
    .map(id => doc.getElementById(id)?.textContent?.trim() || '')
    .filter(Boolean)
    .join(' ')
    .trim();
}

function labelForControl(el: Element): string {
  const id = el.getAttribute('id');
  if (id) {
    const root = el.getRootNode() as Document | ShadowRoot;
    const lbl = root.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (lbl?.textContent) return lbl.textContent.trim();
  }
  const wrapping = el.closest('label');
  if (wrapping) {
    // text of label minus the control's own value
    const clone = wrapping.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input,select,textarea').forEach(n => n.remove());
    const t = clone.textContent?.trim();
    if (t) return t;
  }
  return '';
}

export function accessibleName(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria && aria.trim()) return aria.trim();

  const labelled = textFromLabelledBy(el);
  if (labelled) return labelled;

  const forLabel = labelForControl(el);
  if (forLabel) return forLabel;

  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const ph = el.getAttribute('placeholder');
    if (ph && ph.trim()) return ph.trim();
    const val = (el as HTMLInputElement).value;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if ((type === 'button' || type === 'submit' || type === 'reset') && val) return val.trim();
  }
  if (tag === 'img') {
    const alt = el.getAttribute('alt');
    if (alt) return alt.trim();
  }
  if (tag === 'button' || tag === 'a' || tag === 'summary' || getRole(el) === 'button') {
    const t = directText(el) || el.textContent?.trim() || '';
    if (t) return t.slice(0, 120);
  }

  const title = el.getAttribute('title');
  if (title && title.trim()) return title.trim();

  // last resort: short direct text
  const dt = directText(el);
  if (dt) return dt.slice(0, 120);
  return '';
}

/** Text directly inside the element (not deep descendants), collapsed. */
export function directText(el: Element): string {
  let s = '';
  el.childNodes.forEach(n => {
    if (n.nodeType === Node.TEXT_NODE) s += n.textContent || '';
  });
  return s.replace(/\s+/g, ' ').trim();
}

export function ariaStates(el: Element): string[] {
  const states: string[] = [];
  const push = (attr: string, name: string) => {
    const v = el.getAttribute(attr);
    if (v === 'true') states.push(name);
  };
  push('aria-checked', 'checked');
  push('aria-expanded', 'expanded');
  push('aria-selected', 'selected');
  push('aria-disabled', 'disabled');
  push('aria-required', 'required');
  push('aria-readonly', 'readonly');
  if (el.hasAttribute('disabled')) states.push('disabled');
  if (el.hasAttribute('required')) states.push('required');
  if (el.hasAttribute('readonly')) states.push('readonly');
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const input = el as HTMLInputElement;
    if ((input.type === 'checkbox' || input.type === 'radio') && input.checked) states.push('checked');
  }
  if (tag === 'option' && (el as HTMLOptionElement).selected) states.push('selected');
  return Array.from(new Set(states));
}

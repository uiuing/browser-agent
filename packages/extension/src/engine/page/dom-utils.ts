export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Set an input/textarea value in a way that survives React/Vue controlled inputs.
 * We call the native value setter then dispatch input+change so frameworks pick it up.
 */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc?.set) {
    desc.set.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export function fireMouse(el: Element, type: string): void {
  const r = el.getBoundingClientRect();
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: r.left + r.width / 2,
    clientY: r.top + r.height / 2,
  });
  el.dispatchEvent(ev);
}

export function realisticClick(el: Element): void {
  // Simulate the interaction, but activate exactly once. Dispatching a synthetic
  // 'click' AND calling el.click() would double-fire (e.g. submit a form twice).
  fireMouse(el, 'pointerdown');
  fireMouse(el, 'mousedown');
  fireMouse(el, 'pointerup');
  fireMouse(el, 'mouseup');
  if (el instanceof HTMLElement && typeof el.click === 'function') el.click();
  else fireMouse(el, 'click');
}

export function focus(el: Element): void {
  if (el instanceof HTMLElement) {
    el.focus?.();
    el.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
  }
}

/** Wait until predicate is true or timeout. Polls at 50ms. */
export async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await sleep(50);
  }
  return predicate();
}

export function normText(s: string | null | undefined): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Find an option-like element across common component libraries by visible text. */
export function findOptionByText(root: Document | Element, text: string): Element | null {
  const target = normText(text);
  const selectors = [
    '.ant-select-item-option',
    '.ant-select-item',
    '.el-select-dropdown__item',
    '.el-cascader-node',
    '.ant-cascader-menu-item',
    '.rc-select-item-option',
    '[role="option"]',
    '[role="menuitem"]',
    'li[role="menuitem"]',
    '.select__option',
    '.MuiMenuItem-root',
    '.mantine-Select-item',
    'li',
  ];
  for (const sel of selectors) {
    const items = Array.from(root.querySelectorAll(sel));
    const exact = items.find(i => normText(i.textContent) === target);
    if (exact) return exact;
  }
  for (const sel of selectors) {
    const items = Array.from(root.querySelectorAll(sel));
    const partial = items.find(i => normText(i.textContent).includes(target) && target.length > 0);
    if (partial) return partial;
  }
  return null;
}

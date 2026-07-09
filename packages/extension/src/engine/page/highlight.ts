import { getElementByNodeId } from './perception';

const CONTAINER_ID = 'browser-agent-highlight-layer';

function ensureContainer(): HTMLElement {
  let c = document.getElementById(CONTAINER_ID);
  if (!c) {
    c = document.createElement('div');
    c.id = CONTAINER_ID;
    c.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
    document.documentElement.appendChild(c);
  }
  return c;
}

export function highlightNode(nodeId: number, label?: string): boolean {
  const el = getElementByNodeId(nodeId);
  if (!el) return false;
  const c = ensureContainer();
  c.innerHTML = '';
  const r = el.getBoundingClientRect();
  const box = document.createElement('div');
  box.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border:2px solid #0d9488;border-radius:6px;box-shadow:0 0 0 3px rgba(13,148,136,.25);transition:all .12s ease;`;
  c.appendChild(box);
  if (label) {
    const tag = document.createElement('div');
    tag.textContent = label;
    tag.style.cssText = `position:absolute;left:${r.left}px;top:${Math.max(0, r.top - 22)}px;background:#0d9488;color:#fff;font:11px/1.4 system-ui;padding:1px 6px;border-radius:4px;white-space:nowrap;max-width:280px;overflow:hidden;text-overflow:ellipsis;`;
    c.appendChild(tag);
  }
  return true;
}

export function clearHighlight(): boolean {
  const c = document.getElementById(CONTAINER_ID);
  if (c) c.remove();
  return true;
}

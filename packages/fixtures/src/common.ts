export type Inject = 'normal' | 'slow' | 'flaky' | 'fakeSuccess';
export type Lang = 'zh' | 'en';

export function params(): { inject: Inject; lang: Lang } {
  const u = new URL(location.href);
  const inject = (u.searchParams.get('inject') as Inject) || 'normal';
  const lang = (u.searchParams.get('lang') as Lang) || 'zh';
  return { inject, lang };
}

export function toast(message: string): void {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.setAttribute('data-role', 'toast');
  el.textContent = `\u2713 ${message}`;
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 2600);
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
}

/** Ant-Design-style custom select: div shell + popup listbox, cursor:default. */
export function antdSelect(opts: {
  id: string;
  label: string;
  placeholder: string;
  options: string[];
  onChange?: (v: string) => void;
}): HTMLElement {
  const root = el('div', { class: 'ant-select', 'data-testid': `field-${opts.id}` });
  const selector = el('div', {
    class: 'ant-select-selector',
    role: 'combobox',
    'aria-haspopup': 'listbox',
    'aria-expanded': 'false',
    'aria-label': opts.label,
    tabindex: '0',
  });
  const valueSpan = el('span', { class: 'ant-select-selection-placeholder' }, [opts.placeholder]);
  const arrow = el('span', { class: 'ant-select-arrow' }, ['\u25be']);
  selector.append(valueSpan, arrow);
  const dropdown = el('div', { class: 'ant-select-dropdown ant-select-dropdown-hidden', role: 'listbox' });
  for (const o of opts.options) {
    const item = el('div', { class: 'ant-select-item ant-select-item-option', role: 'option', 'aria-selected': 'false' }, [o]);
    item.addEventListener('click', () => {
      valueSpan.className = 'ant-select-selection-item';
      valueSpan.textContent = o;
      dropdown.querySelectorAll('.ant-select-item-option').forEach(n => {
        n.classList.remove('ant-select-item-option-selected');
        n.setAttribute('aria-selected', 'false');
      });
      item.classList.add('ant-select-item-option-selected');
      item.setAttribute('aria-selected', 'true');
      dropdown.classList.add('ant-select-dropdown-hidden');
      selector.setAttribute('aria-expanded', 'false');
      opts.onChange?.(o);
    });
    dropdown.append(item);
  }
  const toggle = () => {
    const hidden = dropdown.classList.toggle('ant-select-dropdown-hidden');
    selector.setAttribute('aria-expanded', String(!hidden));
  };
  selector.addEventListener('click', toggle);
  selector.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });
  document.addEventListener('mousedown', e => {
    if (!root.contains(e.target as Node)) {
      dropdown.classList.add('ant-select-dropdown-hidden');
      selector.setAttribute('aria-expanded', 'false');
    }
  });
  root.dataset.value = '';
  root.append(selector, dropdown);
  (root as unknown as { getValue: () => string }).getValue = () =>
    valueSpan.classList.contains('ant-select-selection-item') ? valueSpan.textContent || '' : '';
  return root;
}

export function topbar(active: string, lang: Lang): HTMLElement {
  const links: [string, string][] =
    lang === 'en'
      ? [
          ['index.html', 'Home'],
          ['login.html', 'Login'],
          ['customer.html', 'New customer'],
          ['product.html', 'New product'],
          ['controls.html', 'Controls'],
          ['list.html', 'List'],
          ['wizard.html', 'Wizard'],
          ['iframe.html', 'Iframe'],
          ['longform.html', 'Long form'],
        ]
      : [
          ['index.html', '首页'],
          ['login.html', '登录'],
          ['customer.html', '新建客户'],
          ['product.html', '新建商品'],
          ['controls.html', '控件'],
          ['list.html', '列表'],
          ['wizard.html', '向导'],
          ['iframe.html', 'iframe'],
          ['longform.html', '长表单'],
        ];
  const suffix = location.search;
  const nav = el('nav', {}, links.map(([href, label]) => {
    const a = el('a', { href: href + suffix }, [label]);
    if (href === active) a.style.fontWeight = '700';
    return a;
  }));
  return el('div', { class: 'topbar' }, [el('span', { class: 'brand' }, ['Acme 后台 / Console']), nav]);
}

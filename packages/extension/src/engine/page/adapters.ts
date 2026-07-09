import type { ComponentType } from '../contracts/perception';
import { detectComponentType } from './component-type';
import { setNativeValue, realisticClick, focus, waitUntil, findOptionByText, normText, sleep } from './dom-utils';

export interface AdapterResult {
  ok: boolean;
  readback?: string;
  error?: string;
}

export interface ControlAdapter {
  read(el: Element): string;
  apply(el: Element, value: string, strategy?: number): Promise<AdapterResult>;
}

/* ---------- native text ---------- */
const nativeInput: ControlAdapter = {
  read(el) {
    return (el as HTMLInputElement).value ?? '';
  },
  async apply(el, value, strategy = 0) {
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    focus(input);
    if (strategy === 1) {
      // per-character fallback for stubborn masked inputs
      setNativeValue(input, '');
      for (const ch of value) {
        setNativeValue(input, input.value + ch);
        el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
        await sleep(5);
      }
    } else {
      setNativeValue(input, value);
    }
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    return { ok: normText(input.value) === normText(value), readback: input.value };
  },
};

const contentEditable: ControlAdapter = {
  read(el) {
    return (el as HTMLElement).innerText ?? '';
  },
  async apply(el, value) {
    const he = el as HTMLElement;
    focus(he);
    he.innerText = value;
    he.dispatchEvent(new InputEvent('input', { bubbles: true }));
    he.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: normText(he.innerText) === normText(value), readback: he.innerText };
  },
};

/* ---------- native select ---------- */
const nativeSelect: ControlAdapter = {
  read(el) {
    const sel = el as HTMLSelectElement;
    return sel.options[sel.selectedIndex]?.text ?? '';
  },
  async apply(el, value) {
    const sel = el as HTMLSelectElement;
    const target = normText(value);
    const opt =
      Array.from(sel.options).find(o => normText(o.text) === target) ||
      Array.from(sel.options).find(o => normText(o.value) === target) ||
      Array.from(sel.options).find(o => normText(o.text).includes(target) && target.length > 0);
    if (!opt) return { ok: false, error: `option "${value}" not found` };
    sel.value = opt.value;
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: sel.value === opt.value, readback: opt.text };
  },
};

/* ---------- checkbox / radio ---------- */
const toggleControl: ControlAdapter = {
  read(el) {
    return (el as HTMLInputElement).checked ? 'checked' : 'unchecked';
  },
  async apply(el, value) {
    const input = el as HTMLInputElement;
    const want = /^(true|checked|yes|1|on)$/i.test(value.trim());
    if (input.checked !== want) realisticClick(input);
    return { ok: input.checked === want, readback: input.checked ? 'checked' : 'unchecked' };
  },
};

const switchControl: ControlAdapter = {
  read(el) {
    return el.getAttribute('aria-checked') === 'true' || el.classList.contains('ant-switch-checked') ? 'on' : 'off';
  },
  async apply(el, value) {
    const want = /^(true|on|yes|1|checked)$/i.test(value.trim());
    const isOn = () => el.getAttribute('aria-checked') === 'true' || el.classList.contains('ant-switch-checked');
    if (isOn() !== want) realisticClick(el);
    await sleep(60);
    return { ok: isOn() === want, readback: isOn() ? 'on' : 'off' };
  },
};

/* ---------- custom select (antd / element / react-select) ---------- */
function readCustomSelect(el: Element): string {
  const sel = el.querySelector(
    '.ant-select-selection-item,.el-select__selected-item,.select__single-value,[class*="selection-item"]',
  );
  return sel?.textContent?.trim() ?? '';
}

const customSelect: ControlAdapter = {
  read: readCustomSelect,
  async apply(el, value, strategy = 0) {
    // open the dropdown
    const trigger =
      el.querySelector('.ant-select-selector,.el-select__wrapper,.select__control,[class*="selector"]') || el;
    realisticClick(trigger);
    if (strategy === 1) focus(el.querySelector('input') || el);

    // wait for a popup listbox to appear anywhere in the document
    await waitUntil(
      () =>
        !!document.querySelector(
          '.ant-select-dropdown:not(.ant-select-dropdown-hidden), .el-select-dropdown, .rc-virtual-list, [role="listbox"], .select__menu',
        ),
      1500,
    );
    await sleep(60);

    const option = findOptionByText(document, value);
    if (!option) {
      // try typing to filter then re-search
      const input = el.querySelector('input');
      if (input) {
        setNativeValue(input as HTMLInputElement, value);
        await sleep(200);
        const opt2 = findOptionByText(document, value);
        if (opt2) {
          realisticClick(opt2);
          await sleep(80);
          return { ok: normText(readCustomSelect(el)).includes(normText(value)), readback: readCustomSelect(el) };
        }
      }
      return { ok: false, error: `option "${value}" not found in dropdown` };
    }
    realisticClick(option);
    await sleep(80);
    const rb = readCustomSelect(el);
    return { ok: normText(rb).includes(normText(value)) || normText(value).includes(normText(rb)), readback: rb };
  },
};

/* ---------- datepicker ---------- */
const datePicker: ControlAdapter = {
  read(el) {
    const input = el.tagName.toLowerCase() === 'input' ? (el as HTMLInputElement) : el.querySelector('input');
    return input?.value ?? '';
  },
  async apply(el, value) {
    const input = (el.tagName.toLowerCase() === 'input' ? el : el.querySelector('input')) as HTMLInputElement | null;
    if (!input) return { ok: false, error: 'no date input found' };
    focus(input);
    setNativeValue(input, value);
    // many pickers commit on Enter
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    await sleep(60);
    return { ok: normText(input.value).includes(normText(value)) || input.value.length > 0, readback: input.value };
  },
};

/* ---------- cascader ---------- */
const cascader: ControlAdapter = {
  read: readCustomSelect,
  async apply(el, value) {
    const parts = value.split(/[\/>,]/).map(s => s.trim()).filter(Boolean);
    const trigger = el.querySelector('.ant-cascader-selector,.el-cascader,[class*="selector"]') || el;
    realisticClick(trigger);
    await waitUntil(() => !!document.querySelector('.ant-cascader-menu,.el-cascader-menu,[role="menu"]'), 1500);
    for (const part of parts) {
      await sleep(80);
      const opt = findOptionByText(document, part);
      if (!opt) return { ok: false, error: `cascader level "${part}" not found` };
      realisticClick(opt);
    }
    await sleep(80);
    return { ok: true, readback: readCustomSelect(el) };
  },
};

/* ---------- multiselect ---------- */
const multiSelect: ControlAdapter = {
  read(el) {
    return Array.from(el.querySelectorAll('.ant-select-selection-item,.el-tag,[class*="multi-value"]'))
      .map(n => n.textContent?.trim())
      .filter(Boolean)
      .join(', ');
  },
  async apply(el, value) {
    const values = value.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    const trigger = el.querySelector('[class*="selector"],[class*="control"]') || el;
    realisticClick(trigger);
    await waitUntil(() => !!document.querySelector('[role="listbox"],.ant-select-dropdown,.el-select-dropdown'), 1500);
    for (const v of values) {
      await sleep(60);
      const opt = findOptionByText(document, v);
      if (opt) realisticClick(opt);
    }
    // close popup
    realisticClick(document.body);
    return { ok: true, readback: multiSelect.read(el) };
  },
};

const adapters: Record<ComponentType, ControlAdapter> = {
  'native-input': nativeInput,
  textarea: nativeInput,
  contenteditable: contentEditable,
  'native-select': nativeSelect,
  'custom-select': customSelect,
  datepicker: datePicker,
  cascader,
  multiselect: multiSelect,
  checkbox: toggleControl,
  radio: toggleControl,
  switch: switchControl,
  'file-upload': nativeInput,
  button: nativeInput,
  link: nativeInput,
  listitem: nativeInput,
  generic: nativeInput,
};

export function getAdapter(el: Element): ControlAdapter {
  return adapters[detectComponentType(el)] ?? nativeInput;
}

export function getAdapterFor(type: ComponentType): ControlAdapter {
  return adapters[type] ?? nativeInput;
}

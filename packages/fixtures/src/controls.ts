import './styles.css';
import { antdSelect, el, params, toast, topbar, type Lang } from './common';

const T = {
  zh: {
    title: '自定义控件',
    sub: '这些是原生 <select> 之外的常见组件库控件。',
    single: 'Ant 风格单选下拉',
    date: '日期选择',
    cascader: '级联选择（省/市）',
    multi: '多选标签',
    upload: '文件上传',
    submit: '保存',
    success: '已保存',
    result: '当前取值',
    cities: { 浙江: ['杭州', '宁波', '温州'], 广东: ['广州', '深圳', '珠海'] },
    tags: ['促销', '新品', '清仓', '预售'],
    depts: ['市场部', '销售部', '客服部', '技术部'],
  },
  en: {
    title: 'Custom controls',
    sub: 'Common component-library widgets beyond native <select>.',
    single: 'Ant-style single select',
    date: 'Date picker',
    cascader: 'Cascader (province/city)',
    multi: 'Multi-select tags',
    upload: 'File upload',
    submit: 'Save',
    success: 'Saved',
    result: 'Current values',
    cities: { Zhejiang: ['Hangzhou', 'Ningbo', 'Wenzhou'], Guangdong: ['Guangzhou', 'Shenzhen', 'Zhuhai'] },
    tags: ['Promo', 'New', 'Clearance', 'Presale'],
    depts: ['Marketing', 'Sales', 'Support', 'Engineering'],
  },
} as const;

const { lang } = params();
const t = T[lang];
document.title = `${t.title} · Acme`;
const app = document.getElementById('app')!;
app.append(topbar('controls.html', lang));
const c = el('div', { class: 'container' });
const card = el('div', { class: 'card' });
card.append(el('h1', {}, [t.title]), el('p', { class: 'sub' }, [t.sub]));

const state: Record<string, string> = { dept: '', date: '', region: '', tags: '', upload: '' };

// single ant select
const dept = antdSelect({ id: 'dept', label: t.single, placeholder: '—', options: [...t.depts], onChange: v => { state.dept = v; renderResult(); } });
card.append(el('div', { class: 'form-item' }, [el('label', {}, [t.single]), dept]));

// date
const dateInput = el('input', { type: 'date', 'data-testid': 'field-date', 'aria-label': t.date });
dateInput.addEventListener('change', () => { state.date = dateInput.value; renderResult(); });
card.append(el('div', { class: 'form-item' }, [el('label', {}, [t.date]), dateInput]));

// cascader
const cascader = el('div', { class: 'ant-select', 'data-testid': 'field-cascader' });
const cascSelector = el('div', { class: 'ant-select-selector', role: 'combobox', 'aria-haspopup': 'true', 'aria-label': t.cascader, tabindex: '0' });
const cascValue = el('span', { class: 'ant-select-selection-placeholder' }, ['—']);
cascSelector.append(cascValue, el('span', { class: 'ant-select-arrow' }, ['\u25be']));
const cascMenu = el('div', { class: 'ant-select-dropdown ant-select-dropdown-hidden el-cascader-menu', role: 'menu' });
const provCol = el('div', { class: 'el-cascader-menu__list' });
const cityCol = el('div', { class: 'el-cascader-menu__list' });
cascMenu.append(provCol, cityCol);
let pickedProv = '';
for (const prov of Object.keys(t.cities)) {
  const node = el('div', { class: 'el-cascader-node', role: 'menuitem' }, [prov]);
  node.addEventListener('click', () => {
    pickedProv = prov;
    cityCol.innerHTML = '';
    const cityMap = t.cities as Readonly<Record<string, readonly string[]>>;
    for (const city of cityMap[prov]) {
      const cnode = el('div', { class: 'el-cascader-node', role: 'menuitem' }, [city]);
      cnode.addEventListener('click', () => {
        state.region = `${prov}/${city}`;
        cascValue.className = 'ant-select-selection-item';
        cascValue.textContent = `${prov} / ${city}`;
        cascMenu.classList.add('ant-select-dropdown-hidden');
        renderResult();
      });
      cityCol.append(cnode);
    }
  });
  provCol.append(node);
}
cascSelector.addEventListener('click', () => cascMenu.classList.toggle('ant-select-dropdown-hidden'));
document.addEventListener('mousedown', e => {
  if (!cascader.contains(e.target as Node)) cascMenu.classList.add('ant-select-dropdown-hidden');
});
cascader.append(cascSelector, cascMenu);
card.append(el('div', { class: 'form-item' }, [el('label', {}, [t.cascader]), cascader]));

// multi-select
const multi = el('div', { class: 'ant-select ant-select-multiple', 'data-testid': 'field-tags' });
const multiSelector = el('div', { class: 'ant-select-selector', role: 'combobox', 'aria-multiselectable': 'true', 'aria-label': t.multi, tabindex: '0' });
const multiValue = el('span', { class: 'ant-select-selection-placeholder' }, ['—']);
multiSelector.append(multiValue, el('span', { class: 'ant-select-arrow' }, ['\u25be']));
const multiMenu = el('div', { class: 'ant-select-dropdown ant-select-dropdown-hidden', role: 'listbox', 'aria-multiselectable': 'true' });
const picked = new Set<string>();
for (const tag of t.tags) {
  const opt = el('div', { class: 'ant-select-item ant-select-item-option', role: 'option', 'aria-selected': 'false' }, [tag]);
  opt.addEventListener('click', () => {
    if (picked.has(tag)) picked.delete(tag);
    else picked.add(tag);
    opt.setAttribute('aria-selected', String(picked.has(tag)));
    opt.classList.toggle('ant-select-item-option-selected', picked.has(tag));
    state.tags = Array.from(picked).join(', ');
    multiValue.className = picked.size ? 'ant-select-selection-item' : 'ant-select-selection-placeholder';
    multiValue.textContent = picked.size ? state.tags : '—';
    renderResult();
  });
  multiMenu.append(opt);
}
multiSelector.addEventListener('click', () => multiMenu.classList.toggle('ant-select-dropdown-hidden'));
document.addEventListener('mousedown', e => {
  if (!multi.contains(e.target as Node)) multiMenu.classList.add('ant-select-dropdown-hidden');
});
multi.append(multiSelector, multiMenu);
card.append(el('div', { class: 'form-item' }, [el('label', {}, [t.multi]), multi]));

// file upload
const file = el('input', { type: 'file', 'data-testid': 'field-upload', 'aria-label': t.upload });
const fileName = el('span', { class: 'muted-note', id: 'file-name' }, ['—']);
file.addEventListener('change', () => {
  state.upload = file.files?.[0]?.name ?? '';
  fileName.textContent = state.upload || '—';
  renderResult();
});
card.append(el('div', { class: 'form-item' }, [el('label', {}, [t.upload]), file, fileName]));

const submit = el('button', { type: 'button', class: 'btn-primary', 'data-testid': 'submit' }, [t.submit]);
submit.addEventListener('click', () => toast(t.success));
card.append(el('div', { class: 'actions' }, [submit]));

const resultBox = el('pre', { id: 'result', class: 'muted-note', style: 'background:#0f172a08;padding:12px;border-radius:8px' });
card.append(el('h2', { style: 'margin-top:16px' }, [t.result]), resultBox);

function renderResult() {
  resultBox.textContent = JSON.stringify(state, null, 2);
}
renderResult();

c.append(card);
app.append(c);

import './styles.css';
import { antdSelect, el, params, toast, topbar, type Lang } from './common';

interface Customer {
  name: string;
  company: string;
  phone: string;
  email: string;
  region: string;
  level: string;
  date: string;
  note: string;
}

const T = {
  zh: {
    title: '新建客户',
    sub: '录入客户信息并保存到列表。',
    name: '客户姓名',
    company: '公司',
    phone: '手机号',
    email: '邮箱',
    region: '所属区域',
    level: '客户等级',
    date: '签约日期',
    note: '备注',
    submit: '提交',
    reset: '重置',
    list: '客户列表',
    empty: '暂无客户',
    success: '客户创建成功',
    required: '此项为必填',
    invalidEmail: '邮箱格式不正确',
    regions: ['华东区', '华南区', '华北区', '西部区'],
    levels: ['普通', '重点', '战略'],
    seed: [
      { name: '孙琳', company: '恒益科技', phone: '13500001111', email: 'sunlin@hengyi.com', region: '华北区', level: '普通', date: '2026-05-12', note: '老客户' },
      { name: '何强', company: '博远物流', phone: '13600002222', email: 'heqiang@boyuan.cn', region: '华南区', level: '重点', date: '2026-06-03', note: '季度复购' },
    ],
  },
  en: {
    title: 'New customer',
    sub: 'Enter customer details and save to the list.',
    name: 'Customer name',
    company: 'Company',
    phone: 'Phone',
    email: 'Email',
    region: 'Region',
    level: 'Tier',
    date: 'Sign date',
    note: 'Note',
    submit: 'Submit',
    reset: 'Reset',
    list: 'Customers',
    empty: 'No customers yet',
    success: 'Customer created',
    required: 'This field is required',
    invalidEmail: 'Invalid email format',
    regions: ['East', 'South', 'North', 'West'],
    levels: ['Standard', 'Key', 'Strategic'],
    seed: [
      { name: 'Sun Lin', company: 'Hengyi Tech', phone: '13500001111', email: 'sunlin@hengyi.com', region: 'North', level: 'Standard', date: '2026-05-12', note: 'Returning' },
      { name: 'He Qiang', company: 'Boyuan Logistics', phone: '13600002222', email: 'heqiang@boyuan.cn', region: 'South', level: 'Key', date: '2026-06-03', note: 'Quarterly' },
    ],
  },
} as const;

function render(lang: Lang, inject: string) {
  const t = T[lang];
  const app = document.getElementById('app')!;
  app.append(topbar('customer.html', lang));
  const container = el('div', { class: 'container' });
  app.append(container);

  const form = el('form', { class: 'card', novalidate: 'true' });
  form.append(el('h1', {}, [t.title]), el('p', { class: 'sub' }, [t.sub]));
  const grid = el('div', { class: 'form-grid' });

  const mkField = (id: string, label: string, req: boolean, control: HTMLElement, full = false) => {
    const item = el('div', { class: `form-item${full ? ' full' : ''}`, 'data-field': id });
    const lbl = el('label', {}, [label]);
    if (req) lbl.append(el('span', { class: 'req' }, [' *']));
    const err = el('div', { class: 'field-error', id: `err-${id}` });
    err.style.display = 'none';
    item.append(lbl, control, err);
    return item;
  };

  const nameInput = el('input', { type: 'text', 'data-testid': 'field-name', 'aria-label': t.name });
  const companyInput = el('input', { type: 'text', 'data-testid': 'field-company', 'aria-label': t.company });
  const phoneInput = el('input', { type: 'tel', 'data-testid': 'field-phone', 'aria-label': t.phone });
  const emailInput = el('input', { type: 'email', 'data-testid': 'field-email', 'aria-label': t.email });
  const region = antdSelect({ id: 'region', label: t.region, placeholder: '—', options: [...t.regions] });
  const levelSelect = el('select', { 'data-testid': 'field-level', 'aria-label': t.level });
  levelSelect.append(el('option', { value: '' }, ['—']), ...t.levels.map(l => el('option', { value: l }, [l])));
  const dateInput = el('input', { type: 'date', 'data-testid': 'field-date', 'aria-label': t.date });
  const noteInput = el('textarea', { rows: '2', 'data-testid': 'field-note', 'aria-label': t.note });

  grid.append(
    mkField('name', t.name, true, nameInput),
    mkField('company', t.company, false, companyInput),
    mkField('phone', t.phone, true, phoneInput),
    mkField('email', t.email, false, emailInput),
    mkField('region', t.region, false, region),
    mkField('level', t.level, false, levelSelect),
    mkField('date', t.date, false, dateInput),
    mkField('note', t.note, false, noteInput, true),
  );
  form.append(grid);

  const submitBtn = el('button', { type: 'submit', class: 'btn-primary', 'data-testid': 'submit' }, [t.submit]);
  const resetBtn = el('button', { type: 'button', class: 'btn-ghost' }, [t.reset]);
  form.append(el('div', { class: 'actions' }, [submitBtn, resetBtn]));
  container.append(form);

  // list
  const listCard = el('div', { class: 'card' });
  listCard.append(el('h2', {}, [t.list]));
  const listEl = el('div', { id: 'customer-list' });
  listCard.append(listEl);
  container.append(listCard);

  let customers: Customer[] = [...t.seed];
  const renderList = () => {
    listEl.innerHTML = '';
    if (customers.length === 0) {
      listEl.append(el('div', { class: 'muted-note' }, [t.empty]));
      return;
    }
    for (const c of customers) {
      const row = el('div', { class: 'record-row', 'data-testid': 'record-row' }, [
        el('span', { class: 'name' }, [c.name]),
        el('span', { class: 'muted' }, [c.phone]),
        el('span', { class: 'muted' }, [c.email]),
      ]);
      if (c.region) row.append(el('span', { class: 'pill' }, [c.region]));
      if (c.note) row.append(el('span', { class: 'muted', style: 'margin-left:auto' }, [c.note]));
      listEl.append(row);
    }
  };
  renderList();

  const clearErr = () => grid.querySelectorAll('.field-error').forEach(e => ((e as HTMLElement).style.display = 'none'));
  const showErr = (id: string, msg: string) => {
    const e = document.getElementById(`err-${id}`)!;
    e.textContent = msg;
    e.style.display = 'block';
  };

  let flaky = 0;
  resetBtn.addEventListener('click', () => {
    form.reset();
    clearErr();
    const ph = region.querySelector('.ant-select-selection-item, .ant-select-selection-placeholder')!;
    ph.className = 'ant-select-selection-placeholder';
    ph.textContent = '—';
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    clearErr();
    let ok = true;
    if (!nameInput.value.trim()) {
      showErr('name', t.required);
      ok = false;
    }
    if (!phoneInput.value.trim()) {
      showErr('phone', t.required);
      ok = false;
    }
    if (emailInput.value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailInput.value)) {
      showErr('email', t.invalidEmail);
      ok = false;
    }
    if (!ok) return;

    const record: Customer = {
      name: nameInput.value.trim(),
      company: companyInput.value.trim(),
      phone: phoneInput.value.trim(),
      email: emailInput.value.trim(),
      region: (region as unknown as { getValue: () => string }).getValue(),
      level: levelSelect.value,
      date: dateInput.value,
      note: noteInput.value.trim(),
    };

    const commit = () => {
      toast(t.success);
      if (inject !== 'fakeSuccess') {
        customers = [record, ...customers];
        renderList();
      }
      form.reset();
      const ph = region.querySelector('.ant-select-selection-item, .ant-select-selection-placeholder')!;
      ph.className = 'ant-select-selection-placeholder';
      ph.textContent = '—';
    };

    if (inject === 'slow') {
      submitBtn.setAttribute('disabled', 'true');
      await new Promise(r => setTimeout(r, 1400));
      submitBtn.removeAttribute('disabled');
      commit();
    } else if (inject === 'flaky') {
      flaky++;
      if (flaky % 2 === 1) return; // transient drop; healing should retry
      commit();
    } else {
      commit();
    }
  });
}

const { lang, inject } = params();
document.title = `${T[lang].title} · Acme`;
render(lang, inject);

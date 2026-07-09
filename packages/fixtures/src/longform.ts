import './styles.css';
import { el, params, toast, topbar, type Lang } from './common';

const T = {
  zh: {
    title: '超长表单',
    sub: '这个表单很长，很多字段在首屏之外。语义感知应无需滚动即可定位它们。',
    submit: '提交',
    success: '提交成功',
    fields: ['公司名称', '统一社会信用代码', '注册地址', '法人代表', '注册资本', '成立日期', '经营范围', '开户银行', '银行账号', '联系人', '联系电话', '电子邮箱', '发票抬头', '税号', '收货地址', '备注说明'],
    target: '发票抬头',
  },
  en: {
    title: 'Long form',
    sub: 'This form is long; many fields are below the fold. Semantic perception should locate them without scrolling.',
    submit: 'Submit',
    success: 'Submitted',
    fields: ['Company name', 'Unified credit code', 'Registered address', 'Legal rep', 'Registered capital', 'Founded date', 'Business scope', 'Bank', 'Bank account', 'Contact', 'Phone', 'Email', 'Invoice title', 'Tax number', 'Shipping address', 'Remarks'],
    target: 'Invoice title',
  },
} as const;

const { lang, inject } = params();
const t = T[lang];
document.title = `${t.title} · Acme`;
const app = document.getElementById('app')!;
app.append(topbar('longform.html', lang));
const c = el('div', { class: 'container' });
const form = el('form', { class: 'card', novalidate: 'true' });
form.append(el('h1', {}, [t.title]), el('p', { class: 'sub' }, [t.sub]));

t.fields.forEach((label, i) => {
  const id = `f${i}`;
  const control = i === 6 || i === 15 ? el('textarea', { rows: '3', 'data-testid': id, 'aria-label': label }) : el('input', { type: 'text', 'data-testid': id, 'aria-label': label });
  form.append(el('div', { class: 'form-item', 'data-field': id, style: 'margin-bottom:18px' }, [el('label', {}, [label]), control]));
});

const status = el('div', { id: 'status' });
const submit = el('button', { type: 'submit', class: 'btn-primary', 'data-testid': 'submit' }, [t.submit]);
form.append(el('div', { class: 'actions' }, [submit]), status);
c.append(form);
app.append(c);

form.addEventListener('submit', e => {
  e.preventDefault();
  if (inject !== 'fakeSuccess') {
    toast(t.success);
    status.innerHTML = '';
    status.append(el('div', { class: 'record-row', role: 'status', 'data-role': 'longform-done' }, [el('span', { class: 'name' }, [t.success])]));
  } else {
    toast(t.success);
  }
});

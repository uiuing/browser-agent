import './styles.css';
import { el, params, toast, topbar, type Lang } from './common';

const T = {
  zh: {
    title: '多步向导',
    steps: ['基本信息', '联系方式', '确认提交'],
    fields: { name: '项目名称', owner: '负责人', phone: '联系电话', email: '邮箱' },
    prev: '上一步',
    next: '下一步',
    submit: '提交',
    success: '提交成功',
    review: '请确认信息无误后提交。',
  },
  en: {
    title: 'Multi-step wizard',
    steps: ['Basics', 'Contact', 'Confirm'],
    fields: { name: 'Project name', owner: 'Owner', phone: 'Phone', email: 'Email' },
    prev: 'Back',
    next: 'Next',
    submit: 'Submit',
    success: 'Submitted',
    review: 'Please review and submit.',
  },
} as const;

const { lang } = params();
const t = T[lang];
document.title = `${t.title} · Acme`;
const app = document.getElementById('app')!;
app.append(topbar('wizard.html', lang));
const c = el('div', { class: 'container', style: 'max-width:560px' });
const card = el('div', { class: 'card' });
card.append(el('h1', {}, [t.title]));

const stepper = el('div', { style: 'display:flex;gap:8px;margin-bottom:16px', 'data-testid': 'stepper' });
const stepEls = t.steps.map((s, i) =>
  el('div', { class: 'pill', 'data-step': String(i) }, [`${i + 1}. ${s}`]),
);
stepper.append(...stepEls);
card.append(stepper);

const data = { name: '', owner: '', phone: '', email: '' };
const body = el('div', { id: 'wizard-body' });
card.append(body);

const prevBtn = el('button', { class: 'btn-ghost', 'data-testid': 'prev' }, [t.prev]);
const nextBtn = el('button', { class: 'btn-primary', 'data-testid': 'next' }, [t.next]);
card.append(el('div', { class: 'actions' }, [prevBtn, nextBtn]));
c.append(card);
app.append(c);

let step = 0;

function input(id: keyof typeof data, label: string, type = 'text') {
  const i = el('input', { type, 'data-testid': `field-${id}`, 'aria-label': label, value: data[id] });
  i.addEventListener('input', () => (data[id] = i.value));
  return el('div', { class: 'form-item' }, [el('label', {}, [label]), i]);
}

function render() {
  stepEls.forEach((e, i) => (e.style.background = i === step ? '#2563eb' : '#eef2ff'));
  stepEls.forEach((e, i) => (e.style.color = i === step ? '#fff' : '#2563eb'));
  body.innerHTML = '';
  if (step === 0) {
    body.append(input('name', t.fields.name), input('owner', t.fields.owner));
  } else if (step === 1) {
    body.append(input('phone', t.fields.phone, 'tel'), input('email', t.fields.email, 'email'));
  } else {
    body.append(
      el('p', { class: 'sub' }, [t.review]),
      el('pre', { 'data-testid': 'review', class: 'muted-note', style: 'background:#0f172a08;padding:12px;border-radius:8px' }, [JSON.stringify(data, null, 2)]),
    );
  }
  prevBtn.style.display = step === 0 ? 'none' : 'inline-flex';
  nextBtn.textContent = step === t.steps.length - 1 ? t.submit : t.next;
}

prevBtn.addEventListener('click', () => {
  if (step > 0) step--;
  render();
});
nextBtn.addEventListener('click', () => {
  if (step < t.steps.length - 1) {
    step++;
    render();
  } else {
    toast(t.success);
    card.append(el('div', { class: 'record-row', role: 'status', 'data-role': 'wizard-done' }, [el('span', { class: 'name' }, [t.success])]));
  }
});
render();

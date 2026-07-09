import './styles.css';
import { el, params, toast, topbar, type Lang } from './common';

const T = {
  zh: { title: '登录', sub: '登录到 Acme 后台。', user: '用户名', pass: '密码', submit: '登录', ok: '登录成功', welcome: '欢迎回来', err: '用户名或密码不能为空' },
  en: { title: 'Login', sub: 'Sign in to Acme Console.', user: 'Username', pass: 'Password', submit: 'Sign in', ok: 'Signed in', welcome: 'Welcome back', err: 'Username and password are required' },
} as const;

const { lang } = params();
const t = T[lang];
document.title = `${t.title} · Acme`;
const app = document.getElementById('app')!;
app.append(topbar('login.html', lang));
const c = el('div', { class: 'container', style: 'max-width:420px' });
const card = el('div', { class: 'card' });
card.append(el('h1', {}, [t.title]), el('p', { class: 'sub' }, [t.sub]));

const user = el('input', { type: 'text', 'data-testid': 'field-username', 'aria-label': t.user });
const pass = el('input', { type: 'password', 'data-testid': 'field-password', 'aria-label': t.pass });
const err = el('div', { class: 'field-error', id: 'login-err' });
err.style.display = 'none';
const btn = el('button', { type: 'submit', class: 'btn-primary', 'data-testid': 'submit' }, [t.submit]);
const form = el('form', { novalidate: 'true' }, [
  el('div', { class: 'form-item' }, [el('label', {}, [t.user]), user]),
  el('div', { class: 'form-item' }, [el('label', {}, [t.pass]), pass]),
  err,
  el('div', { class: 'actions' }, [btn]),
]);
const status = el('div', { id: 'session', style: 'margin-top:12px' });
card.append(form, status);
c.append(card);
app.append(c);

form.addEventListener('submit', e => {
  e.preventDefault();
  if (!user.value.trim() || !pass.value.trim()) {
    err.textContent = t.err;
    err.style.display = 'block';
    return;
  }
  err.style.display = 'none';
  toast(t.ok);
  status.innerHTML = '';
  status.append(el('div', { class: 'record-row', role: 'status', 'data-role': 'session' }, [el('span', { class: 'name' }, [`${t.welcome}, ${user.value.trim()}`])]));
});

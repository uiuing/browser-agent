import './styles.css';
import { el, params, topbar, type Lang } from './common';

const T = {
  zh: { title: '含 iframe 的页面', sub: '下面的表单嵌在同源 iframe 中。Agent 应能穿透同源 iframe 定位并填写。', outer: '外层字段', memo: '外层备注' },
  en: { title: 'Page with iframe', sub: 'The form below lives in a same-origin iframe. The agent should see into same-origin iframes.', outer: 'Outer field', memo: 'Outer memo' },
} as const;

const { lang } = params();
const t = T[lang];
document.title = `${t.title} · Acme`;
const app = document.getElementById('app')!;
app.append(topbar('iframe.html', lang));
const c = el('div', { class: 'container' });
const card = el('div', { class: 'card' });
card.append(el('h1', {}, [t.title]), el('p', { class: 'sub' }, [t.sub]));
card.append(el('div', { class: 'form-item' }, [el('label', {}, [t.outer]), el('input', { type: 'text', 'data-testid': 'field-outer', 'aria-label': t.outer })]));

const frame = el('iframe', { id: 'billing', title: 'billing', style: 'width:100%;height:360px;border:1px solid var(--border);border-radius:8px;margin-top:12px' });
card.append(frame);
c.append(card);
app.append(c);

const inner = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{font-family:'Inter','PingFang SC',system-ui;margin:0;padding:16px;background:#fff;color:#1c2024}
  .form-item{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
  label{font-weight:600;font-size:13px}
  input{height:36px;padding:0 12px;border:1px solid #e3e6ea;border-radius:8px}
  button{height:36px;padding:0 16px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-weight:600;cursor:pointer}
  .toast{margin-top:10px;color:#16a34a;font-weight:600}
</style></head><body>
  <h3 style="margin:0 0 10px">${lang === 'en' ? 'Billing (in iframe)' : '账单（iframe 内）'}</h3>
  <div class="form-item"><label>${lang === 'en' ? 'Invoice title' : '发票抬头'}</label>
    <input type="text" data-testid="field-invoice" aria-label="${lang === 'en' ? 'Invoice title' : '发票抬头'}"></div>
  <div class="form-item"><label>${lang === 'en' ? 'Tax number' : '税号'}</label>
    <input type="text" data-testid="field-tax" aria-label="${lang === 'en' ? 'Tax number' : '税号'}"></div>
  <button type="button" data-testid="submit" id="save">${lang === 'en' ? 'Save' : '保存'}</button>
  <div id="msg"></div>
  <script>
    document.getElementById('save').addEventListener('click', function(){
      var m = document.getElementById('msg');
      m.className='toast'; m.setAttribute('role','status'); m.textContent = '\u2713 ${lang === 'en' ? 'Saved' : '已保存'}';
    });
  <\/script>
</body></html>`;

frame.addEventListener('load', () => {
  const doc = frame.contentDocument;
  if (doc) {
    doc.open();
    doc.write(inner);
    doc.close();
  }
});
// trigger load for srcdoc-less iframe
frame.setAttribute('src', 'about:blank');

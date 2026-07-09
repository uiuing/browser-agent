import './styles.css';
import { el, params, topbar, type Lang } from './common';

const T = {
  zh: { title: '动态列表', sub: '异步加载数据；支持分页与无限滚动。', load: '加载数据', more: '加载更多', loading: '加载中…', done: '没有更多了', order: '订单', amount: '金额' },
  en: { title: 'Dynamic list', sub: 'Async-loaded data with pagination and infinite scroll.', load: 'Load data', more: 'Load more', loading: 'Loading…', done: 'No more', order: 'Order', amount: 'Amount' },
} as const;

const { lang, inject } = params();
const t = T[lang];
document.title = `${t.title} · Acme`;
const app = document.getElementById('app')!;
app.append(topbar('list.html', lang));
const c = el('div', { class: 'container' });
const card = el('div', { class: 'card' });
card.append(el('h1', {}, [t.title]), el('p', { class: 'sub' }, [t.sub]));
const listEl = el('div', { id: 'order-list' });
const status = el('div', { class: 'muted-note', id: 'list-status' });
const loadBtn = el('button', { class: 'btn-primary', 'data-testid': 'load' }, [t.load]);
const moreBtn = el('button', { class: 'btn-ghost', 'data-testid': 'load-more' }, [t.more]);
moreBtn.style.display = 'none';
card.append(listEl, status, el('div', { class: 'actions' }, [loadBtn, moreBtn]));
c.append(card);
app.append(c);

let page = 0;
const pageSize = 8;
const maxPages = 4;
const delay = inject === 'slow' ? 1200 : 350;

function addRows(n: number) {
  for (let i = 0; i < n; i++) {
    const id = page * pageSize + i + 1;
    listEl.append(
      el('div', { class: 'record-row order-row', 'data-testid': 'order-row' }, [
        el('span', { class: 'name' }, [`${t.order} #${1000 + id}`]),
        el('span', { class: 'muted' }, [`${t.amount} ¥${(id * 137) % 5000}`]),
        el('span', { class: 'pill' }, [id % 2 ? 'PAID' : 'PENDING']),
      ]),
    );
  }
}

async function loadPage() {
  status.textContent = t.loading;
  loadBtn.setAttribute('disabled', 'true');
  moreBtn.setAttribute('disabled', 'true');
  await new Promise(r => setTimeout(r, delay));
  addRows(pageSize);
  page++;
  status.textContent = page >= maxPages ? t.done : '';
  loadBtn.style.display = 'none';
  loadBtn.removeAttribute('disabled');
  moreBtn.removeAttribute('disabled');
  moreBtn.style.display = page >= maxPages ? 'none' : 'inline-flex';
}

loadBtn.addEventListener('click', loadPage);
moreBtn.addEventListener('click', loadPage);

// infinite scroll
window.addEventListener('scroll', () => {
  if (page === 0 || page >= maxPages) return;
  if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 40) void loadPage();
});

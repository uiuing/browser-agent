import './styles.css';
import { el, params, toast, topbar, type Lang } from './common';

const T = {
  zh: {
    title: '新建商品',
    sub: '录入商品信息。价格与库存需为数字。',
    fields: { title: '商品名', category: '分类', price: '价格', stock: '库存', desc: '描述' },
    categories: ['外设', '显示', '配件', '整机'],
    submit: '提交',
    reset: '重置',
    list: '商品列表',
    empty: '暂无商品',
    success: '商品创建成功',
    required: '此项为必填',
    number: '请输入数字',
    seed: [{ title: '人体工学椅', category: '整机', price: '899', stock: '40', desc: '仓库现货' }],
  },
  en: {
    title: 'New product',
    sub: 'Enter product details. Price and stock must be numbers.',
    fields: { title: 'Product', category: 'Category', price: 'Price', stock: 'Stock', desc: 'Description' },
    categories: ['Peripherals', 'Display', 'Accessories', 'Systems'],
    submit: 'Submit',
    reset: 'Reset',
    list: 'Products',
    empty: 'No products yet',
    success: 'Product created',
    required: 'This field is required',
    number: 'Enter a number',
    seed: [{ title: 'Ergonomic chair', category: 'Systems', price: '899', stock: '40', desc: 'In stock' }],
  },
} as const;

interface Product {
  title: string;
  category: string;
  price: string;
  stock: string;
  desc: string;
}

const { lang, inject } = params();
const t = T[lang];
document.title = `${t.title} · Acme`;
const app = document.getElementById('app')!;
app.append(topbar('product.html', lang));
const c = el('div', { class: 'container' });
app.append(c);

const form = el('form', { class: 'card', novalidate: 'true' });
form.append(el('h1', {}, [t.title]), el('p', { class: 'sub' }, [t.sub]));
const grid = el('div', { class: 'form-grid' });

const titleInput = el('input', { type: 'text', 'data-testid': 'field-title', 'aria-label': t.fields.title });
const catSelect = el('select', { 'data-testid': 'field-category', 'aria-label': t.fields.category });
catSelect.append(el('option', { value: '' }, ['—']), ...t.categories.map(x => el('option', { value: x }, [x])));
const priceInput = el('input', { type: 'text', 'data-testid': 'field-price', 'aria-label': t.fields.price });
const stockInput = el('input', { type: 'text', 'data-testid': 'field-stock', 'aria-label': t.fields.stock });
const descInput = el('textarea', { rows: '2', 'data-testid': 'field-desc', 'aria-label': t.fields.desc });

const field = (id: string, label: string, req: boolean, control: HTMLElement, full = false) => {
  const item = el('div', { class: `form-item${full ? ' full' : ''}`, 'data-field': id });
  const l = el('label', {}, [label]);
  if (req) l.append(el('span', { class: 'req' }, [' *']));
  const err = el('div', { class: 'field-error', id: `err-${id}` });
  err.style.display = 'none';
  item.append(l, control, err);
  return item;
};

grid.append(
  field('title', t.fields.title, true, titleInput),
  field('category', t.fields.category, false, catSelect),
  field('price', t.fields.price, true, priceInput),
  field('stock', t.fields.stock, true, stockInput),
  field('desc', t.fields.desc, false, descInput, true),
);
form.append(grid);
const submitBtn = el('button', { type: 'submit', class: 'btn-primary', 'data-testid': 'submit' }, [t.submit]);
form.append(el('div', { class: 'actions' }, [submitBtn]));
c.append(form);

const listCard = el('div', { class: 'card' });
listCard.append(el('h2', {}, [t.list]));
const listEl = el('div', { id: 'product-list' });
listCard.append(listEl);
c.append(listCard);

let products: Product[] = [...t.seed];
const render = () => {
  listEl.innerHTML = '';
  if (!products.length) return void listEl.append(el('div', { class: 'muted-note' }, [t.empty]));
  for (const p of products) {
    listEl.append(
      el('div', { class: 'record-row', 'data-testid': 'record-row' }, [
        el('span', { class: 'name' }, [p.title]),
        el('span', { class: 'pill' }, [p.category || '—']),
        el('span', { class: 'muted' }, [`¥${p.price}`]),
        el('span', { class: 'muted' }, [`x${p.stock}`]),
      ]),
    );
  }
};
render();

form.addEventListener('submit', e => {
  e.preventDefault();
  grid.querySelectorAll('.field-error').forEach(x => ((x as HTMLElement).style.display = 'none'));
  let ok = true;
  const showErr = (id: string, msg: string) => {
    const el2 = document.getElementById(`err-${id}`)!;
    el2.textContent = msg;
    el2.style.display = 'block';
    ok = false;
  };
  if (!titleInput.value.trim()) showErr('title', t.required);
  if (!priceInput.value.trim()) showErr('price', t.required);
  else if (isNaN(Number(priceInput.value))) showErr('price', t.number);
  if (!stockInput.value.trim()) showErr('stock', t.required);
  else if (isNaN(Number(stockInput.value))) showErr('stock', t.number);
  if (!ok) return;
  toast(t.success);
  if (inject !== 'fakeSuccess') {
    products = [{ title: titleInput.value.trim(), category: catSelect.value, price: priceInput.value.trim(), stock: stockInput.value.trim(), desc: descInput.value.trim() }, ...products];
    render();
  }
  form.reset();
});

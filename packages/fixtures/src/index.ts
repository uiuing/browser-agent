import './styles.css';
import { el, params, topbar, type Lang } from './common';

const T = {
  zh: {
    title: 'Acme 后台 · 测试站',
    sub: '这是一组供浏览器 Agent 真实操作的后台页面。每页支持 ?inject=slow|flaky|fakeSuccess 与 ?lang=zh|en。',
    pages: [
      ['login.html', '登录页', '演示登录态与表单校验'],
      ['customer.html', '新建客户', '必填校验、自定义下拉、成功 toast、列表 +1'],
      ['product.html', '新建商品', '价格/库存数字校验、分类下拉'],
      ['controls.html', '自定义控件', 'Ant 下拉 / 日期 / 级联 / 多选 / 文件上传'],
      ['list.html', '动态列表', '异步加载 + 分页 + 无限滚动'],
      ['wizard.html', '多步向导', '上一步 / 下一步 / 提交'],
      ['iframe.html', '含 iframe 页面', '同源 iframe 内嵌表单'],
      ['longform.html', '超长表单', '屏幕外字段，不滚动也要能定位'],
    ],
  },
  en: {
    title: 'Acme Console · Fixtures',
    sub: 'A set of back-office pages for a browser agent to operate for real. Every page supports ?inject=slow|flaky|fakeSuccess and ?lang=zh|en.',
    pages: [
      ['login.html', 'Login', 'Session and form validation'],
      ['customer.html', 'New customer', 'Required checks, custom dropdown, success toast, list +1'],
      ['product.html', 'New product', 'Numeric price/stock checks, category dropdown'],
      ['controls.html', 'Custom controls', 'Ant select / date / cascader / multi / file upload'],
      ['list.html', 'Dynamic list', 'Async load + pagination + infinite scroll'],
      ['wizard.html', 'Multi-step wizard', 'Back / next / submit'],
      ['iframe.html', 'Iframe page', 'Same-origin embedded form'],
      ['longform.html', 'Long form', 'Off-screen fields located without scrolling'],
    ],
  },
} as const;

const { lang } = params();
const t = T[lang];
document.title = t.title;
const app = document.getElementById('app')!;
app.append(topbar('index.html', lang));
const c = el('div', { class: 'container' });
c.append(el('h1', {}, [t.title]), el('p', { class: 'sub' }, [t.sub]));
for (const [href, title, desc] of t.pages) {
  const card = el('a', { class: 'card', href: href + location.search, style: 'display:block;text-decoration:none;color:inherit' }, [
    el('h2', {}, [title]),
    el('p', { class: 'muted-note', style: 'margin:0' }, [desc]),
  ]);
  c.append(card);
}
app.append(c);

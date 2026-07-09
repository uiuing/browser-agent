import type { PageSnapshot, SemanticNode } from '../../engine/contracts/perception';
import type { LlmPlan } from '../../engine/contracts/plan';
import type { SemanticFingerprint } from '../../engine/contracts/grounding';
import type { PostCondition } from '../../engine/contracts/verification';

/**
 * Deterministic, no-API-key planner. It reads the real page snapshot and the task,
 * maps value hints to fields via semantic matching, and emits a fully-verified plan
 * (fills + submit + objective success criteria). This is what makes the entire
 * perceive→act→verify→heal→batch loop runnable offline and in CI.
 */

interface FieldHint {
  synonyms: string[];
  canonical: string;
}

const FIELD_HINTS: FieldHint[] = [
  { canonical: 'name', synonyms: ['姓名', '名字', '名称', '客户名', 'name', 'fullname', 'full name'] },
  { canonical: 'company', synonyms: ['公司', '企业', '单位', 'company', 'organization', 'org'] },
  { canonical: 'phone', synonyms: ['手机', '电话', '手机号', '联系电话', 'phone', 'tel', 'mobile'] },
  { canonical: 'email', synonyms: ['邮箱', '邮件', '电子邮件', 'email', 'mail', 'e-mail'] },
  { canonical: 'region', synonyms: ['区域', '地区', '所属区域', '大区', 'region', 'area', 'zone'] },
  { canonical: 'level', synonyms: ['等级', '级别', '客户等级', 'level', 'tier', 'grade'] },
  { canonical: 'date', synonyms: ['日期', '签约日期', '生效日期', 'date', 'signdate', 'effective'] },
  { canonical: 'note', synonyms: ['备注', '说明', '描述', '注释', 'note', 'remark', 'comment', 'memo'] },
  { canonical: 'price', synonyms: ['价格', '售价', '单价', 'price', 'amount'] },
  { canonical: 'stock', synonyms: ['库存', '数量', 'stock', 'qty', 'quantity', 'inventory'] },
  { canonical: 'title', synonyms: ['标题', '商品名', '名称', 'title', 'product'] },
  { canonical: 'category', synonyms: ['分类', '类目', '品类', 'category', 'type'] },
];

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

interface ParsedPair {
  hint: string;
  value: string;
}

/** Parse "label value" / "label：value" chunks separated by CJK/latin punctuation. */
export function parseAssignments(task: string): ParsedPair[] {
  const body = task.replace(/^[^，,：:]*(新建|创建|添加|录入|新增|create|add|new)[^，,：:]*[，,：:]?/i, '');
  const chunks = (body || task)
    .split(/[，,；;\n]+/)
    .map(s => s.trim())
    .filter(Boolean);
  const pairs: ParsedPair[] = [];
  for (const chunk of chunks) {
    // label：value or label value
    let matched = false;
    for (const fh of FIELD_HINTS) {
      for (const syn of fh.synonyms.sort((a, b) => b.length - a.length)) {
        const re = new RegExp(`^${syn}\\s*[:：]?\\s*(.+)$`, 'i');
        const m = chunk.match(re);
        if (m && m[1]) {
          pairs.push({ hint: fh.canonical, value: m[1].trim() });
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
    if (!matched && /[:：]/.test(chunk)) {
      const [k, ...rest] = chunk.split(/[:：]/);
      pairs.push({ hint: k.trim(), value: rest.join(':').trim() });
    }
  }
  return pairs;
}

function fingerprintOf(node: SemanticNode): SemanticFingerprint {
  const attrs: Record<string, string> = {};
  for (const k of ['id', 'name', 'data-testid', 'type', 'placeholder']) {
    if (node.attrs[k]) attrs[k] = node.attrs[k];
  }
  return {
    role: node.role,
    name: node.name || undefined,
    tag: node.tag,
    componentType: node.componentType,
    attrs: Object.keys(attrs).length ? attrs : undefined,
    anchors: node.anchors.length ? node.anchors : undefined,
    path: node.path,
    framePath: node.framePath,
  };
}

function matchField(hint: string, nodes: SemanticNode[]): SemanticNode | null {
  const fh = FIELD_HINTS.find(f => f.canonical === hint);
  const terms = fh ? [fh.canonical, ...fh.synonyms] : [hint];
  const fields = nodes.filter(n =>
    ['native-input', 'textarea', 'native-select', 'custom-select', 'datepicker', 'cascader', 'multiselect'].includes(
      n.componentType,
    ),
  );
  let best: { node: SemanticNode; score: number } | null = null;
  for (const node of fields) {
    const hay = norm(`${node.name} ${node.anchors.join(' ')} ${node.attrs['data-testid'] ?? ''} ${node.attrs['name'] ?? ''} ${node.attrs['placeholder'] ?? ''}`);
    let score = 0;
    for (const t of terms) {
      const nt = norm(t);
      if (!nt) continue;
      if (hay.includes(nt)) score = Math.max(score, nt.length >= 2 ? 1 : 0.5);
    }
    if (score > 0 && (!best || score > best.score)) best = { node, score };
  }
  return best?.node ?? null;
}

function findSubmit(nodes: SemanticNode[]): SemanticNode | null {
  const submitTerms = /(提交|保存|确定|创建|新增|添加|submit|save|create|confirm|add)/i;
  const buttons = nodes.filter(n => n.componentType === 'button' || n.role === 'button' || n.tag === 'button');
  return (
    buttons.find(b => submitTerms.test(b.name) && b.attrs['type'] === 'submit') ??
    buttons.find(b => submitTerms.test(b.name)) ??
    buttons.find(b => b.attrs['type'] === 'submit') ??
    null
  );
}

function guessListSelector(nodes: SemanticNode[]): string | null {
  // Prefer explicit data-role rows
  const dataRole = nodes.find(n => n.attrs['data-testid']?.includes('row') || n.attrs['id']?.includes('row'));
  if (dataRole?.attrs['data-testid']) return `[data-testid="${dataRole.attrs['data-testid']}"]`;

  // count class tokens that look like rows/items across nodes
  const counts = new Map<string, number>();
  for (const n of nodes) {
    const cls = n.attrs['class'] ?? '';
    for (const token of cls.split(/\s+/)) {
      if (/(row|item|record|card|list-)/i.test(token)) counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  let bestTok: string | null = null;
  let bestN = 1;
  counts.forEach((n, tok) => {
    if (n > bestN) {
      bestN = n;
      bestTok = tok;
    }
  });
  return bestTok ? `.${bestTok}` : null;
}

const TOAST_SELECTOR = '[role="status"],[role="alert"],.toast,.ant-message,.el-message,[data-role="toast"]';

export function planTask(task: string, snapshot: PageSnapshot): LlmPlan {
  const zh = /[\u4e00-\u9fff]/.test(task);
  const pairs = parseAssignments(task);
  const steps: LlmPlan['steps'] = [];
  const usedIds = new Set<number>();

  for (const pair of pairs) {
    const node = matchField(pair.hint, snapshot.nodes.filter(n => !usedIds.has(n.id)));
    if (!node) continue;
    usedIds.add(node.id);
    const fp = fingerprintOf(node);
    const isSelect = ['native-select', 'custom-select', 'datepicker', 'cascader', 'multiselect'].includes(
      node.componentType,
    );
    const expect: PostCondition[] = [{ kind: 'value_equals', target: { fingerprint: fp }, expected: pair.value }];
    steps.push({
      intent: zh ? `填写${node.name || pair.hint}：${pair.value}` : `Fill ${node.name || pair.hint}: ${pair.value}`,
      action: isSelect
        ? { type: 'setValue', target: { fingerprint: fp }, value: pair.value }
        : { type: 'fill', target: { fingerprint: fp }, value: pair.value },
      expect,
    });
  }

  const successCriteria: PostCondition[] = [];
  const listSel = guessListSelector(snapshot.nodes);
  const nameValue = pairs.find(p => p.hint === 'name' || p.hint === 'title')?.value;

  const submit = findSubmit(snapshot.nodes);
  if (submit) {
    const submitFp = fingerprintOf(submit);
    // Step-level expect: toast appears AND a new row is really added. list_count_delta
    // is what unmasks "fake success" — a toast with no new row fails delta +1.
    const expect: PostCondition[] = [{ kind: 'element_exists', fingerprint: { attrs: { selector: TOAST_SELECTOR } } }];
    if (listSel) expect.push({ kind: 'list_count_delta', list: { attrs: { selector: listSel } }, delta: 1 });
    steps.push({
      intent: zh ? `提交表单：${submit.name || '提交'}` : `Submit form: ${submit.name || 'submit'}`,
      action: { type: 'click', target: { fingerprint: submitFp } },
      expect,
      risk: 'dangerous',
    });
    // Durable end-state criteria (checked after all steps, no transient toast dependency).
    if (nameValue && listSel) {
      successCriteria.push({ kind: 'text_present', text: nameValue, within: { attrs: { selector: listSel } } });
    } else if (nameValue) {
      successCriteria.push({ kind: 'text_present', text: nameValue });
    }
  }

  return {
    summary: pairs.length ? `Fill ${pairs.length} field(s) and submit, verifying each value and the created record.` : 'Inspect the page.',
    steps,
    successCriteria,
  };
}

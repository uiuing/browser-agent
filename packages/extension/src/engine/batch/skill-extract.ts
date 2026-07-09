import type { RunRecord } from '../contracts/trace';
import type { Skill, SlotDef, SlotType } from '../contracts/skill';
import type { PlanStep } from '../contracts/plan';
import type { Action } from '../contracts/action';
import type { PostCondition } from '../contracts/verification';

function slugify(s: string): string {
  const base = s
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  return base || 'field';
}

function slotTypeFor(action: Action): SlotType {
  if (action.type === 'uploadFile') return 'file';
  if (action.type === 'setValue') return 'select';
  return 'text';
}

function labelFor(action: Action): string {
  if ('target' in action && action.target?.fingerprint) {
    const fp = action.target.fingerprint;
    return fp.name || fp.anchors?.[0] || fp.attrs?.name || fp.attrs?.id || 'field';
  }
  return 'field';
}

/**
 * Turn a successful run into a reusable, parameterized Skill. Every value that was
 * typed/selected/uploaded becomes a data slot; steps keep their fingerprints and
 * post-conditions so batch rows are still verified. This is the "教一次→批量跑" engine.
 */
export function extractSkill(
  run: RunRecord,
  meta: { name: string; description?: string; urlPattern?: string; id: string; now: string },
): Skill {
  const slots: SlotDef[] = [];
  const usedNames = new Set<string>();
  const valueToSlot = new Map<string, string>();

  const uniqueName = (base: string): string => {
    let n = base;
    let i = 2;
    while (usedNames.has(n)) n = `${base}_${i++}`;
    usedNames.add(n);
    return n;
  };

  const steps: PlanStep[] = (run.plan?.steps ?? run.steps.map(s => s.step)).map(step => {
    const action = structuredClone(step.action);
    let expect = structuredClone(step.expect);

    if ((action.type === 'fill' || action.type === 'setValue') && action.value) {
      const label = labelFor(action);
      const name = uniqueName(slugify(label));
      const value = action.value;
      slots.push({
        name,
        label,
        type: action.type === 'setValue' ? 'select' : /@|mail/i.test(label) ? 'text' : slotTypeFor(action),
        required: true,
        sensitive: action.type === 'fill' && !!action.sensitive,
        example: value,
      });
      action.value = `{{${name}}}`;
      valueToSlot.set(value, name);
      expect = expect.map(c => templatizeCondition(c, value, name));
    }
    if (action.type === 'uploadFile') {
      const name = uniqueName(slugify(action.file.name || 'file'));
      slots.push({ name, label: 'file', type: 'file', required: true, example: action.file.name });
      valueToSlot.set(action.file.name, name);
      action.file = { ...action.file, name: `{{${name}}}` };
    }

    return { ...step, action, expect };
  });

  // Templatize success criteria too, so batch rows verify against their own data
  // (e.g. "text_present <name>" becomes "text_present {{name}}").
  const successCriteria: PostCondition[] = structuredClone(run.plan?.successCriteria ?? []).map(c => {
    let out = c;
    for (const [value, slot] of valueToSlot) out = templatizeCondition(out, value, slot);
    return out;
  });

  return {
    id: meta.id,
    name: meta.name,
    description: meta.description ?? run.instruction ?? meta.name,
    urlPattern: meta.urlPattern ?? originOf(run.url),
    slots,
    steps,
    successCriteria,
    createdAt: meta.now,
    updatedAt: meta.now,
    runCount: 0,
    version: 1,
  };
}

function templatizeCondition(cond: PostCondition, value: string, slot: string): PostCondition {
  const clone = structuredClone(cond);
  if ('expected' in clone && clone.expected === value) clone.expected = `{{${slot}}}`;
  if ('text' in clone && clone.text === value) clone.text = `{{${slot}}}`;
  return clone;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin + '/*';
  } catch {
    return url;
  }
}

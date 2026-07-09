import type { Skill, SlotDef } from '../contracts/skill';
import type { Plan, PlanStep } from '../contracts/plan';
import type { Action } from '../contracts/action';
import type { PostCondition } from '../contracts/verification';

// Slot names may contain CJK (derived from Chinese field labels), so the token class
// must include the CJK range, not just ASCII \w.
const TEMPLATE_RE = /\{\{\s*([\w\u4e00-\u9fa5.-]+)\s*\}\}/g;

export function fillTemplate(input: string, data: Record<string, string>): string {
  return input.replace(TEMPLATE_RE, (_m, key: string) => data[key] ?? '');
}

function bindAction(action: Action, data: Record<string, string>): Action {
  const clone = structuredClone(action);
  if ('value' in clone && typeof clone.value === 'string') clone.value = fillTemplate(clone.value, data);
  if (clone.type === 'navigate') clone.url = fillTemplate(clone.url, data);
  if (clone.type === 'uploadFile') {
    clone.file = { ...clone.file, name: fillTemplate(clone.file.name, data), contentText: clone.file.contentText ? fillTemplate(clone.file.contentText, data) : clone.file.contentText };
  }
  return clone;
}

function bindCondition(cond: PostCondition, data: Record<string, string>): PostCondition {
  const clone = structuredClone(cond);
  if ('expected' in clone && typeof clone.expected === 'string') clone.expected = fillTemplate(clone.expected, data);
  if ('text' in clone && typeof clone.text === 'string') clone.text = fillTemplate(clone.text, data);
  if ('pattern' in clone && typeof clone.pattern === 'string') clone.pattern = fillTemplate(clone.pattern, data);
  return clone;
}

function bindStep(step: PlanStep, data: Record<string, string>): PlanStep {
  return {
    ...step,
    intent: fillTemplate(step.intent, data),
    action: bindAction(step.action, data),
    expect: step.expect.map(c => bindCondition(c, data)),
  };
}

/** Produce a concrete, executable Plan for a skill + a row of data. */
export function bindSkill(skill: Skill, data: Record<string, string>): Plan {
  return {
    summary: fillTemplate(skill.description || skill.name, data),
    steps: skill.steps.map(s => bindStep(s, data)),
    successCriteria: skill.successCriteria.map(c => bindCondition(c, data)),
  };
}

export function validateRow(skill: Skill, data: Record<string, string>): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const slot of skill.slots) {
    if (slot.required && !(`${data[slot.name] ?? ''}`.trim())) missing.push(slot.name);
  }
  return { ok: missing.length === 0, missing };
}

export type { SlotDef };

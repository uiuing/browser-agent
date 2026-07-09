import type { Plan, PlanStep } from '../contracts/plan';
import type { PageSnapshot } from '../contracts/perception';
import type { TraceEvent } from '../contracts/trace';
import type { Action } from '../contracts/action';

export interface PlanRequest {
  task: string;
  snapshot: PageSnapshot;
  url: string;
  /** optional replan context: what failed previously */
  failureContext?: string;
}

export interface Planner {
  readonly id: string;
  plan(req: PlanRequest): Promise<Plan>;
}

export interface Confirmer {
  /** returns true to proceed, false to abort. */
  confirm(step: PlanStep, reason: string): Promise<boolean>;
}

export type SecurityDecision = { allowed: true } | { allowed: false; reason: string } | { needsConfirm: true; reason: string };

export interface SecurityGate {
  check(action: Action, url: string): SecurityDecision;
}

export interface TraceSink {
  emit(event: Omit<TraceEvent, 'id' | 'seq' | 'ts'>): void;
}

export interface RunHooks {
  /** live step record updates for UI streaming */
  onUpdate?: (partial: { runId: string }) => void;
  signal?: AbortSignal;
}

export interface OrchestratorDeps {
  trace: TraceSink;
  security?: SecurityGate;
  confirmer?: Confirmer;
}

export const DEFAULT_BUDGET = {
  stepRetries: 3,
  runHealingBudget: 12,
  verifyTimeoutMs: 4000,
};
export type Budget = typeof DEFAULT_BUDGET;

export function isPlanReusable(plan: Plan): boolean {
  return plan.steps.length > 0;
}

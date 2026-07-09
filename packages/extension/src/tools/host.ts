import type { Bridge } from '../engine/contracts/bridge';
import type { PlanStep } from '../engine/contracts/plan';
import type { Planner } from '../engine/orchestrator/types';
import type { Decider } from '../engine/contracts/agent';
import type { Skill } from '../engine/contracts/skill';
import type { RunRecord } from '../engine/contracts/trace';
import type { BatchRun } from '../engine/contracts/batch';
import type { Settings } from '../storage/types';

export interface AcquiredBridge {
  bridge: Bridge;
  tabId: number;
  url: string;
  title: string;
  dispose: () => void;
}

/**
 * Host services the built-in tool packs need from the app shell. The UI store
 * implements this once; tools stay free of zustand/react so the community can
 * unit-test them against a stub host.
 */
export interface ToolHost {
  /** Task-aware tab routing + content-script injection + follow new tabs. */
  acquireBridge(task?: string): Promise<AcquiredBridge>;
  getSettings(): Settings;
  /** Closed-loop decider (real models). Null in mock builds → compiled-plan path. */
  getDecider(): Decider | null;
  getPlanner(): Planner;
  /** Per-action confirmation inside page_act (the engine's dangerous-action gate). */
  confirmAction(step: PlanStep, reason: string): Promise<boolean>;
  /** Persist a finished run + its trace and refresh dependent UI lists. */
  persistRun(run: RunRecord, events: unknown[]): Promise<void>;
  persistBatch(batch: BatchRun): Promise<void>;
  listSkills(): Promise<Skill[]>;
}

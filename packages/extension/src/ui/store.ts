import { create } from 'zustand';
import type { Settings, ProviderState, SessionMeta } from '../storage/types';
import { DEFAULT_SETTINGS } from '../storage/types';
import {
  settingsRepo,
  providersRepo,
  skillsRepo,
  runsRepo,
  batchRepo,
  tracesRepo,
  sessionsRepo,
} from '../storage/repos';
import type { Skill } from '../engine/contracts/skill';
import type { RunRecord, TraceEvent } from '../engine/contracts/trace';
import type { BatchRun } from '../engine/contracts/batch';
import type { PlanStep } from '../engine/contracts/plan';
import { Orchestrator, RunAborted } from '../engine/orchestrator/run';
import { BatchRunner, computeStats } from '../engine/batch/batch-runner';
import { extractSkill } from '../engine/batch/skill-extract';
import { TraceBus } from '../trace/trace-bus';
import { createSecurityGate } from '../guardrails/security';
import { createPlanner, type ResolvedPlanner } from '../llm/router';
import { Kernel } from '../kernel/loop';
import type {
  ChatSession,
  ChatMessage,
  UserMessage,
} from '../kernel/contracts/session';
import { ToolRegistry } from '../tools/registry';
import type { ToolHost, AcquiredBridge } from '../tools/host';
import { createPageTools } from '../tools/page';
import { createTabTools } from '../tools/tabs';
import { createBrowserTools } from '../tools/browser';
import { createSkillTools } from '../tools/skills';
import { mountMcpServer, unmountMcpServer } from '../tools/mcp/mount';
import { createTranslator } from './i18n';
import type { Locale } from './i18n';
import {
  createActiveTabBridge,
  getActiveTab,
  connectAgent,
  listOperableTabs,
  routeTask,
  focusTab,
  followNewTabs,
  type ActiveTab,
} from './engine/active-tab-bridge';

export interface ConfirmPrompt {
  /** What is being confirmed (step intent or tool id). */
  title: string;
  reason: string;
  resolve: (proceed: boolean) => void;
}

export interface PermissionPrompt {
  permissions: string[];
  resolve: (granted: boolean) => void;
}

interface AppState {
  ready: boolean;
  settings: Settings;
  providerState: ProviderState;
  skills: Skill[];
  runs: RunRecord[];
  batches: BatchRun[];

  targetTab: ActiveTab;

  /* chat */
  sessions: SessionMeta[];
  activeSession: ChatSession | null;
  isChatting: boolean;

  /* legacy run surfaces (skills / batch pages) */
  activeRun: RunRecord | null;
  liveTrace: TraceEvent[];
  isRunning: boolean;

  confirmPrompt: ConfirmPrompt | null;
  permissionPrompt: PermissionPrompt | null;
  /** Label of the resolved model, or null when nothing is configured. */
  plannerLabel: string | null;

  t: (path: string, vars?: Record<string, string | number>) => string;

  init: () => Promise<void>;
  refreshTargetTab: () => Promise<void>;

  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  reloadProviders: () => Promise<void>;
  reloadSkills: () => Promise<void>;
  reloadRuns: () => Promise<void>;
  reloadBatches: () => Promise<void>;

  /* chat actions */
  sendMessage: (text: string) => Promise<void>;
  stopChat: () => void;
  newSession: () => void;
  openSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  reloadSessions: () => Promise<void>;
  remountMcp: () => Promise<void>;
  /** Registered tools for the Options permission panel. */
  listRegisteredTools: () => Array<{
    id: string;
    riskTier: string;
    requiredPermissions?: string[];
  }>;

  resolveConfirm: (proceed: boolean) => void;
  resolvePermission: (granted: boolean) => void;

  saveRunAsSkill: (run: RunRecord, name: string) => Promise<Skill>;
  runSkillOnce: (
    skill: Skill,
    data: Record<string, string>,
  ) => Promise<RunRecord | null>;
  startBatch: (
    batch: BatchRun,
    skill: Skill,
    onlyIndices?: number[],
  ) => Promise<BatchRun>;

  applyTheme: () => void;
}

let abortController: AbortController | null = null;
let chatAbort: AbortController | null = null;

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useStore = create<AppState>((set, get) => {
  /** Resolve the model or throw the localized "connect a model first" error. */
  const requirePlanner = (): ResolvedPlanner => {
    const { providerState } = get();
    const resolved = createPlanner({
      providers: providerState.providers,
      defaultProviderId: providerState.defaultProviderId,
    });
    if (!resolved) throw new Error(get().t('chat.notConfigured'));
    return resolved;
  };

  /**
   * Resolve the right tab for this task — across ALL windows, no user picking —
   * connect a bridge to it (injecting the content script on demand), bring it
   * into view, and follow the work if it opens new tabs mid-run.
   */
  const acquireBridge = async (task?: string): Promise<AcquiredBridge> => {
    const tabs = await listOperableTabs();
    const { tab } = routeTask(task ?? '', tabs);
    if (!tab) throw new Error(get().t('chat.noTabHint'));
    set({
      targetTab: {
        tabId: tab.tabId,
        windowId: tab.windowId,
        url: tab.url,
        title: tab.title,
      },
    });

    const bridge = createActiveTabBridge(tab.tabId, get().settings.channel);
    if (!(await connectAgent(tab.tabId, bridge)))
      throw new Error(get().t('chat.cannotReach'));
    await focusTab(tab.tabId, tab.windowId);

    const unfollow = followNewTabs(bridge, (followed) =>
      set({ targetTab: followed }),
    );
    return {
      bridge,
      tabId: tab.tabId,
      url: tab.url,
      title: tab.title,
      dispose: unfollow,
    };
  };

  /* ---------------- tool host + registry (the harness assembly) ---------------- */

  const host: ToolHost = {
    acquireBridge,
    getSettings: () => get().settings,
    getDecider: () => requirePlanner().decider,
    getPlanner: () => requirePlanner().planner,
    confirmAction: (step: PlanStep, reason: string) =>
      new Promise<boolean>((resolve) =>
        set({ confirmPrompt: { title: step.intent, reason, resolve } }),
      ),
    persistRun: async (run, events) => {
      await runsRepo.save(run);
      await tracesRepo.append(run.id, events as TraceEvent[]);
      await get().reloadRuns();
    },
    persistBatch: async (batch) => {
      await batchRepo.save(batch);
      await get().reloadBatches();
    },
    listSkills: () => skillsRepo.list(),
  };

  const registry = new ToolRegistry();
  for (const tool of [
    ...createPageTools(host),
    ...createTabTools(),
    ...createBrowserTools(),
    ...createSkillTools(host),
  ]) {
    registry.register(tool);
  }

  const mountedMcpIds = new Set<string>();
  const syncMcpMounts = async (): Promise<void> => {
    const { mcpServers } = get().settings;
    for (const server of mcpServers) {
      if (server.enabled && !mountedMcpIds.has(server.id)) {
        try {
          await mountMcpServer(registry, server);
          mountedMcpIds.add(server.id);
        } catch {
          // Unreachable server: tools simply don't appear; Options shows the test result.
        }
      } else if (!server.enabled && mountedMcpIds.has(server.id)) {
        unmountMcpServer(registry, server);
        mountedMcpIds.delete(server.id);
      }
    }
  };

  const buildKernel = (resolved: ResolvedPlanner): Kernel =>
    new Kernel({
      provider: resolved.provider,
      registry,
      getSettings: () => get().settings,
      describeEnvironment: async () => {
        const tabs = await listOperableTabs().catch(() => []);
        const target = get().targetTab;
        return {
          targetTab:
            target.tabId !== null
              ? { url: target.url, title: target.title }
              : null,
          openTabs: tabs.map((t) => ({ title: t.title, url: t.url })),
          locale: get().settings.locale,
        };
      },
      getTargetTab: () => ({
        tabId: get().targetTab.tabId,
        url: get().targetTab.url || undefined,
      }),
      confirm: (toolId, reason) =>
        new Promise<boolean>((resolve) =>
          set({ confirmPrompt: { title: toolId, reason, resolve } }),
        ),
      requestPermissions: (permissions) =>
        new Promise<boolean>((resolve) =>
          set({ permissionPrompt: { permissions, resolve } }),
        ),
    });

  const persistActiveSession = async (): Promise<void> => {
    const session = get().activeSession;
    if (!session) return;
    await sessionsRepo.save({
      ...session,
      updatedAt: new Date().toISOString(),
    });
    await get().reloadSessions();
  };

  return {
    ready: false,
    settings: DEFAULT_SETTINGS,
    providerState: { providers: [], defaultProviderId: null },
    skills: [],
    runs: [],
    batches: [],
    targetTab: { tabId: null, url: '', title: '' },
    sessions: [],
    activeSession: null,
    isChatting: false,
    activeRun: null,
    liveTrace: [],
    isRunning: false,
    confirmPrompt: null,
    permissionPrompt: null,
    plannerLabel: null,
    t: createTranslator('zh-CN'),

    async init() {
      const [settings, providerState, skills, runs, batches, sessions] =
        await Promise.all([
          settingsRepo.get(),
          providersRepo.getState(),
          skillsRepo.list(),
          runsRepo.list({ limit: 100 }),
          batchRepo.list(),
          sessionsRepo.list(),
        ]);
      const planner = createPlanner({
        providers: providerState.providers,
        defaultProviderId: providerState.defaultProviderId,
      });
      set({
        ready: true,
        settings,
        providerState,
        skills,
        runs: runs.items,
        batches,
        sessions,
        t: createTranslator(settings.locale as Locale),
        plannerLabel: planner?.label ?? null,
      });
      get().applyTheme();
      void get().refreshTargetTab();
      void syncMcpMounts();
    },

    async refreshTargetTab() {
      const tab = await getActiveTab();
      set({ targetTab: tab });
    },

    async updateSettings(patch) {
      const settings = await settingsRepo.update(patch);
      set({ settings, t: createTranslator(settings.locale as Locale) });
      get().applyTheme();
      if (patch.mcpServers) void syncMcpMounts();
    },

    async reloadProviders() {
      const providerState = await providersRepo.getState();
      const planner = createPlanner({
        providers: providerState.providers,
        defaultProviderId: providerState.defaultProviderId,
      });
      set({ providerState, plannerLabel: planner?.label ?? null });
    },
    async reloadSkills() {
      set({ skills: await skillsRepo.list() });
    },
    async reloadRuns() {
      const runs = await runsRepo.list({ limit: 100 });
      set({ runs: runs.items });
    },
    async reloadBatches() {
      set({ batches: await batchRepo.list() });
    },
    async reloadSessions() {
      set({ sessions: await sessionsRepo.list() });
    },

    /* ---------------- chat ---------------- */

    async sendMessage(text) {
      if (get().isChatting) return;
      const resolved = requirePlanner();

      let session = get().activeSession;
      if (!session) {
        session = {
          id: uid('sess'),
          title: text.slice(0, 40),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [],
        };
      }
      const userMessage: UserMessage = {
        role: 'user',
        id: uid('msg'),
        text,
        at: new Date().toISOString(),
      };
      session = { ...session, messages: [...session.messages, userMessage] };
      set({ activeSession: session, isChatting: true });
      await persistActiveSession();

      chatAbort = new AbortController();
      const kernel = buildKernel(resolved);
      const history: ChatMessage[] = session.messages;
      const sessionId = session.id;

      try {
        const assistant = await kernel.runTurn(history, {
          signal: chatAbort.signal,
          onUpdate: (message) => {
            const current = get().activeSession;
            if (!current || current.id !== sessionId) return;
            const others = current.messages.filter((m) => m.id !== message.id);
            set({
              activeSession: { ...current, messages: [...others, message] },
            });
          },
          sessionId,
        });
        const current = get().activeSession;
        if (current && current.id === sessionId) {
          const others = current.messages.filter((m) => m.id !== assistant.id);
          set({
            activeSession: { ...current, messages: [...others, assistant] },
          });
        }
      } finally {
        await persistActiveSession();
        set({ isChatting: false, confirmPrompt: null, permissionPrompt: null });
        chatAbort = null;
      }
    },

    stopChat() {
      chatAbort?.abort();
      get().confirmPrompt?.resolve(false);
      get().permissionPrompt?.resolve(false);
      set({ confirmPrompt: null, permissionPrompt: null });
    },

    newSession() {
      if (get().isChatting) get().stopChat();
      set({ activeSession: null });
    },

    async openSession(id) {
      if (get().isChatting) get().stopChat();
      const session = await sessionsRepo.get(id);
      set({ activeSession: session });
    },

    async deleteSession(id) {
      await sessionsRepo.remove(id);
      if (get().activeSession?.id === id) set({ activeSession: null });
      await get().reloadSessions();
    },

    async remountMcp() {
      mountedMcpIds.clear();
      registry.unregisterNamespace('mcp_');
      await syncMcpMounts();
    },

    listRegisteredTools() {
      return registry.list().map((t) => ({
        id: t.id,
        riskTier: t.riskTier,
        requiredPermissions: t.requiredPermissions,
      }));
    },

    resolveConfirm(proceed) {
      const prompt = get().confirmPrompt;
      if (prompt) {
        prompt.resolve(proceed);
        set({ confirmPrompt: null });
      }
    },

    resolvePermission(granted) {
      const prompt = get().permissionPrompt;
      if (prompt) {
        prompt.resolve(granted);
        set({ permissionPrompt: null });
      }
    },

    /* ---------------- skills / batch (management surfaces) ---------------- */

    async saveRunAsSkill(run, name) {
      const skill = extractSkill(run, {
        id: `skill_${Date.now().toString(36)}`,
        name,
        description: run.instruction,
        now: new Date().toISOString(),
      });
      const saved = await skillsRepo.save(skill);
      await get().reloadSkills();
      return saved;
    },

    async runSkillOnce(skill, data) {
      const { settings } = get();
      if (get().isRunning) return null;
      const { planner } = requirePlanner();
      const bus = new TraceBus();
      const unsub = bus.subscribe((ev) =>
        set((s) => ({ liveTrace: [...s.liveTrace, ev] })),
      );
      set({ isRunning: true, liveTrace: [], activeRun: null });
      abortController = new AbortController();
      let dispose = () => {};
      try {
        // route by what the skill is about (name + target URL pattern)
        const acquired = await acquireBridge(
          `${skill.name} ${skill.urlPattern}`,
        );
        dispose = acquired.dispose;
        const security = createSecurityGate({
          confirmDangerous: settings.guardrails.confirmDangerous,
          allowlist: settings.guardrails.allowlist,
          blocklist: settings.guardrails.blocklist,
        });
        const orchestrator = new Orchestrator(acquired.bridge, planner, {
          trace: bus,
          security,
          confirmer: {
            confirm: (step, reason) =>
              new Promise<boolean>((resolve) =>
                set({ confirmPrompt: { title: step.intent, reason, resolve } }),
              ),
          },
        });
        const { bindSkill } = await import('../engine/batch/skill-binding');
        const plan = bindSkill(skill, data);
        const run = await orchestrator.run(skill.name, {
          kind: 'skill',
          skillId: skill.id,
          plan,
          signal: abortController.signal,
          onUpdate: (r) => set({ activeRun: r }),
        });
        await runsRepo.save(run);
        await tracesRepo.append(run.id, bus.events(run.id));
        await skillsRepo.save({
          ...skill,
          runCount: skill.runCount + 1,
          lastRunAt: new Date().toISOString(),
        });
        await Promise.all([get().reloadRuns(), get().reloadSkills()]);
        set({ activeRun: run });
        return run;
      } catch (e) {
        if (e instanceof RunAborted) return get().activeRun;
        throw e;
      } finally {
        dispose();
        unsub();
        set({ isRunning: false, confirmPrompt: null });
        abortController = null;
      }
    },

    async startBatch(batch, skill, onlyIndices) {
      const { settings } = get();
      const { planner } = requirePlanner();
      const bus = new TraceBus();
      abortController = new AbortController();
      set({ isRunning: true });
      let dispose = () => {};
      try {
        const acquired = await acquireBridge(
          `${skill.name} ${skill.urlPattern}`,
        );
        dispose = acquired.dispose;
        const security = createSecurityGate({
          confirmDangerous: false, // batch auto-proceeds guarded steps
          allowlist: settings.guardrails.allowlist,
          blocklist: settings.guardrails.blocklist,
        });
        const runner = new BatchRunner(acquired.bridge, planner, {
          trace: bus,
          security,
        });
        const result = await runner.run(batch, skill, {
          signal: abortController.signal,
          onlyIndices,
          onRowUpdate: async (b) => {
            set((s) => ({ batches: upsertBatch(s.batches, b) }));
            await batchRepo.save(b);
          },
          onRunRecord: async (_i, run) => {
            await runsRepo.save(run);
            await tracesRepo.append(run.id, bus.events(run.id));
          },
        });
        result.stats = computeStats(result.rows);
        await batchRepo.save(result);
        await Promise.all([get().reloadBatches(), get().reloadRuns()]);
        return result;
      } finally {
        dispose();
        set({ isRunning: false });
        abortController = null;
      }
    },

    applyTheme() {
      const { theme } = get().settings;
      const root = document.documentElement;
      const prefersDark = window.matchMedia?.(
        '(prefers-color-scheme: dark)',
      ).matches;
      const dark = theme === 'dark' || (theme === 'system' && prefersDark);
      root.classList.toggle('dark', dark);
    },
  };
});

/** Stop-everything used by the sidepanel Stop button on the skills/batch pages. */
export function stopEngineRun(): void {
  abortController?.abort();
}

function upsertBatch(list: BatchRun[], b: BatchRun): BatchRun[] {
  const idx = list.findIndex((x) => x.id === b.id);
  if (idx >= 0) {
    const copy = [...list];
    copy[idx] = b;
    return copy;
  }
  return [b, ...list];
}

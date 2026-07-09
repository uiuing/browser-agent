import { getDriver } from './driver';
import { DEFAULT_SETTINGS, type Settings, type ProviderState, type AuditEvent, type SessionMeta } from './types';
import type { Skill } from '../engine/contracts/skill';
import type { RunRecord, TraceEvent } from '../engine/contracts/trace';
import type { BatchRun, BatchRow } from '../engine/contracts/batch';
import type { ChatSession } from '../kernel/contracts/session';
import type { ProviderConfig } from '../llm/contracts';

const KEYS = {
  settings: 'settings',
  providers: 'providers',
  skills: 'skills',
  runs: 'runs',
  trace: (runId: string) => `trace:${runId}`,
  batches: 'batches',
  audit: 'audit',
  sessions: 'sessions',
  session: (id: string) => `session:${id}`,
};

const MAX_SESSIONS = 50;

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------------- settings ---------------- */
export const settingsRepo = {
  async get(): Promise<Settings> {
    const s = await getDriver().get<Settings>(KEYS.settings);
    return {
      ...DEFAULT_SETTINGS,
      ...(s ?? {}),
      guardrails: { ...DEFAULT_SETTINGS.guardrails, ...(s?.guardrails ?? {}) },
      mcpServers: s?.mcpServers ?? [],
    };
  },
  async update(patch: Partial<Settings>): Promise<Settings> {
    const cur = await settingsRepo.get();
    const next = { ...cur, ...patch, guardrails: { ...cur.guardrails, ...(patch.guardrails ?? {}) } };
    await getDriver().set(KEYS.settings, next);
    return next;
  },
  watch(cb: (s: Settings | null) => void): () => void {
    return getDriver().watch<Settings>(KEYS.settings, cb);
  },
};

/* ---------------- chat sessions ---------------- */
export const sessionsRepo = {
  async list(): Promise<SessionMeta[]> {
    return (await getDriver().get<SessionMeta[]>(KEYS.sessions)) ?? [];
  },
  async get(id: string): Promise<ChatSession | null> {
    return (await getDriver().get<ChatSession>(KEYS.session(id))) ?? null;
  },
  async save(session: ChatSession): Promise<void> {
    const d = getDriver();
    await d.set(KEYS.session(session.id), session);
    const metas = (await sessionsRepo.list()).filter(m => m.id !== session.id);
    metas.unshift({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messages.length,
    });
    // Evict oldest transcripts beyond the cap so storage stays bounded.
    const keep = metas.slice(0, MAX_SESSIONS);
    for (const evicted of metas.slice(MAX_SESSIONS)) await d.remove(KEYS.session(evicted.id));
    await d.set(KEYS.sessions, keep);
  },
  async remove(id: string): Promise<void> {
    const d = getDriver();
    await d.remove(KEYS.session(id));
    await d.set(KEYS.sessions, (await sessionsRepo.list()).filter(m => m.id !== id));
  },
  watch(cb: (metas: SessionMeta[] | null) => void): () => void {
    return getDriver().watch<SessionMeta[]>(KEYS.sessions, cb);
  },
};

/* ---------------- providers ---------------- */
export const providersRepo = {
  async getState(): Promise<ProviderState> {
    return (await getDriver().get<ProviderState>(KEYS.providers)) ?? { providers: [], defaultProviderId: null };
  },
  async list(): Promise<ProviderConfig[]> {
    return (await providersRepo.getState()).providers;
  },
  async upsert(config: ProviderConfig): Promise<ProviderState> {
    const state = await providersRepo.getState();
    const idx = state.providers.findIndex(p => p.id === config.id);
    if (idx >= 0) state.providers[idx] = config;
    else state.providers.push(config);
    if (!state.defaultProviderId) state.defaultProviderId = config.id;
    await getDriver().set(KEYS.providers, state);
    return state;
  },
  async remove(id: string): Promise<ProviderState> {
    const state = await providersRepo.getState();
    state.providers = state.providers.filter(p => p.id !== id);
    if (state.defaultProviderId === id) state.defaultProviderId = state.providers[0]?.id ?? null;
    await getDriver().set(KEYS.providers, state);
    return state;
  },
  async setDefault(id: string): Promise<ProviderState> {
    const state = await providersRepo.getState();
    state.defaultProviderId = id;
    await getDriver().set(KEYS.providers, state);
    return state;
  },
  watch(cb: (s: ProviderState | null) => void): () => void {
    return getDriver().watch<ProviderState>(KEYS.providers, cb);
  },
};

/* ---------------- skills ---------------- */
export const skillsRepo = {
  async list(): Promise<Skill[]> {
    return (await getDriver().get<Skill[]>(KEYS.skills)) ?? [];
  },
  async get(id: string): Promise<Skill | null> {
    return (await skillsRepo.list()).find(s => s.id === id) ?? null;
  },
  async save(skill: Skill): Promise<Skill> {
    const list = await skillsRepo.list();
    const idx = list.findIndex(s => s.id === skill.id);
    const updated = { ...skill, updatedAt: new Date().toISOString() };
    if (idx >= 0) list[idx] = updated;
    else list.unshift(updated);
    await getDriver().set(KEYS.skills, list);
    return updated;
  },
  async remove(id: string): Promise<void> {
    const list = (await skillsRepo.list()).filter(s => s.id !== id);
    await getDriver().set(KEYS.skills, list);
  },
  async import(skills: Skill[]): Promise<void> {
    const list = await skillsRepo.list();
    const byId = new Map(list.map(s => [s.id, s] as const));
    for (const s of skills) byId.set(s.id, s);
    await getDriver().set(KEYS.skills, Array.from(byId.values()));
  },
  watch(cb: (s: Skill[] | null) => void): () => void {
    return getDriver().watch<Skill[]>(KEYS.skills, cb);
  },
};

/* ---------------- runs ---------------- */
export const runsRepo = {
  async list(opts?: { limit?: number; cursor?: number; status?: string }): Promise<{ items: RunRecord[]; nextCursor: number | null }> {
    const all = (await getDriver().get<RunRecord[]>(KEYS.runs)) ?? [];
    const filtered = opts?.status ? all.filter(r => r.status === opts.status) : all;
    const start = opts?.cursor ?? 0;
    const limit = opts?.limit ?? 50;
    const items = filtered.slice(start, start + limit);
    const nextCursor = start + limit < filtered.length ? start + limit : null;
    return { items, nextCursor };
  },
  async get(id: string): Promise<RunRecord | null> {
    const all = (await getDriver().get<RunRecord[]>(KEYS.runs)) ?? [];
    return all.find(r => r.id === id) ?? null;
  },
  async save(run: RunRecord): Promise<void> {
    const all = (await getDriver().get<RunRecord[]>(KEYS.runs)) ?? [];
    const idx = all.findIndex(r => r.id === run.id);
    if (idx >= 0) all[idx] = run;
    else all.unshift(run);
    // cap history to keep storage bounded
    await getDriver().set(KEYS.runs, all.slice(0, 200));
  },
  async remove(id: string): Promise<void> {
    const all = ((await getDriver().get<RunRecord[]>(KEYS.runs)) ?? []).filter(r => r.id !== id);
    await getDriver().set(KEYS.runs, all);
  },
  watch(cb: (r: RunRecord[] | null) => void): () => void {
    return getDriver().watch<RunRecord[]>(KEYS.runs, cb);
  },
};

/* ---------------- traces ---------------- */
export const tracesRepo = {
  async append(runId: string, events: TraceEvent[]): Promise<void> {
    const existing = (await getDriver().get<TraceEvent[]>(KEYS.trace(runId))) ?? [];
    await getDriver().set(KEYS.trace(runId), [...existing, ...events]);
  },
  async list(runId: string): Promise<TraceEvent[]> {
    return (await getDriver().get<TraceEvent[]>(KEYS.trace(runId))) ?? [];
  },
  async clear(runId: string): Promise<void> {
    await getDriver().remove(KEYS.trace(runId));
  },
};

/* ---------------- batches ---------------- */
export const batchRepo = {
  async list(): Promise<BatchRun[]> {
    return (await getDriver().get<BatchRun[]>(KEYS.batches)) ?? [];
  },
  async get(id: string): Promise<BatchRun | null> {
    return (await batchRepo.list()).find(b => b.id === id) ?? null;
  },
  async save(batch: BatchRun): Promise<void> {
    const list = await batchRepo.list();
    const idx = list.findIndex(b => b.id === batch.id);
    if (idx >= 0) list[idx] = batch;
    else list.unshift(batch);
    await getDriver().set(KEYS.batches, list.slice(0, 100));
  },
  async checkpoint(id: string, rowPatch: BatchRow, cursor: number): Promise<void> {
    const batch = await batchRepo.get(id);
    if (!batch) return;
    const idx = batch.rows.findIndex(r => r.index === rowPatch.index);
    if (idx >= 0) batch.rows[idx] = rowPatch;
    batch.cursor = cursor;
    await batchRepo.save(batch);
  },
  async remove(id: string): Promise<void> {
    const list = (await batchRepo.list()).filter(b => b.id !== id);
    await getDriver().set(KEYS.batches, list);
  },
  watch(cb: (b: BatchRun[] | null) => void): () => void {
    return getDriver().watch<BatchRun[]>(KEYS.batches, cb);
  },
};

/* ---------------- audit ---------------- */
export const auditRepo = {
  async append(event: Omit<AuditEvent, 'id' | 'at'>): Promise<void> {
    const all = (await getDriver().get<AuditEvent[]>(KEYS.audit)) ?? [];
    all.unshift({ ...event, id: uid('audit'), at: new Date().toISOString() });
    await getDriver().set(KEYS.audit, all.slice(0, 500));
  },
  async list(opts?: { limit?: number; cursor?: number }): Promise<{ items: AuditEvent[]; nextCursor: number | null }> {
    const all = (await getDriver().get<AuditEvent[]>(KEYS.audit)) ?? [];
    const start = opts?.cursor ?? 0;
    const limit = opts?.limit ?? 100;
    const items = all.slice(start, start + limit);
    return { items, nextCursor: start + limit < all.length ? start + limit : null };
  },
  async clear(): Promise<void> {
    await getDriver().remove(KEYS.audit);
  },
};

/* ---------------- data export/import ---------------- */
export const dataRepo = {
  async exportAll(): Promise<Record<string, unknown>> {
    const d = getDriver();
    const metas = await sessionsRepo.list();
    const sessions: Record<string, unknown> = {};
    for (const m of metas) sessions[m.id] = await d.get(KEYS.session(m.id));
    return {
      settings: await d.get(KEYS.settings),
      providers: await d.get(KEYS.providers),
      skills: await d.get(KEYS.skills),
      runs: await d.get(KEYS.runs),
      batches: await d.get(KEYS.batches),
      audit: await d.get(KEYS.audit),
      sessionIndex: metas,
      sessions,
      exportedAt: new Date().toISOString(),
    };
  },
  async importAll(data: Record<string, unknown>): Promise<void> {
    const d = getDriver();
    const map: Record<string, string> = {
      settings: KEYS.settings,
      providers: KEYS.providers,
      skills: KEYS.skills,
      runs: KEYS.runs,
      batches: KEYS.batches,
      audit: KEYS.audit,
      sessionIndex: KEYS.sessions,
    };
    for (const [k, key] of Object.entries(map)) {
      if (data[k] !== undefined && data[k] !== null) await d.set(key, data[k]);
    }
    const sessions = data.sessions as Record<string, unknown> | undefined;
    if (sessions) {
      for (const [id, session] of Object.entries(sessions)) {
        if (session) await d.set(KEYS.session(id), session);
      }
    }
  },
  async clearAll(): Promise<void> {
    const d = getDriver();
    for (const m of await sessionsRepo.list()) await d.remove(KEYS.session(m.id));
    for (const key of [KEYS.settings, KEYS.providers, KEYS.skills, KEYS.runs, KEYS.batches, KEYS.audit, KEYS.sessions]) {
      await d.remove(key);
    }
  },
};

export { uid };

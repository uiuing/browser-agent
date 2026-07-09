import type { TraceEvent } from '../engine/contracts/trace';
import type { TraceSink } from '../engine/orchestrator/types';

/**
 * In-memory trace bus. Assigns ids/seq/ts, fans out to subscribers, and buffers per run
 * so the UI can subscribe live and the storage layer can persist for replay/export.
 */
export class TraceBus implements TraceSink {
  private seq = 0;
  private subscribers = new Set<(e: TraceEvent) => void>();
  private buffer = new Map<string, TraceEvent[]>();

  emit(partial: Omit<TraceEvent, 'id' | 'seq' | 'ts'>): void {
    const event: TraceEvent = {
      ...partial,
      id: `ev_${this.seq}`,
      seq: this.seq++,
      ts: new Date().toISOString(),
    };
    const list = this.buffer.get(event.runId) ?? [];
    list.push(event);
    this.buffer.set(event.runId, list);
    this.subscribers.forEach(fn => {
      try {
        fn(event);
      } catch {
        /* isolate subscriber errors */
      }
    });
  }

  subscribe(fn: (e: TraceEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  events(runId: string): TraceEvent[] {
    return this.buffer.get(runId) ?? [];
  }

  drain(runId: string): TraceEvent[] {
    const list = this.buffer.get(runId) ?? [];
    this.buffer.delete(runId);
    return list;
  }
}

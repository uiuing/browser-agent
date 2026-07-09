import type { LLMProvider, ProviderConfig } from './contracts';
import { OpenAICompatibleProvider } from './providers/openai-compatible';
import { OpenAIResponsesProvider } from './providers/openai-responses';
import { AnthropicProvider } from './providers/anthropic';
import { MockProvider } from './mock/mock-provider';
import { LLMPlanner } from './planner';
import type { Planner } from '../engine/orchestrator/types';
import type { Decider } from '../engine/contracts/agent';

export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.kind) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai-responses':
      return new OpenAIResponsesProvider(config);
    case 'mock':
      return new MockProvider();
    case 'openai-compatible':
    default:
      return new OpenAICompatibleProvider(config);
  }
}

export interface RouterInput {
  providers: ProviderConfig[];
  defaultProviderId: string | null;
}

export interface ResolvedPlanner {
  /** The raw provider — the kernel talks to it directly via chatWithTools. */
  provider: LLMProvider;
  planner: Planner;
  /**
   * Closed-loop decider for free-form tasks (observe → decide → act → verify per
   * turn). Real LLM providers only — the deterministic mock plans in one shot, so
   * tests and skill/batch replay stay on the compiled-plan path.
   */
  decider: Decider | null;
  label: string;
}

/**
 * Resolve the active provider. Test builds (VITE_USE_MOCK=1) get the deterministic
 * MockProvider so e2e runs without a key. In user builds there is NO silent fallback:
 * when nothing usable is configured this returns null and the UI guides the user to
 * connect a model.
 */
export function resolveProvider(input: RouterInput): { provider: LLMProvider; label: string } | null {
  const testBuild =
    typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string> }).env?.VITE_USE_MOCK === '1';
  if (testBuild) return { provider: new MockProvider(), label: 'MockPlanner (test build)' };

  const chosen =
    input.providers.find(p => p.id === input.defaultProviderId && p.enabled) ??
    input.providers.find(p => p.enabled);

  if (!chosen) return null;
  // Local endpoints (Ollama etc.) work keyless; hosted endpoints need a key.
  if (chosen.kind !== 'mock' && !chosen.apiKey.trim() && !/localhost|127\.0\.0\.1/.test(chosen.baseUrl)) return null;
  return { provider: createProvider(chosen), label: chosen.label };
}

export function createPlanner(input: RouterInput): ResolvedPlanner | null {
  const resolved = resolveProvider(input);
  if (!resolved) return null;
  const planner = new LLMPlanner(resolved.provider);
  return {
    provider: resolved.provider,
    planner,
    decider: resolved.provider.kind === 'mock' ? null : planner,
    label: resolved.label,
  };
}

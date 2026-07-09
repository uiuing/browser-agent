import type { RiskTier, ToolPolicy } from '../kernel/contracts/tool';

/**
 * The tool gate: EVERY tool call passes through here before executing — the same
 * philosophy as the page-action gate (guardrails/security.ts), lifted to the
 * whole tool surface. Decision inputs: per-tool authorization memory, risk
 * tier, and the site policies of the tab the call targets.
 */

export interface ToolGateInput {
  toolId: string;
  riskTier: RiskTier;
  /** Per-tool authorization memory from settings. */
  policy: ToolPolicy | undefined;
  /** URL of the target tab, when the tool operates on one. */
  url?: string;
  allowlist: string[];
  blocklist: string[];
  confirmDangerous: boolean;
}

export type ToolGateDecision =
  | { allowed: true }
  | { allowed: false; reason: string }
  | { needsConfirm: true; reason: string };

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function matches(list: string[], url: string): boolean {
  const host = hostOf(url);
  return list.some(p => {
    const clean = p.trim();
    if (!clean) return false;
    return host === clean || host.endsWith(`.${clean}`) || url.includes(clean);
  });
}

export function checkToolCall(input: ToolGateInput): ToolGateDecision {
  if (input.policy === 'block') {
    return { allowed: false, reason: `Tool "${input.toolId}" is blocked in settings.` };
  }
  if (input.url && input.blocklist.length && matches(input.blocklist, input.url)) {
    return { allowed: false, reason: `Site is blocklisted: ${hostOf(input.url)}` };
  }
  if (input.riskTier === 'read') return { allowed: true };
  if (input.policy === 'always_allow') return { allowed: true };
  if (input.riskTier === 'dangerous' && input.confirmDangerous) {
    // Dangerous tools confirm even on allowlisted sites — the allowlist trusts a
    // site's pages, not an irreversible browser-level operation.
    return { needsConfirm: true, reason: `High-impact tool "${input.toolId}" requires confirmation.` };
  }
  // act tier passes here: page-level dangers (submit/pay/delete) are re-checked
  // inside page.act by the per-action gate, which owns the confirmation UX.
  return { allowed: true };
}

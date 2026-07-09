import type { ActionOutcome } from '../contracts/action';
import type { VerificationResult } from '../contracts/verification';
import type { Diagnosis, HealStrategy } from '../contracts/trace';

/**
 * L6 diagnosis: classify why a step failed, then map to an ordered strategy chain.
 * This is the difference between "崩不了" and nanobrowser's `consecutiveFailures++`
 * then throw. We recover instead of giving up.
 */
export function diagnose(outcome: ActionOutcome | undefined, verifications: VerificationResult[]): Diagnosis {
  if (outcome && !outcome.ok) {
    switch (outcome.error?.code) {
      case 'element_not_found':
        return 'element_not_found';
      case 'occluded':
        return 'occluded';
      case 'value_not_applied':
        return 'value_not_applied';
      case 'timeout':
        return 'timeout_flaky';
      case 'blocked_by_policy':
        return 'policy_blocked';
      case 'not_interactable':
        return 'occluded';
      default:
        return 'unknown';
    }
  }
  // action reported ok, but verification failed → no success signal
  const failed = verifications.filter(v => !v.passed);
  if (failed.length > 0) {
    if (failed.some(v => v.condition.kind === 'value_equals')) return 'value_not_applied';
    return 'no_success_signal';
  }
  return 'unknown';
}

const STRATEGY_MAP: Record<Diagnosis, HealStrategy[]> = {
  element_not_found: ['smart_wait', 'reground', 'probe_scroll', 'relax_grounding', 'replan'],
  occluded: ['scroll_into_view', 'dismiss_overlay', 'switch_channel', 'smart_wait'],
  value_not_applied: ['switch_adapter_strategy', 'reground', 'switch_channel', 'retry_backoff'],
  no_success_signal: ['smart_wait', 'reground', 'replan'],
  timeout_flaky: ['smart_wait', 'retry_backoff', 'reground'],
  blocked_by_challenge: ['escalate_human'],
  policy_blocked: ['escalate_human'],
  unknown: ['smart_wait', 'reground', 'retry_backoff', 'replan'],
};

export function strategiesFor(diagnosis: Diagnosis): HealStrategy[] {
  return STRATEGY_MAP[diagnosis] ?? ['smart_wait', 'retry_backoff'];
}

export function isTerminal(diagnosis: Diagnosis): boolean {
  return diagnosis === 'blocked_by_challenge' || diagnosis === 'policy_blocked';
}

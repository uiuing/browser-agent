import type { Action } from '../contracts/action';
import type { PostCondition } from '../contracts/verification';

/**
 * If a plan step arrives without post-conditions, we synthesize sensible defaults so
 * that *every* action is still verified. A planner that forgets to prove its work
 * cannot silently "succeed" — this enforces the product's soul at the framework level.
 */
export function defaultExpectations(action: Action): PostCondition[] {
  switch (action.type) {
    case 'fill':
    case 'setValue':
      return action.target.fingerprint || action.target.nodeId !== undefined
        ? [{ kind: 'value_equals', target: action.target, expected: action.value }]
        : [];
    case 'navigate':
      return [{ kind: 'url_matches', pattern: safeUrlFragment(action.url) }];
    case 'uploadFile':
      return [];
    default:
      return [];
  }
}

function safeUrlFragment(url: string): string {
  try {
    const u = new URL(url, 'http://x');
    return u.pathname !== '/' ? u.pathname : url;
  } catch {
    return url;
  }
}

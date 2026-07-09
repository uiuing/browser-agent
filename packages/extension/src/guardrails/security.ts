import type { Action } from '../engine/contracts/action';
import type { SecurityGate, SecurityDecision } from '../engine/orchestrator/types';

export interface SecurityConfig {
  confirmDangerous: boolean;
  allowlist: string[];
  blocklist: string[];
}

/** Multi-language dangerous-intent detection on click targets and destructive actions. */
const DANGER_TERMS =
  /(submit|confirm|pay|purchase|checkout|delete|remove|send|transfer|withdraw|save|提交|确认|支付|付款|购买|结算|删除|移除|发送|转账|提现|注销|保存)/i;

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

export function createSecurityGate(config: SecurityConfig): SecurityGate {
  return {
    check(action: Action, url: string): SecurityDecision {
      if (config.blocklist.length && matches(config.blocklist, url)) {
        return { allowed: false, reason: `站点在黑名单中：${hostOf(url)} / Site is blocklisted` };
      }
      const onAllowlist = config.allowlist.length > 0 && matches(config.allowlist, url);

      let dangerous = false;
      if (action.type === 'click' && action.target.fingerprint) {
        const fp = action.target.fingerprint;
        const label = `${fp.name ?? ''} ${fp.attrs?.value ?? ''} ${fp.role ?? ''}`;
        if (DANGER_TERMS.test(label)) dangerous = true;
      }
      if (action.type === 'press' && /Enter/.test(action.keys)) {
        // pressing Enter can submit forms
        dangerous = dangerous || false;
      }

      if (dangerous && config.confirmDangerous && !onAllowlist) {
        return { needsConfirm: true, reason: '高危操作（提交/删除/支付/发送），执行前请确认。' };
      }
      return { allowed: true };
    },
  };
}

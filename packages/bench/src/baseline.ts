import type { Page } from 'playwright';

/**
 * BaselineHarness — a deliberate re-implementation of nanobrowser's architectural
 * approach, so the comparison is apples-to-apples on the same fixtures:
 *  - perception is VIEWPORT-ONLY (viewportExpansion = 0)
 *  - elements addressed by positional INDEX
 *  - only NATIVE controls (<input>, <select>) are supported
 *  - fixed sleep(1000ms) after each action (no readiness signal)
 *  - NO post-condition verification — "done" is declared, not proven
 *  - fail-FAST: first error aborts the task
 * This mirrors附录A #1,#2,#3,#4,#5,#6,#7.
 */
export interface FieldOp {
  label: string; // accessible label text to find the field by
  value: string;
  kind: 'input' | 'select' | 'custom';
}

export interface BaselineResult {
  claimedSuccess: boolean;
  error?: string;
}

const SLEEP = 1000;

export class BaselineHarness {
  constructor(private page: Page) {}

  private async viewportInputs(): Promise<number> {
    // emulate index-based viewport perception
    return this.page.evaluate(() => {
      const vh = window.innerHeight;
      const els = Array.from(document.querySelectorAll('input, select, textarea, button'));
      return els.filter(e => {
        const r = e.getBoundingClientRect();
        return r.top >= 0 && r.top <= vh && r.width > 0 && r.height > 0;
      }).length;
    });
  }

  async run(ops: FieldOp[], submitLabelRegex: RegExp | null): Promise<BaselineResult> {
    try {
      await this.viewportInputs(); // perceive (viewport only)
      for (const op of ops) {
        const applied = await this.page.evaluate(
          ({ label, value, kind }) => {
            const vh = window.innerHeight;
            const inViewport = (e: Element) => {
              const r = e.getBoundingClientRect();
              return r.top >= 0 && r.top <= vh && r.width > 0 && r.height > 0;
            };
            // find by aria-label / label text — but ONLY within the viewport (index-style)
            const candidates = Array.from(document.querySelectorAll('input, select, textarea')).filter(inViewport);
            const match = candidates.find(
              e => (e.getAttribute('aria-label') || '') === label || (e.getAttribute('placeholder') || '') === label,
            );
            if (kind === 'custom') {
              // nanobrowser only supports native <select>; a custom div-based select is
              // not addressable — no native control matches, so nothing is applied.
              return false;
            }
            if (!match) return false;
            const elx = match as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
            if (elx.tagName.toLowerCase() === 'select') {
              const sel = elx as HTMLSelectElement;
              const opt = Array.from(sel.options).find(o => o.text === value || o.value === value);
              if (!opt) return false;
              sel.value = opt.value;
            } else {
              (elx as HTMLInputElement).value = value;
            }
            elx.dispatchEvent(new Event('input', { bubbles: true }));
            elx.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          },
          op,
        );
        // fail-fast on a control it cannot drive
        if (!applied && op.kind !== 'custom') {
          return { claimedSuccess: false, error: `element not found: ${op.label}` };
        }
        await this.page.waitForTimeout(SLEEP); // fixed sleep, no readiness signal
      }
      if (submitLabelRegex === null) return { claimedSuccess: true };
      // click submit (by text), then declare success WITHOUT verifying anything
      const clicked = await this.page.evaluate(
        ({ rx }) => {
          const re = new RegExp(rx, 'i');
          const btn = Array.from(document.querySelectorAll('button')).find(b => re.test(b.textContent || ''));
          if (!btn) return false;
          (btn as HTMLButtonElement).click();
          return true;
        },
        { rx: submitLabelRegex.source },
      );
      if (!clicked) return { claimedSuccess: false, error: 'submit not found' };
      await this.page.waitForTimeout(SLEEP);
      // No verification. The planner-LLM would "self-assess" done → we claim success.
      return { claimedSuccess: true };
    } catch (e) {
      return { claimedSuccess: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}

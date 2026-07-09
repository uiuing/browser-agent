# Contributing to Browser Agent

The harness is community property — the model is whatever the user plugs in. Every tool, adapter, context provider and fixture the community adds makes the harness better for everyone.

## Dev setup

```bash
pnpm install
pnpm build          # fixtures + extension + typechecks
pnpm test:engine    # engine checks against local fixtures (headless)
```

Load the built extension: Chrome → `chrome://extensions` → Developer mode → *Load unpacked* → `packages/extension/.output/chrome-mv3`.

Hot-reload development: `pnpm dev:ext` (extension) and `pnpm dev:fixtures` (practice site at `http://localhost:4173`).

## Repo layout

```
packages/
  extension/   WXT MV3 extension — the harness:
               src/kernel (agent loop) · src/context (context assembly) ·
               src/tools (registry + packs + MCP) · src/engine (verified page actions) ·
               src/guardrails · src/trace · src/llm (model port) · src/storage · src/ui
  fixtures/    Local practice/test site (forms, custom widgets, iframes, fault injection)
  e2e/         Engine tests + extension e2e + screenshot sweep (Playwright)
  bench/       Reproducible benchmark vs a viewport-based baseline agent
```

The engine (`src/engine/`) is deliberately chrome-API-free: it only touches the DOM and a typed `Bridge` port. That's why the exact same code runs in the content script, in injected test pages and in the benchmark.

## Great first contributions (highest leverage first)

- **A tool pack** (`packages/extension/src/tools/`): one `ToolDefinition` — id, description, Zod params schema, risk tier, handler — gives every configured model a new capability behind the same guardrails. ~30 lines. Template:

```ts
import { z } from 'zod';
import type { ToolDefinition } from '@/kernel/contracts/tool';

export const myTool: ToolDefinition<{ query: string }> = {
  id: 'my_tool',
  titleKey: 'tools.my_tool',            // add to BOTH i18n dicts
  description: 'What it does, and when NOT to use it.',
  paramsSchema: z.object({ query: z.string() }),
  riskTier: 'read',                     // read | act | dangerous
  requiredPermissions: [],              // optional chrome permissions, requested on first use
  async execute(params, ctx) {
    return { ok: true, summary: `…model-facing result…` };
  },
};
```

- **A context provider** (`packages/extension/src/context/`): a new layer of what the model sees each turn. Keep it small and fresh.
- **A widget adapter** (`packages/extension/src/engine/page/adapters.ts`): teach the engine a new component library's dropdown/datepicker/upload. Add a fixture page that uses the widget and a check in `packages/e2e/src/engine-tests.ts`.
- **A verification kind** (`src/engine/contracts/verification.ts` + `src/engine/page/verify.ts`): new post-condition types make evidence stronger.
- **A model port** (`packages/extension/src/llm/providers/`): implement the `LLMProvider` contract (including `chatWithTools`) for a new API family, register it in `router.ts` and add a template in `contracts/index.ts`.
- **A fixture scenario** (`packages/fixtures/`): real-world page patterns (virtualized lists, nested iframes, gnarly forms) make the engine measurably better.

## Ground rules

1. **Page effects need page evidence.** No code path may claim page effects without verification; page changes go through `page_act`. Don't add paths that mark success from model output alone.
2. **Every tool call passes the guardrails.** New tools declare the correct risk tier and required permissions; never bypass the registry.
3. **Keep the engine environment-agnostic.** Nothing under `src/engine/` may import `chrome.*` — it must run in any page context.
4. **Tests must stay green**: `pnpm build && pnpm test:engine` before pushing. If you touched UI or chat flows, also run `pnpm test:e2e` locally (headed Chromium required).
5. **No telemetry, no backends.** Everything stays local; keys go straight from the browser to the provider.

## Pull requests

- Small, focused PRs review fastest.
- Explain *what you verified* (test output, screenshots for UI changes).
- New user-facing copy goes into both dictionaries: `src/ui/i18n/zh-CN.ts` and `en-US.ts`.

## License

By contributing you agree that your contributions are licensed under the MIT License.

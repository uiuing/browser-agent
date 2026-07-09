# AGENTS.md — guide for AI coding agents

Browser Agent is an open-source MV3 Chrome extension: **the agent harness for the browser**. Bring any model; the harness provides the agent loop, context assembly, tools, guardrails, memory and observability — and every claimed page effect is **verified against page truth**. TypeScript strict, pnpm monorepo, no backend.

Terminology: **harness** = the whole product. **engine** (`src/engine/`) = the page-action runtime (perception/grounding/execute/verify/failure handling), exposed to the loop as the `page_act` tool.

## Setup & commands

```bash
pnpm install # workspace root; runs `wxt prepare` for the extension
pnpm build # fixtures + extension build, then typechecks bench/e2e
pnpm dev:ext # extension dev server (WXT hot reload)
pnpm --filter @browser-agent/extension compile # tsc --noEmit for the extension only
pnpm --filter @browser-agent/extension zip # release zip → packages/extension/.output/browser-agent-<ver>-chrome.zip
```

Extension build output: `packages/extension/.output/chrome-mv3` (load unpacked in Chrome).

## Tests — run these before claiming done

```bash
pnpm test:engine # fast, headless-DOM checks of the engine (perception/grounding/verify/heal)
pnpm test:e2e # full extension e2e with the scripted MockProvider; needs Playwright Chromium
pnpm shots # screenshot walkthrough of all UI surfaces → shots/
```

Notes for e2e:
- e2e builds the extension itself with `VITE_USE_MOCK=1` (routes to a deterministic scripted mock — no API key needed). Never ship or commit a mock build; `pnpm build` at root always produces the production build.
- Real-model suites (`test:real`, `test:sites` in `packages/e2e`) read `REAL_BASE` / `REAL_KEY` / `REAL_MODEL` env vars (never hardcode keys) and always rebuild in production mode; `SKIP_BUILD=1` reuses the previous build.
- On Windows sandboxes, Playwright may need `PLAYWRIGHT_BROWSERS_PATH` pointing at the local `ms-playwright` cache.
- Chrome 137+ requires `--disable-features=DisableLoadExtensionCommandLineSwitch` to load extensions from CLI (the e2e launcher already handles it).

## Repository layout

```
packages/
├─ extension/ # the product: WXT MV3 extension (React 18, Tailwind v4, Zustand, Zod)
│ └─ src/
│ ├─ kernel/ # agent loop state machine + contracts (session, message, tool)
│ ├─ context/ # layered context assembly: system prompt, environment, history
│ ├─ tools/ # tool registry + built-in packs (page/tabs/browser/skills) + MCP mount
│ │ # ← the community's first extension point: one file = one tool
│ ├─ engine/ # page_act's implementation: perception/grounding/execute/verify
│ │ ├─ contracts/ # Zod schemas: plan, trace, verification, agent decision
│ │ ├─ page/ # runs INSIDE the page: perception, grounding, execute, verify
│ │ ├─ orchestrator/ # agent-loop.ts (closed loop), run.ts (compiled replay), observe.ts
│ │ └─ batch/ # skill extraction/binding, batch runner
│ ├─ guardrails/ # tool-gate.ts (every tool call) + security.ts (page actions)
│ ├─ trace/ # event bus shared by kernel and engine
│ ├─ llm/ # model port: router, providers (openai-compatible / responses /
│ │ # anthropic), chatWithTools + prompted-JSON fallback, scripted mock
│ ├─ messaging/ # chrome-bridge: typed RPC to content script, tab routing, retargeting
│ ├─ storage/ # chrome.storage repos (sessions, providers, runs, skills, batches, audit)
│ ├─ ui/ # sidepanel (chat-first) / options / onboarding (React)
│ └─ entrypoints/ # WXT entrypoints: background, content, *.html
├─ fixtures/ # local test web app (customer/product CRUD) used by tests & bench
├─ e2e/ # Playwright suites: engine-tests, ext-e2e (mock), real-llm, real-sites, shots
└─ bench/ # benchmark runner → docs/benchmark.md
docs/ # architecture.md, benchmark.md
```

## Architecture invariants (do not break these)

1. **Facts beat predictions.** The model's `expect` post-conditions are predictions; `engine/orchestrator/observe.ts` diffs pre/post-action snapshots into observed facts. Reconciliation in `agent-loop.ts` arbitrates: never re-submit an action whose durable effect was observed; never trust a weak prediction that passed while the page shows no change.
2. **The model never grades itself.** A run succeeds only when the final `evidence` conditions verify against the live DOM (`engine/page/verify.ts`). Don't add code paths that mark success from model output alone.
3. **Page effects must come from `page_act`.** Chat replies do not change pages; any page-changing result must carry the verified result of a `page_act` run. The kernel never judges page work itself.
4. **Every tool call passes the guardrails** (`guardrails/tool-gate.ts`): risk tier (`read`/`act`/`dangerous`), per-tool authorization memory, site allow/blocklist, on-demand `chrome.permissions.request`, audit log. Never bypass the registry.
5. **Verification fallbacks must use stronger page evidence, not looser checks.** `list_count_delta` falls back to page-truth repeated-element group counts when the predicted fingerprint never grounds; `element_state` resolves the real input when grounding lands on a wrapping label. Follow this pattern instead of loosening checks.
6. **One action per engine turn**; each turn gets a fresh whole-page snapshot.
7. **Navigation is not failure.** `CHANNEL_LOST_DURING_EXECUTE` from the bridge means the document unloaded mid-action; settle by waiting for the new document and verifying there.
8. Contracts live in `kernel/contracts/` and `engine/contracts/` as Zod schemas — change the schema first, then the code; keep model-facing schemas null-tolerant (`z.preprocess` guards).

## UI conventions

- Design system: **black & white flat + frosted glass** — solid page bg, translucent `glass` / `glass-sm` / `glass-strong` panels (hairline border + backdrop-blur), and flat `inset` wells for inputs/selected. Use utilities from `src/ui/styles.css`. **No dual shadows, no colored fills, no gradients.** Glass = elevated surface; inset = pressed/input/selected.
- Status colors are desaturated grays (`--verified/--failed/--running/--healing`); the only strong accent is `--primary` (near-black, near-white in dark).
- The chat is the primary surface; the `page_act` tool card (live `StepTimeline` + per-check evidence) is the flagship UI element — keep it first-class.
- All user-facing strings go through the i18n dicts (`src/ui/i18n/zh-CN.ts` + `en-US.ts`) — add keys to **both**, never hardcode copy in components. Tool titles live under the `tools.*` keys.
- Radix primitives styled in `ui/components/primitives.tsx` and `overlays.tsx`; reuse them instead of restyling ad hoc.

## Code style

- TypeScript strict; no `any` unless bridging a third-party type gap (comment why).
- Zod-validate at boundaries (LLM output, tool params, storage, messages); trust internal types elsewhere.
- Comments explain *why* (invariants, trade-offs), never *what* the code does.
- Page-context code (`engine/page/*`) must be self-contained — it is serialized and injected; no imports of extension-context modules, no `chrome.*`.
- Tools receive everything through `ToolExecutionContext` / `ToolHost`; they never import the store or reach for globals.
- User-visible errors must be actionable (what happened + what to do), localized via i18n.

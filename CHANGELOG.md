# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [0.0.1] — 2026-07-09

First public release.

### The harness

- **Kernel** — the agent loop as a state machine: assemble context → stream the model → dispatch tools through guardrails → feed results back, within a per-turn tool budget, abortable at every await.
- **Context** — layered assembly: base system prompt, fresh per-turn environment (current tab, open tabs, time, locale), persisted session history.
- **Tools** — registry + built-in packs (page / tabs / browser data / skills) + MCP mount (Streamable HTTP, no SDK). One `ToolDefinition` file = one tool, spec derived from its Zod schema.
- **Engine** (`page_act`) — whole-page semantic perception (shadow roots, same-origin iframes, occlusion), fingerprint grounding across re-renders, adapter-aware execution (`dom` / `cdp` channels), post-condition verification against the live DOM, diagnosis-driven healing under hard budgets.
- **Observed-facts reconciliation** — pre/post snapshots diffed into facts that overrule model predictions in both directions; `list_count_delta` page-truth baseline catches fake success (toast shown, nothing persisted).
- **Guardrails** — risk tiers (`read` / `act` / `dangerous`), per-tool authorization memory, site allow/blocklists, dangerous-action confirmation, sensitive-value redaction, full audit log; optional Chrome permissions requested on first use.
- **Skills & batch** — verified runs extracted into parameterized skills; compiled deterministic replay with per-step verification and per-row delivery cross-checked against the page.
- **Model port** — OpenAI-compatible / OpenAI Responses / Anthropic providers with native streaming tool calls, automatic prompted-JSON degradation for endpoints without native tools, deterministic scripted mock for tests.
- **UI** — chat-first side panel with the live `page_act` step timeline and per-check evidence; options and onboarding surfaces; zh-CN + en-US i18n; black-and-white flat + frosted-glass design system.

### Tests and benchmark

- Reproducible benchmark versus a deliberate replica of the viewport-agent architecture (`pnpm bench` → `docs/benchmark.md`).
- Headless engine checks (`pnpm test:engine`), full-loop extension e2e on a scripted mock model (`pnpm test:e2e`), screenshot sweep (`pnpm shots`).

[0.0.1]: https://github.com/uiuing/browser-agent/releases/tag/v0.0.1

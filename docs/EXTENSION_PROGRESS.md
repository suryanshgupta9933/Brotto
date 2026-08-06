# Browser Extension — Progress & Status

> Last updated: 2026-08-06. Tracks what is built, what is half-built, what
> is stubbed, and what is missing for the Claude-in-Chrome-style demo.

## Current state (post-pivot)

The extension is now a **side panel extension** (Manifest V3, `chrome.sidePanel`). It runs against the user's actual Chrome — no Playwright in the demo path.

| Layer | Status | Notes |
|---|---|---|
| Manifest | ✅ updated | `side_panel` + `sidePanel` permission; no popup |
| UI | ✅ new | `sidepanel.html` + `sidepanel.js` (Claude-in-Chrome layout) |
| Live activity stream | ✅ | Step cards with action icon, URL badge, optional screenshot |
| Login prompt | ✅ | Inline amber card with Continue + Skip-task buttons |
| Clarifying question | ✅ UI | Inline amber card with input + Submit (planner hook pending) |
| Critical decision (action approval) | ✅ UI | Inline amber card with Approve + Deny |
| Driver loop | ✅ wired | `local-driver.ts` calls demo-server /plan, executes via chrome.debugger |
| Demo path | ✅ no Playwright | `scripts/demo-browser.ts` deleted |
| Side panel ↔ popup parity | ✅ | popup.html / popup.js removed; everything flows through sidepanel.js |

## Demo path (no Playwright)

1. `cd services/brotto-orchestrator && pnpm demo:server` (Fastify HTTP on `:3001`)
2. `cd clients/brotto-extension && pnpm build` (produces `dist/`)
3. Chrome → `chrome://extensions` → Developer mode → Load unpacked → select `dist/`
4. Click the Brotto action icon → side panel opens
5. Enter goal + starting URL → Run → extension captures observation, posts to demo-server, executes via chrome.debugger, repeats
6. Login page detected → side panel shows Continue button → user logs in manually → clicks Continue → loop resumes

## What is built and working

### Orchestrator side (`services/brotto-orchestrator/`)
- ✅ OpenAI-compatible planner adapter (Brotto, OpenAI, Azure, Ollama) — gpt-4o-mini login task completes in 6 steps
- ✅ Step history in prompt (last 6 actions + their results)
- ✅ Context rendering layer (`src/context/render.ts` — stable IDs, hierarchical tree, inline coords, change diff, page text)
- ✅ Retry-after-aware backoff for transient 429s
- ✅ Vision toggle (env `DEMO_VISION=1`)
- ✅ `pnpm demo:server` (HTTP planner endpoint) — Playwright path removed

### Extension side (`clients/brotto-extension/src/`)
- ✅ Side panel UI (`sidepanel.html` + `sidepanel.js`) — Claude-in-Chrome layout
- ✅ `local-driver.ts` — opens new tab per task, captures observation via `canonical/observation.ts`, posts to demo-server, executes via chrome.debugger
- ✅ Login pause — detected by password input + submit button, blocks loop via shared resolver
- ✅ Canonical controller (`canonical/controller.ts`) — task lifecycle, transport, observation, action executor
- ✅ Canonical transport (`canonical/transport.ts`) — HMAC-signed WSS envelopes, replay protection
- ✅ Canonical action executor (`canonical/action-executor.ts`) — strict 5-CDP-method allowlist, ref matching
- ✅ Canonical observation (`canonical/observation.ts`) — DOM + AX tree + screenshot
- ✅ Stable element refs (`canonical/stable-ref.ts`, `canonical/ref-matcher.ts`) — SHA-256 content hash

### Legacy extension files (kept, not used)
- ✅ `src/action-executor.ts` (root) — full action mapping, includes `waiting_for_login` and `save_session` action types. Unused at runtime (manifest loads the build output of `background.ts`, which uses `canonical/action-executor.ts`).
- ⚠️ `src/relay.ts` (root) — older WSS + CDP tunnel code, not wired into canonical/. Could be deleted; kept for reference.

## What is half-built (stubs / placeholders)

| Component | Status | Location |
|---|---|---|
| Orchestrator `run()` loop TODOs | `recentResults: []`, `trajectory: []` literals | `services/brotto-orchestrator/src/server.ts:316-317` |
| Orchestrator `buildEmptyObservation()` | Returns zeros; `lastObservation` not threaded into `plan()` | `services/brotto-orchestrator/src/server.ts:351-362` |
| CDP relay service `DefaultUpstreamFactory` | Returns `errors.New("upstream factory not configured")` | `services/cdp-relay/internal/tunnel/tunnel.go:74-79` |
| Clarifying-question plumbing | UI exists; local-driver doesn't yet emit `QuestionProposal` | `clients/brotto-extension/src/local-driver.ts` |

## What is missing for production

- ❌ Server-driven action.command: canonical controller handles `action.command` over WSS but nothing sends it. The orchestrator's `ActionTransportHub` exists but isn't connected to a planner.
- ❌ Self-healing ref matching in local-driver: local-driver uses raw `chrome.debugger.sendCommand` with model-provided coordinates. Canonical action executor does DPR/zoom transforms + ref matching; local-driver bypasses them.
- ❌ Screenshot thumbnails in step cards: sidepanel.js has the `<img>` slot but `observation.screenshot` isn't forwarded through the local-driver's renderer.

## Verification status

| Check | Last run | Result |
|---|---|---|
| `pnpm demo:server` + manual extension run | 2026-08-06 | **NOT VERIFIED** in real Chrome yet |
| `node test.mjs` (extension Jest) | 2026-08-06 | 204/206. 3 pre-existing failures in `canonical-transport.test.ts`, `redaction.test.ts`, `relay.test.ts`. |
| `pnpm tsc --noEmit` (extension) | 2026-08-06 | clean |
| `pnpm build` (extension) | 2026-08-06 | clean — `dist/{background.js,manifest.json,sidepanel.html,sidepanel.js}` produced |
| Demo regression (Playwright + gpt-4o-mini) | 2026-08-06 (before Playwright removal) | 6 steps, success=true, ~13s. 3/3 runs. |

## Open questions

1. **Visual step grouping**: Claude in Chrome groups steps by sub-goal. Should I add sub-goal grouping to the side panel? (Defer if not blocking tomorrow's demo.)
2. **Screenshot in step card**: forward `observation.screenshot` (base64 PNG) through canonical/observation.ts so the side panel can show thumbnails. (Defer.)
3. **Server-driven path (canonical controller → orchestrator WSS)**: not built. After tomorrow's demo, this becomes the production slice. (Defer.)

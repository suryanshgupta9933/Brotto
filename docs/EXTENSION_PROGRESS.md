# Browser Extension — Progress & Status

> Last updated: 2026-08-06. Tracks what is built, what is half-built, what
> is stubbed, and what is missing for the Claude-in-Chrome-style demo.

## TL;DR — Two parallel implementations coexist

The extension has **two parallel codebases** in the same package:

| | Legacy (currently loaded) | Canonical (newer, not loaded) |
|---|---|---|
| Service worker | `background.js` (plain JS, 209 lines) | `background.ts` (TS, 393 lines) |
| UI | `popup.js` (plain JS, 307 lines) + `popup.html` | Same `popup.html` (refs `popup.js`) |
| Action executor | `src/action-executor.ts` (root, 369 lines, full actions incl. `waiting_for_login`) | `src/canonical/action-executor.ts` (heavily guarded) |
| Transport | `src/relay.ts` (root, has WSS + CDP tunnel, not wired) | `src/canonical/transport.ts` (HMAC-signed envelopes, replay-protected) |
| Planner loop | Self-driven (`controller.startTask`) | Server-driven (waits for `action.command` over WSS) |
| Manifest points to | `background.js` | — (would need rewire) |

**`background.js` has placeholder imports** (lines 197-206) — `pairing`,
`debuggerModule`, `relay` are stub objects with no real implementation. So
the legacy code loads but **cannot actually drive a browser**.

The newer `canonical/` code is wired correctly but is not what the manifest
loads. To use it we'd need to compile `background.ts` → `background.js` and
update manifest, OR change manifest to reference the TS-compiled output.

## What is built and working

### Orchestrator side (`services/agent-orchestrator/`)
- ✅ OpenAI-compatible planner adapter (Fara, OpenAI, Azure, Ollama) — gpt-4o-mini login task completes in 6 steps, verified 3/3 runs both text-only and vision-on
- ✅ Step history in prompt (last 6 actions + their results)
- ✅ Context rendering layer (`src/context/render.ts` — stable IDs, hierarchical tree, inline coords, change diff, page text)
- ✅ Retry-after-aware backoff for transient 429s
- ✅ Vision toggle (env `DEMO_VISION=1`)
- ✅ Demo loop: `pnpm demo:server` + `pnpm demo:browser` against Playwright Chromium

### Canonical extension side (`clients/browser-extension/src/canonical/`)
- ✅ `CanonicalExtensionController` — task lifecycle (startTask, cancel, restore, reconnect)
- ✅ `CanonicalTransport` — HMAC-signed WSS envelopes, sequence numbers, reconnect with backoff, replay protection
- ✅ `CanonicalActionExecutor` — strict 5-CDP-method allowlist (`Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, `Input.insertText`, `Page.navigate`, `Page.getNavigationHistory`), DPR/zoom transforms, ref matching
- ✅ `CanonicalExecutionPipeline` — policy enforcement, observation authority, DNS resolver, settlement, permits
- ✅ `captureObservation` — DOM + AX tree + screenshot with sensitive-pattern masking
- ✅ AX snapshot (`Accessibility.getFullAXTree`)
- ✅ Stable element refs (SHA-256 content hash + self-healing ref matcher)
- ✅ Device pairing (WebCrypto key pair, challenge-response)
- ✅ Popup UI shell — task input, trajectory log (live activity stream), approval panel, login prompt, result panel

### Legacy extension side (`clients/browser-extension/src/`)
- ✅ `popup.html` + `popup.js` — same UI shell, but plain JS
- ✅ `action-executor.ts` (root) — full action mapping, includes `waiting_for_login` and `save_session` action types
- ⚠️ `relay.ts` (root) — full WSS + CDP tunnel code, but not wired into any background script
- ❌ `background.js` — placeholder imports, **not functional**

## What is half-built (stubs / placeholders)

| Component | Status | Location |
|---|---|---|
| Orchestrator `run()` loop TODOs | `recentResults: []`, `trajectory: []` literals | `services/agent-orchestrator/src/server.ts:316-317` |
| Orchestrator `buildEmptyObservation()` | Returns zeros; `lastObservation` not threaded into `plan()` | `services/agent-orchestrator/src/server.ts:351-362` |
| `pairing.ts` (canonical) | OK if loaded via canonical `controller.startTask`, but not wired into active service worker | `clients/browser-extension/src/pairing.ts` |
| CDP relay service `DefaultUpstreamFactory` | Returns `errors.New("upstream factory not configured")` | `services/cdp-relay/internal/tunnel/tunnel.go:74-79` |
| `relay.ts` (root) WSS client | Code exists, no caller in active service worker | `clients/browser-extension/src/relay.ts` |

## What is missing (for Claude-in-Chrome-style demo)

### UI (live activity stream + mid-task prompts)
- ❌ **Live activity stream**: the existing `logContent` div shows step summaries but no screenshots, no inline page preview. Claude in Chrome shows a card per action with a screenshot thumbnail and the actual element highlighted.
- ❌ **Clarifying-question prompt**: popup has no UI for "the model needs more info from the user." The `QuestionProposal` outcome from the planner has no popup surface.
- ❌ **Critical-decision prompt**: popup has `approvalPanel` for action approval but no general "the model wants to confirm a destructive action" card.
- ❌ **Side panel UI**: the manifest is `popup` (Chrome action), not `side_panel`. Claude in Chrome uses Chrome's side panel API for a persistent surface that doesn't close when the user clicks away.
- ❌ **Visual step grouping**: log entries are flat; Claude in Chrome groups by sub-goal.

### Wiring
- ❌ **Compiled canonical service worker**: `manifest.json` references `background.js` (legacy). Need to either compile `background.ts` → `background.js` or change manifest to load a built output.
- ❌ **Server-driven action.command**: the canonical controller handles `action.command` over WSS but nothing sends it. The orchestrator's `ActionTransportHub` exists but isn't connected to a planner (because of `buildEmptyObservation` and the TODOs).
- ❌ **Login page auto-detection**: my local-driver has a heuristic (`looksLikeLoginPage` in `src/context/render.ts` + a detector in `src/local-driver.ts`) but the canonical controller has no equivalent. The `login_complete` message in popup.js points to a canonical `submitFreshObservation` that exists in controller.ts:621.

### Removed for the demo path
- ❌ **Playwright Chromium from the demo**: my `local-driver.ts` uses `chrome.debugger` directly (no Playwright). But `services/agent-orchestrator/scripts/demo-browser.ts` is Playwright-based and is no longer the demo path — the demo now uses the user's actual Chrome with the extension installed.

## What I just added in this session (the pivot)

| File | What | Status |
|---|---|---|
| `services/agent-orchestrator/src/context/render.ts` (NEW) | Pure rendering: `renderSnapshot`, `diffSnapshots`, `renderHistory`, `looksLikeLoginPage`, `describeAction`, `describeDiff`. No Playwright dep. | ✅ typed, demo regression passes |
| `services/agent-orchestrator/src/context/types.ts` (NEW) | `ElementState`, `PageSnapshot`, `HistoryEntry` types | ✅ |
| `services/agent-orchestrator/src/inference-registry.ts` (MOD) | Added `buildPlannerConfigFromEnv()` (mirrors demo-server) | ✅ |
| `services/agent-orchestrator/src/server.ts` (MOD) | `createOrchestrator` defaults to env-derived planner config | ✅ |
| `services/agent-orchestrator/src/parser.ts` (MOD) | `wait` defaults to 1000ms (was throwing on missing arg) | ✅ |
| `services/agent-orchestrator/src/adapters/openai-compatible-planner.ts` (MOD) | `Retry-After` propagation, image content block, generalized prompt | ✅ |
| `services/agent-orchestrator/scripts/demo-server.ts` (MOD) | Screenshot passthrough, 429 retry with backoff | ✅ |
| `services/agent-orchestrator/scripts/demo-browser.ts` (MOD) | Step history buffer, terminate-as-completion, snapshot race retry | ✅ |
| `clients/browser-extension/src/local-driver.ts` (NEW) | Parallel loop driver: opens new tab, captures observation, POSTs to demo-server /plan, executes via chrome.debugger. Has login pause. **Redundant with canonical controller** — should be removed. | ⚠️ typed, not runtime-verified |
| `clients/browser-extension/src/background.ts` (MOD) | Added `run_local_task` / `cancel_local_task` / `local_login_complete` / `local_login_skip` handlers | ⚠️ wired into TS source only; manifest loads the JS |
| `clients/browser-extension/src/canonical/controller.ts` (MOD) | `ControllerUiEvent` extended with `login_required` and `task_completed` | ✅ |
| `clients/browser-extension/src/popup.html` (MOD) | Added "Local task (demo)" card with starting URL + planner URL inputs | ✅ |
| `clients/browser-extension/src/popup.js` (MOD) | Wired local-driver UI; loginComplete dispatches to whichever mode is awaiting | ✅ |

## Open questions before continuing

1. **Which extension implementation is "the" extension?** The legacy `.js` + `popup.js` (manifest-loaded, but stubbed and not functional) or the newer canonical/ folder (functional but not wired into the manifest)? I built on top of both and made things worse.
2. **Side panel or popup?** Claude in Chrome uses side panel. Current manifest is `popup`. Side panel migration is a real change (different chrome API, different UX constraints).
3. **Should my `local-driver.ts` be removed?** It duplicates the canonical controller's loop. If we use canonical, local-driver is dead code.
4. **Where does the planner live for the demo?** Option A: local-driver → demo-server HTTP (no orchestrator needed). Option B: canonical controller → orchestrator WSS (B3/B4 work).
5. **What gets removed?** Playwright from `scripts/demo-browser.ts` (the demo path is now extension-driven, not browser-driven).

## Recommendation for tomorrow's demo

**Path A — minimum change, works today:**

1. Compile `background.ts` → `background.js`, update manifest (or build step that does this)
2. **Delete my `local-driver.ts` and its wiring** — duplicates canonical
3. Use the canonical controller as-is. It runs a self-driven loop and submits observations to a server. Server needs a working planner.
4. For the planner: have the controller call a local HTTP endpoint (demo-server). Bypass the WSS path for the demo. This is the same shape as my local-driver but reuses the canonical controller.
5. Add clarifying-question UI (1-2 hours)
6. Add critical-decision prompt (1 hour)
7. Live activity stream upgrade (screenshot thumbnails, sub-goal grouping) — defer or skip for tomorrow

**Path B — proper Claude-in-Chrome architecture (more work):**

1. Migrate to side panel
2. Wire canonical controller → orchestrator WSS → orchestrator planner (B3 + B4 work)
3. Live activity stream with screenshot thumbnails
4. All mid-task prompts (login, question, decision)

For tomorrow, Path A is the right call. Path B is a 2-week slice.

## Verification status

| Check | Last run | Result |
|---|---|---|
| `pnpm test:e2e` (Playwright + Ollama) | — | not run this session |
| `pnpm demo:server` + `pnpm demo:browser` (login task, gpt-4o-mini) | 2026-08-06 | 6 steps, success=true, ~13s. 3/3 runs. |
| `node test.mjs` (extension Jest suite) | 2026-08-06 | 204/206 pass. 2 failures in `relay.test.ts` pre-existing (unrelated to my changes). |
| `pnpm tsc --noEmit` (extension) | 2026-08-06 | clean |
| `pnpm tsc --noEmit` (orchestrator) | 2026-08-06 | clean for my files. Pre-existing errors in `session-engine.ts` unrelated. |
| Real Chrome extension install + local-driver run | — | **NOT VERIFIED** |

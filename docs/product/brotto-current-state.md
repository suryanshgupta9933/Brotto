# Brotto — Current State (Sept 2026)

Code-grounded audit of what's actually built today. **Read when working on the codebase or planning a change.** Update when a feature ships, gets ripped, or its scope changes.

## Architecture: two-process split

- **Python orchestrator** — `services/brotto-orchestrator/`
  - `main.py` (~715 LOC) — FastAPI app + WebSocket handlers
  - `agent/harness.py` (1,280 LOC) — observe→plan→act loop
  - `agent/context.py` — action vocabulary (13 actions, see below)
  - `model/{config,registry,store,resolver}.py` — provider-agnostic model adapter
  - `policy/` — secure-mode policy + persistence
- **Chrome MV3 extension** — `clients/brotto-extension/`
  - `background.ts` (976 LOC) — CDP relay
  - `sidepanel.html` (~2,213 LOC compiled) — UI
  - `model_config.ts`, `content.js`, `debugger.ts`

## Wire protocol

Two WebSocket paths:
- `/ws/ext/{session_id}` — extension browser control. Frames: `task_start | observation | human_reply | ping` from extension; `observe | action | step_progress | ask_human | task_result | policy_effective | approval_required | login_required | stagnation_warning` from server.
- `/ws/{user_id}` — Playwright headless clients (token-gated; off by default via `AGENT_AUTH_DISABLED=true`).

HTTP: `POST /v1/sessions`, `POST /v1/policy_ack`, `GET /v1/policy`, `GET /context`, `GET /health`, `POST /run` (dev).

**Identity = client IP** (no auth). Policies and per-user configs keyed by `request.client.host`, hashed (`sha256`[:32]) for disk filenames.

## Agent loop (`agent/harness.py`)

Single-threaded observe→plan→act, max **30 steps** (`MAX_STEPS`). Per step:
1. Observe — `get_targets()` (AX tree from extension) + URL + title. Filtered/diffed.
2. Guardrail — `check_login_page` regex (4 strong + 4 weak markers; title/URL-authoritative). On hit: emit `login_required`, pause 300s, await "resume"/"skip".
3. Stagnation — 3-step window; emit `stagnation_warning` if URL/actions repeat.
4. Plan — `agent.run(turn)` via pydantic-ai with `AgentDecision` Pydantic model. Per-task model via `resolve_model_config` (inline > per-user > env).
5. Secure-mode approval — `sensitive_actions` list (default: `submit_form | delete_record | payment | transfer | change_password | revoke_access | publish | deploy | send_email | external_post | approve | reject`).
7. First-time-seen `(domain, action)` cache — approval card.
8. Execute — `_execute_action` for each action in batch.
9. Persist — `RunLogger` writes `logs/runs/<task_id>/{step.jsonl, scratchpad.txt, policy.log}`.

## Action vocabulary (13 actions, `agent/context.py:90-99`)

`navigate`, `click`, `type_text`, `scroll`, `find_element`, `read_page_text`, `write_scratchpad`, `append_scratchpad`, `read_scratchpad`, `recall_memory`, `task_complete`, `cannot_complete`, `ask_human`. No `fill_form`, no `select_option`, no `hover`, no `drag`. `type_text` is char-by-char via `Input.dispatchKeyEvent`.

**CDP commands actually sent** (`background.ts:252-275`): `Page.navigate`, `Input.dispatchMouseEvent` (pressed/released/wheel), `Input.dispatchKeyEvent` (char/keyDown/keyUp). Read: `Accessibility.getFullAXTree` + `DOM.getBoxModel` + `Runtime.evaluate`. **No `Page.captureScreenshot`** despite README claiming it.

## Policy model

Two modes: `normal` (no gates) and `secure` (gates fire). Floor policy from `BROTTO_POLICY_FILE` or `./policy.json` (JSON only — YAML `NotImplementedError`). User policy per `task_start`/`policy_acknowledged`; merged via `merge()` — secure sticky upward, blacklists union.

**Secure-mode gates (in order):**
- Observe-phase `check_domain_policy(url)` against eTLD+1 — `BLOCK` ends task.
- Navigate pre-flight: same block check; first navigation to new eTLD+1 prompts ("first_navigation").
- Click post-check: re-evaluates `get_current_url()` after click for cross-domain redirect.
- `sensitive_actions` list — approval card.
- `(domain, action)` first-time-seen cache — approval card.
- `CRITICAL_PATTERNS` regex — approval card (also fires in normal mode).

**Domain matching:** `etld1()` with ~50-entry embedded multi-part suffix list (`policy/domains.py:26-44`). Custom; comment names `tldextract` as upgrade path. IP literals return `None`.

**Login detection** (`agent/guardrails.py:44-84`): title/URL-authoritative; AX-tree strong markers rejected as too noisy. "Session expired" force-triggers. 300s timeout.

**Prompt-injection defense** (system prompt): trust hierarchy system → user task → page content. Explicit patterns to ignore ("ignore previous instructions", "you are now X", "the user already approved").

**No sandboxing** beyond gates. Agent runs with whatever credentials the user's browser session has.

## UX surface (extension)

Side panel renders: task input + Start/Cancel, tab bar, Settings panel (server URL + provider/model/key form + policy editor), live step cards (action icon, thought, URL, expand-to-show actions[]), context utilization %, "SECURE" badge, approval cards, login pause card, task completed/failed bubbles with `extracted_data`, per-component timing breakdown (`observe`, `model_plan`, `execute`, `login_pause`, `approval_pause`). Reconnect banner (3 × 5s). No telemetry. No account UI. No onboarding.

Service worker owns: tab lifecycle (`tab.openerTabId`), debugger attach/detach per active tab, heartbeat (20s ping / 30s deadline), session persistence in `chrome.storage.session`, user-policy hydration on init.

## Model adapter

Three hardcoded providers in `model/registry.py`:
- `anthropic` — `claude-3-5-sonnet-latest` (200k)
- `openai` — `gpt-4o`, `gpt-4o-mini`, `o1`
- `minimax` — alias for `AnthropicFactory` with `base_url=https://api.minimax.io/anthropic`; `MiniMax-M3.1-Flash-Preview` (1M, Token Plan), `MiniMax-M3` (1M, pay-as-you-go — 402 without credits), `MiniMax-M2.7` (204k), `MiniMax-M2.7-highspeed` (204k)

**No Gemini, Mistral, DeepSeek, Ollama/local.** Adding one = `ProviderFactory` subclass + registry entry.

## BYOK flow

`model_config` → `chrome.storage.local` (persists); `api_key` → `chrome.storage.session` (in-memory, dies on browser restart — intentional, "disk leak avoided"). On `task_start`, both sent over WS inline. Server validates provider is in registry; builds pydantic-ai `Model`. Per-user config (`remember_key=true`) persisted to `logs/user_configs/<ip_hash>.json` keyed by IP. Env fallback: `AGENT_MODEL=provider:model`, `ANTHROPIC_API_KEY` / `AUTH_TOKEN`.

Dev default: `anthropic:MiniMax-M3.1-Flash-Preview`, 1M context. `BROTTO_ENV=prod` opts out. `AUTH_TOKEN → API_KEY` propagation for Token Plan users.

## What's well-built (the moat ingredients)

- **CDP-via-extension** — inherits the user's authenticated browser session.
- **AX tree** — stable refs, no vision model needed.
- **Three-tier BYOK + session-only key storage** — privacy by design.
- **Token Plan ergonomics** — `AUTH_TOKEN → API_KEY` propagation.
- **Sticky-up policy merge** — floor is enforceable.
- **Per-component timing** in `TaskResult.timing` — wall-time breakdown.
- **Prompt-injection trust hierarchy** in system prompt.
- **Memory = skills pattern** — `read_page_text` auto-captures 200-char digests; `recall_memory(id)` loads full body. Primitive that persistent-memory wishlist calls for.
- **`defer_model_check=True`** — per-task model from factory; no Agent rebuild.

## Wave 0 blockers — perception (found 2026-09-28)

Verified by repo-wide grep on 2026-09-28. These gate the "works on the sites behind your login" claim and block Wave 0A. Detail in `docs/superpowers/specs/2026-09-28-capability-map-design.md`.

| Gap | Evidence |
|---|---|
| No shadow DOM traversal | `grep -rn "shadowRoot"` returns nothing. Component-library sites are invisible |
| No iframe traversal | Only `iframe` hit is `agent/prompt.py:68`, a prompt line conceding cross-origin iframes are unseen. Payment fields, reCAPTCHA, third-party embeds unreachable |
| No canvas / screenshot fallback | No `canvas` handling; no `Page.captureScreenshot` despite README claiming it |
| No `aria-hidden` reconciliation | AX tree consumed as-is; elements hidden from AX but present in DOM are neither seen nor targetable |
| No dynamic-stability wait | No `MutationObserver` / `networkIdle` / `DOMContentLoaded` handling. AX tree read at an arbitrary instant on heavy-JS pages |
| Observation hard-capped | `ax_filter.py:17` `MAX_CHARS = 6000` (truncated with "scroll to reveal more"); `dev/playwright_browser.py:100` `max_targets=50`; `read_page_text` caps at 2000 chars. Structurally blind past the first screen on inboxes/dashboards/tables |
| Auth code present but unwired | `session/auth.py` has `validate_token`, but `/ws/ext/{session_id}` never calls it and `AGENT_AUTH_DISABLED` defaults to `"true"` |

## Real gaps (in priority order)

| # | Gap | Evidence | Impact |
|---|---|---|---|
| 1 | No auth on `/ws/ext` | `main.py` exposes `WebSocket: /ws/ext/{session_id}` with no token | Anyone reaching the server runs tasks |
| 2 | No multi-user / accounts | Identity = `request.client.host` → sha256[:32] | NAT collisions, shared IPs |
| 3 | No billing / quota | MiniMax-M3 calls API with user key; server has no spend tracking | No revenue, no rate-limit |
| 4 | No telemetry / analytics | Only `logging.basicConfig` to stdout | No observability into fleet |
| 5 | No task history UI | JSONL in `logs/runs/<task_id>/` but no `/v1/tasks` endpoint, no replay | Users can't revisit past runs |
| 6 | No onboarding | README handwaves "configure server URL"; no first-run wizard, no auth | 90% activation drop |
| 7 | No Chrome Web Store dist | "From Chrome Web Store (when published)" stub | Sideloading only |
| 8 | Limited action surface | No `hover`, `drag`, `select_option`, native `fill_form` | Brittle on real apps |
| 9 | No multi-tab parallelism | `activeTabId` is single; "A task is already running" rejected | Hard ceiling on power use |
| 10 | WS URL bug | `startRelay` ignores user-supplied `serverUrl` for WS URL | Remote users silently hit localhost |
| 11 | 188 tests, no extension tests | Python only; no JS runner, no real-browser integration | Regression risk |
| 12 | Stale docs | `decisions.md` describes Playwright-only architecture; README refs non-existent `crypto.ts`, `pairing.ts`, `popup.tsx` | Misleading for new contributors |
| 13 | Unused code | `contracts.py` `ObservationV1`/`BrowserAction`, `domain/`, `context/` subpackages unused | Dead code rot |

## When to update this doc

- Feature ships → add to "well-built" or "action vocabulary"
- Feature gets ripped → remove from "well-built"
- Code-grounded fact changes (count, command, behavior) → update in place
- New gap discovered → add to "real gaps" table
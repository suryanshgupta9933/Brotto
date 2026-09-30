# Brotto — Current State (Sept 2026)

Code-grounded audit of what's actually built today. **Read when working on the codebase or planning a change.** Update when a feature ships, gets ripped, or its scope changes.

## Architecture: two-process split

- **Python orchestrator** — `services/brotto-orchestrator/`
  - `main.py` (~715 LOC) — FastAPI app + WebSocket handlers
  - `agent/harness.py` (1,280 LOC) — observe→plan→act loop
  - `agent/context.py` — action vocabulary (16 actions, see below)
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

Single-threaded observe→plan→act, `MAX_STEPS = 150` — a runaway backstop, **not** a limit on the user. Per step:
1. Observe — `get_targets()` (AX tree from extension) + URL + title. Filtered/diffed.
2. Guardrail — `check_login_page` regex (4 strong + 4 weak markers; title/URL-authoritative). On hit: emit `login_required`, pause 300s, await "resume"/"skip".
3. ~~Stagnation~~ — removed. Both of its observed effects were harmful (it
   pushed working agents toward reporting early, and warned during a task that
   succeeded). The model self-assesses in the prompt instead. See the
   "Stagnation detection — removed" section of `CLAUDE.md`.
4. Plan — `agent.run(turn)` via pydantic-ai with `AgentDecision` Pydantic model. Per-task model via `resolve_model_config` (inline > per-user > env). **No `message_history`** — the prompt is rebuilt each step from `step_summaries` + `scratchpad`, which is what makes resume possible.
5. Secure-mode approval — `sensitive_actions` list (default: `submit_form | delete_record | payment | transfer | change_password | revoke_access | publish | deploy | send_email | external_post | approve | reject`).
7. First-time-seen `(domain, action)` cache — approval card.
8. Execute — `_execute_action` for each action in batch.
9. Persist — `AuditTrail` flushes the whole session document on every record (see below).

## Audit trail (`agent/audit.py`)

One nested-JSON document per session at `logs/sessions/<session_id>.json`.
A **session is a conversation**: one `session_id` is reused for every task the
user runs in it, not one per run. `schema_version: 2` therefore holds three
collections — `tasks[]` (one entry per task, the segmentation), `messages[]`
(the transcript a human reads, one per user message and one per completed
turn), and `turns[]` (the audit, each turn carrying `task` so the transcript
can be joined to its task). Each turn is
`observation → model → prompts[] → actions[]` in that causal order, plus
root-level `totals`, `policy_events[]`, `errors[]`, `status`, and a
`scratchpad` snapshot. Written atomically (tmp file + `os.replace`), so a crash
mid-write leaves the last good document rather than a truncated one.
**No database — the file is the record.**

Served by `GET /v1/sessions/{id}/audit`, listed by `GET /v1/sessions`, and
rendered by the panel's transcript view, so a conversation can be replayed in
the order it happened, grouped by task. Redaction of typed secrets happens at
write time (`is_secret_field`), and the document is the only place a typed
value lands.

`task_start` carries `resume: bool`, and it is the whole lifecycle fork:
`true` is crash resume, `false` (including an absent field, since an extension
predating the flag never reconnects with resume intent) appends a new task to
the same conversation. `_conversation_state()` in the harness returns
`new_task` / `resume` / `refuse` and is the only place that decides.

**Resume** reconstructs `step_summaries` and `visited_domains` from the
document and continues at the last *completed* turn. The extension reconnects
with backoff, reusing the `session_id`; a user-cancelled run is sealed
`cancelled` and never resumed — but the *conversation* survives it, so a
message typed after a cancel starts a new task in the same session rather than
a new session. A corrupt or already-finished document is reported as
`interrupted` rather than silently restarted.

This retired `agent/run_logger.py`, which wrote a `type_text` action's full
args — including passwords — to `steps.jsonl` in the clear.

## Action vocabulary (16 actions, `agent/context.py:100-106`)

`navigate`, `click`, `type_text`, `press_key`, `scroll`, `find_element`, `read_page_text`, `write_scratchpad`, `append_scratchpad`, `read_scratchpad`, `recall_memory`, `recall_conversation`, `recall_steps`, `task_complete`, `cannot_complete`, `ask_human`. No `fill_form`, no `select_option`, no `hover`, no `drag`. `type_text` is char-by-char via `Input.dispatchKeyEvent`.

`press_key` exists because `type_text` only inserts. A combobox — Gmail's search box is the canonical one — commits on Enter, and an agent with no way to press it reads the same results forever. Both it and `clear_ref` send CDP's modifier bitmask (Alt=1, Ctrl=2, Meta=4, Shift=8); the extension forwards it, and an earlier version dropped it, so `clear_ref` typed a literal `a` instead of selecting the field.

The three retrieval actions exist for the same reason: the harness is stateless per step, so the prompt re-sends a *window* every step and the full text has to be reachable on demand. `recall_memory` fetches a scratchpad entry body by id; `recall_conversation` fetches earlier messages of the session's conversation by id or id span; `recall_steps` fetches a step range of the current task. The `<conversation>` block ships first 2 + last 6 messages, head+tail within each at 1200 chars, and names the id range it dropped. The step-history block ships first 3 + last 9 summaries and names the step range it dropped. A window with no way back to what it dropped is a one-way door.

**CDP commands actually sent** (`background.ts:252-275`): `Page.navigate`, `Input.dispatchMouseEvent` (pressed/released/wheel), `Input.dispatchKeyEvent` (char/keyDown/keyUp). Read: `Accessibility.getFullAXTree` + `DOM.getBoxModel` + `Runtime.evaluate`. **No `Page.captureScreenshot`** despite README claiming it.

## Policy model

Two modes: `normal` (no gates) and `secure` (gates fire). Domain blocking is **one list — the user's**. There is no server floor: `FLOOR_POLICY` and `BROTTO_POLICY_FILE` are gone, because a self-hosted install never shipped a `policy.json`, so the floor was always empty and every three-way union described a distinction that never occurred. User policy per `task_start`/`policy_acknowledged`. `Policy`/`UserPolicy` keep their old field names so files written against `whitelist`/`block_blacklisted` still parse.

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

Side panel renders: task input + Start/Cancel, tab bar, Settings panel (server URL + provider/model/key form + policy editor), live step cards (action icon, thought, URL, expand-to-show actions[]), context utilization %, "SECURE" badge, approval cards, login pause card, task completed/failed bubbles with `extracted_data`, per-component timing breakdown (`observe`, `model_plan`, `execute`, `login_pause`, `approval_pause`), a session-history list (one row per conversation, with its task count), and a per-session transcript overlay that swaps the list for the conversation's messages, grouped by task, in order. "Reconnecting, attempt N" banner on a dropped socket (6 attempts, full jitter, 1s→30s). No telemetry. No account UI. No onboarding.

Service worker owns: tab lifecycle (`tab.openerTabId`), debugger attach/detach per active tab, heartbeat (20s ping / 30s deadline), session persistence in `chrome.storage.session`, user-policy hydration on init.

## Model adapter

Three hardcoded providers in `model/registry.py`:
- `anthropic` — `claude-3-5-sonnet-latest` (200k)
- `openai` — `gpt-4o`, `gpt-4o-mini`, `o1`
- `minimax` — alias for `AnthropicFactory` with `base_url=https://api.minimax.io/anthropic`; `MiniMax-M3.1-Flash-Preview` (1M, Token Plan), `MiniMax-M3` (1M, pay-as-you-go — 402 without credits), `MiniMax-M2.7` (204k), `MiniMax-M2.7-highspeed` (204k)

**No Gemini, Mistral, DeepSeek, Ollama/local.** Adding one = `ProviderFactory` subclass + registry entry.

## BYOK flow

`model_config` → `chrome.storage.local` (persists); `api_key` → `chrome.storage.session` (in-memory, dies on browser restart — intentional, "disk leak avoided"). On `task_start`, both sent over WS inline. Server validates provider is in registry; builds pydantic-ai `Model`. Per-user config (`remember_key=true`) persisted to `logs/user_configs/<ip_hash>.json` keyed by IP. Env fallback: `AGENT_MODEL=provider:model`, `ANTHROPIC_API_KEY` / `AUTH_TOKEN`.

Dev default: `minimax:MiniMax-M3`, 1M context. `BROTTO_ENV=prod` opts out. `AUTH_TOKEN → API_KEY` propagation for Token Plan users. M3, not M3.1-Flash-Preview: Flash *requires* adaptive thinking and rejects `thinking.type="disabled"` with a 400.

## What's well-built (the moat ingredients)

- **CDP-via-extension** — inherits the user's authenticated browser session.
- **AX tree** — stable refs, no vision model needed.
- **Three-tier BYOK + session-only key storage** — privacy by design.
- **Token Plan ergonomics** — `AUTH_TOKEN → API_KEY` propagation.
- **Sticky-up policy merge** — floor is enforceable.
- **Per-component timing** in `TaskResult.timing` — wall-time breakdown.
- **Prompt-injection trust hierarchy** in system prompt.
- **Memory = skills pattern** — `read_page_text` auto-captures 200-char digests; `recall_memory(id)` loads full body. Primitive that persistent-memory wishlist calls for.
- **Per-session audit document** — every run's turns, prompts, approvals, actions, tokens and errors in one atomically-written nested JSON file. Replayable in the panel, and the substrate for resume, with no database to operate.
- **A conversation survives any stop** — a dropped socket, a restart, Stop, or a result. A new message in the same session always continues the conversation; `resume` re-enters a run only while it is genuinely unfinished, and refuses a finished or cancelled one. A document left `running` by a crash is treated as abandoned, not in flight, because the socket-level guard has already proved nothing is live.
- **`defer_model_check=True`** — per-task model from factory; no Agent rebuild.

## Wave 0 blockers — perception

**Re-derived by measurement on 2026-10-01** — `scripts/probe_perception.py`, output
committed to `tests/fixtures/perception-probe.json`. These gate the "works on the
sites behind your login" claim and block Wave 0A. Detail in
`docs/superpowers/specs/2026-09-28-capability-map-design.md`.

| Gap | Verdict | Evidence |
|---|---|---|
| ~~No shadow DOM traversal~~ | **Retracted — never existed** | A control inside an *open* shadow root comes back from a plain top-frame `getFullAXTree` (`auth-shadow`, `OK`). Chrome traverses open roots itself. The 2026-09-28 evidence was a grep for `shadowRoot` returning nothing, which described *our source*, not Chrome |
| No iframe traversal | `GAP_FRAMES` | The target is in a cross-origin frame and only the top frame's tree is read. Payment fields, reCAPTCHA, third-party embeds unreachable |
| No canvas / screenshot fallback | `GAP_UNREACHABLE` | No `canvas` handling, no `Page.captureScreenshot`. The fixture has no a11y mirror, so this is a **product decision** (vision dependency vs. reporting the limitation), not a perception task |
| No `aria-hidden` reconciliation | `GAP_ARIA` | The control is in the DOM and absent from the AX tree by design. The AX tree is consumed as-is, so it is neither seen nor targetable |
| No dynamic-stability wait | `GAP_TIMING` | Target measured at **5000ms** to appear; the tree is read on a `readyState` poll that completes before a SPA renders anything |
| Observation hard-capped | `GAP_RENDER` | `budget_for_window` is window/20, 8K–60K, decaying to 30% by step 15, and cuts on line count. The target is present and past the cut — a ranking problem, not a size one |
| Auth code present but unwired | Confirmed | `session/auth.py` has `validate_token`, but `/ws/ext/{session_id}` never calls it and `AGENT_AUTH_DISABLED` defaults to `"true"`. `GET /v1/sessions` and `GET /v1/sessions/{id}/audit` are unauthenticated and return full run transcripts |

## The ceiling, measured externally

Brotto has no reliability number of its own — the 2-of-7 fixture score is
adversarial by construction, and the only real-site evidence is one failed
19-step Gmail run. So the honest comparison is against the published numbers
for this class of system, which bound what any version of Brotto can do:

| Benchmark | Number | What it means for us |
|---|---|---|
| OSWorld | humans **72.4%**, best agent **12.2%** | The gap is not closing quickly, and it is not a perception problem alone |
| WebArena → production | **78% → 22%** | Benchmarks overstate. Assume our fixture wins are worth less than they read |
| Mind2Web-Live | best **36.4%**, *with human-authored plans* | The realistic end-to-end target, not 100% |
| WebAIM Million (Feb 2026) | AX defects on **95.9%** of home pages, +22.5% complexity/yr | The parsing substrate is degrading under us |

**So: not "bulletproof to all websites", and no engineering effort changes
that.** Two of the three asks, though, are largely solvable, and the research
says so with numbers — see the two sections below. The third (never
hallucinate) has a specific architectural fix worth ~17× and is the highest
expected-value change available.

### Where the research says we are right

**Not using vision is measured, not dogma.** On 358 OSWorld tasks, raw
screenshot 7.0%, linearized AX tree 15.6%, **compressed** AX tree 20.7%
(A11y-Compressor, arXiv:2605.00551). The no-vision line on the moat list
holds, and compression beating linearization is exactly the direction of
`GAP_RENDER`'s fix. On WebArena-Infinity, Gemini-3-Flash reaches 69.3% where
vision-based Kimi-K2.5 gets 45.9% and Qwen-3.5-Plus 49.1% — adding pixels
would be a regression on the pages we already read.

### The largest lever we have not pulled

How the model *refers* to a control decides how often it refers to one that
does not exist (arXiv:2603.14248): naming it 34.0%, expanded-then-resolve
3.0%, **selecting from a presented list 2.0%**. Brotto is in the 34% column —
`find_element` takes free text. Constraining the output to a ref drawn from
offered candidates is a schema change, not a prompt change. Filed as **1A′**
in the capability map; it gates the verb work rather than following it.

### What no amount of work fixes

Canvas and image-only surfaces (`GAP_UNREACHABLE` — pixels, not nodes),
genuinely broken site markup, and irreversible actions taken on a page that
changed underneath the agent. These are reported, not solved.

## Real gaps (in priority order)

| # | Gap | Evidence | Impact |
|---|---|---|---|
| 1 | No auth on `/ws/ext` | `main.py` exposes `WebSocket: /ws/ext/{session_id}` with no token | Anyone reaching the server runs tasks |
| 2 | No multi-user / accounts | Identity = `request.client.host` → sha256[:32] | NAT collisions, shared IPs |
| 3 | No billing / quota | MiniMax-M3 calls API with user key; server has no spend tracking | No revenue, no rate-limit |
| 4 | No telemetry / analytics | Only `logging.basicConfig` to stdout | No observability into fleet |
| 5 | No task history UI | — **shipped.** `GET /v1/sessions/{id}/audit` + the panel transcript view. Session list is per-browser (`chrome.storage.local`), not per-account. | Users can't revisit past runs |
| 6 | No onboarding | README handwaves "configure server URL"; no first-run wizard, no auth | 90% activation drop |
| 7 | No Chrome Web Store dist | "From Chrome Web Store (when published)" stub | Sideloading only |
| 8 | Limited action surface | No `hover`, `drag`, `select_option`, native `fill_form` | Brittle on real apps |
| 9 | No multi-tab parallelism | `activeTabId` is single; "A task is already running" rejected | Hard ceiling on power use |
| 10 | WS URL bug | `startRelay` ignores user-supplied `serverUrl` for WS URL | Remote users silently hit localhost |
| 11 | No real-browser integration | 497 Python tests plus two Node suites (`test-replay.test.js`, `test-key-dispatch.test.js`) that extract the shipped functions by brace matching and eval them — but nothing loads the panel in a browser | Panel layout, reconnect and CSS regressions still only findable by hand |
| 12 | Stale docs | `decisions.md` describes Playwright-only architecture; README refs non-existent `crypto.ts`, `pairing.ts`, `popup.tsx` | Misleading for new contributors |
| 13 | Unused code | `contracts.py` `ObservationV1`/`BrowserAction`, `domain/`, `context/` subpackages unused | Dead code rot |

## When to update this doc

- Feature ships → add to "well-built" or "action vocabulary"
- Feature gets ripped → remove from "well-built"
- Code-grounded fact changes (count, command, behavior) → update in place
- New gap discovered → add to "real gaps" table
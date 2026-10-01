# Phase 1 Specification & Execution Plan: Brotto OSS Core, Product Finishing & Launch

---

## 1. Executive Summary & Scope

Brotto’s architectural premise—executing an AI browser agent inside the user's authenticated Chrome session via CDP over an extension while reading the Accessibility (AX) tree—bypasses bot detection, eliminates re-authentication hurdles, and reduces token overhead compared to vision-based takeover agents.

Phase 1 delivers a stable, secure, and self-hostable **Free/Open-Source (OSS) Tier** alongside the packaging, compliance, and distribution assets required for an unlisted Chrome Web Store (CWS) submission and a subsequent public **Show HN** launch.

```
+--------------------------------------------------------------------------------------------------+
|                                  PHASE 1 EXECUTION TRACKS                                        |
+--------------------------------------------------------------------------------------------------+
| Track 1: Agent Architecture Hardening                                                            |
|   • Conditional Vision Fallback (Canvas/Unreachable)                                             |
|   • Multi-Model Provider Expansion (Gemini + OpenAI-compatible)                                  |
|   • Strict Ref Grounding & Structured Schemas                                                    |
|   • Real-Browser Extension Test Verification                                                     |
+--------------------------------------------------------------------------------------------------+
| Track 2: Product Finishing & Store Packaging                                                     |
|   • Repository & Package Hygiene (`uvx`, BSL 1.1 -> Apache 2.0 in 2029)                             |
|   • Side Panel Polish (Token/Cost Dashboard, Replay State Isolation)                             |
|   • Privacy Transparency (Opt-in Idle Suggestions)                                               |
|   • Unlisted Chrome Web Store Submission                                                         |
+--------------------------------------------------------------------------------------------------+
| Track 3: GTM, Awareness & Launch                                                                 |
|   • 50–100 User Closed Alpha (Unlisted CWS Link)                                                 |
|   • Show HN Launch Assets (45s Authenticated Demo, First-Comment Script)                         |
|   • Developer Community Ripple (r/AI_Agents, r/SideProject)                                     |
+--------------------------------------------------------------------------------------------------+

```

---

## 2. Track 1: Agent Architecture Upgrades

### 1.1 Conditional Vision Fallback for Unreachable Surfaces

* **Context & Objective:** Brotto's core AX-tree perception achieves higher reliability and lower latency than pure vision models. However, `<canvas>`, WebGL surfaces, and image-only elements present structural blind spots (`GAP_UNREACHABLE`) where the AX tree returns zero interactable child nodes. Vision must act strictly as a conditional fallback, never the default.


* **Implementation Design:**
1. *Trigger Predicate:* In `services/brotto-orchestrator/src/brotto_orchestrator/agent/harness.py`, evaluate the observation turn. If an element interaction targets a `<canvas>`, an unmapped coordinate, or an explicit perception error occurs (`unreachable` / target missing box model while present in DOM), set `fallback_vision_required = True`.


2. *CDP Screenshot Relay:* Send an `eval_screenshot` command across the WebSocket `/ws/ext/{session_id}`. Update `clients/brotto-extension/src/background.ts` and `debugger.ts` to implement `chrome.debugger.sendCommand(target, "Page.captureScreenshot", { format: "jpeg", quality: 65 })`.


3. *Visual Grounding Turn:* Pass the captured base64 frame into a vision-capable provider endpoint (e.g., Claude 3.5 Sonnet, GPT-4o, or Gemini 1.5/2.0 Flash) with a prompt requesting exact client coordinate targets $(x, y)$.


4. *Execution & Resumption:* Dispatch synthetic mouse clicks via `Input.dispatchMouseEvent` using the resolved coordinates, then return immediately to standard AX-tree parsing for subsequent turns.




* **Acceptance Criteria:**
* [ ] Pure DOM/AX tasks never invoke `Page.captureScreenshot` (screenshot overhead remains 0ms on standard web pages).


* [ ] Interactive `<canvas>` buttons (e.g., signature pads, chart points) correctly resolve click coordinates and advance the agent state without loop stagnation.


* [ ] Task audit trails (`logs/sessions/<session_id>.json`) explicitly annotate visual fallback steps under `turns[].observation.visual_fallback = true`.





### 1.2 Multi-Model Provider Expansion (Gemini & Generic OpenAI-Compatible)

* **Context & Objective:** Currently, `model/registry.py` only configures Anthropic, OpenAI, and MiniMax. Adding Google Gemini enables an economical, long-context multimodal provider, while an OpenAI-compatible interface unlocks local runtimes (Ollama, vLLM) and cost-effective alternatives (DeepSeek-V3/R1, Groq).


* **Implementation Design:**
1. *Gemini Provider:* Create `GeminiFactory` in `services/brotto-orchestrator/src/brotto_orchestrator/model/registry.py` utilizing `pydantic-ai`’s `GeminiModel`, supporting `gemini-1.5-pro`, `gemini-1.5-flash`, and `gemini-2.0-flash`. Wire parameter defaults with `_OUTPUT_TOKEN_CAP = 32_000`.


2. *OpenAI-Compatible Generic Factory:* Implement `OpenAICompatibleFactory` accepting custom `base_url` overrides (e.g., `http://localhost:11434/v1` for Ollama, `[https://api.deepseek.com/v1](https://api.deepseek.com/v1)`) via extension configuration or `OPENAI_BASE_URL`.


3. *Extension UI Selector:* Update `clients/brotto-extension/src/model_config.ts` and `sidepanel.html` to populate Gemini and OpenAI-compatible options in the model configuration dropdown.




* **Acceptance Criteria:**
* [ ] Setting `provider: "gemini"` with a valid `GEMINI_API_KEY` executes end-to-end tasks with prompt prefill under 3 seconds on typical pages.


* [ ] Pointing the OpenAI-compatible provider to a local Ollama instance successfully resolves models and completes standard multi-step DOM queries offline.


* [ ] Tests in `tests/model/test_registry_settings.py` pass across all registered providers.





### 1.3 Ref Grounding Hardening & Pydantic Action Schema Enforcement

* **Context & Objective:** Although Brotto avoids free-text hallucination by referencing AX nodes directly, models can still emit bare integers instead of composite refs (e.g., emitting `13829` instead of `[0:13829]`), or omit the `actions` key when completing tasks.


* **Implementation Design:**
1. *Composite Ref Normalization:* Enforce the composite ref format `[frameIndex:nodeId]` in `services/brotto-orchestrator/src/brotto_orchestrator/agent/extension_relay.py`. When a model outputs a bare integer `N`, automatically normalize it against the main frame `0:N` before failing.


2. *Pydantic Schema Validation:* In `agent/harness.py`, default `AgentDecision.actions` to an empty list and retain `_require_actions` to raise a `ModelRetry` with explicit guidance whenever a model emits prose without closing actions.


3. *Action-Outcome Derivation:* Standardize error checks using substring membership against `_EXEC_FAILURE` rather than simple `startswith("Error executing")` prefixes to prevent decorated success strings from masking failed DOM interactions.




* **Acceptance Criteria:**
* [ ] A model output containing a bare integer ref (e.g., `ref: "149099"`) successfully maps to `[0:149099]` and clicks without raising a grounding error.


* [ ] An action returning an error inside a formatted outcome string (e.g., `'Clicked [13829]: Error executing...'`) is flagged as `ok: false` in the audit log.


* [ ] Unit tests in `tests/test_grounding_outcome.py` pass with zero failures.





### 1.4 Real-Browser Verification of Perception Subsystems

* **Context & Objective:** Key perception mechanisms—frame enumeration (`surfaces.ts`), dynamic stability waits (`stability.ts`), bulk geometry extraction (`geometry.ts`), and `aria-hidden` recovery (`supplement.ts`)—have passed unit tests but lack verified execution inside a live Chrome extension lifecycle.


* **Implementation Design:**
1. *Extension Test Harness:* Build an automated integration suite under `tests/integration/` using Playwright's `chromium.launchPersistentContext` loaded with `--disable-extensions-except=clients/brotto-extension`.


2. *Cross-Origin Frame Validation:* Execute against a synthetic iframe fixture to verify `getFullAXTree({ frameId })` resolves cross-origin frame controls.


3. *Stability Window Assertions:* Load `auth-slowjs` (elements rendering after a 5,000ms delay) and confirm `pageMayStillBeMoving` enforces the mutation quiet window up to the 10s deadline.


4. *Aria-Hidden Tagging:* Verify hidden actionable elements receive negative node IDs (e.g., `0:-1`) and trigger non-pre-approved approval cards (`(domain, "click:hidden")`).




* **Acceptance Criteria:**
* [ ] Playwright extension test suite runs headlessly in CI and completes in under 120 seconds.


* [ ] `auth-slowjs` successfully waits for delayed DOM controls and completes the target interaction.


* [ ] Interactions targeting `[hidden]` elements reliably pause for user confirmation in secure mode.





---

## 3. Track 2: Product Finishing, Packaging & Chrome Web Store Compliance

### 2.1 Repository & Packaging Hygiene

* **Context & Objective:** The current codebase is not installable via standard package managers due to missing initialization files, contains two conflicting lockfiles, and retains stale third-party references.


* **Implementation Design:**
1. *Package Structure:* Add `__init__.py` to `services/brotto-orchestrator/src/brotto_orchestrator/`. Validate packaging via `pip install -e .` and test binary entry point execution via `uvx --from . brotto --help`.


2. *Dependency Lockfile Consolidation:* Remove redundant `uv.lock` files between the repository root and `services/brotto-orchestrator/`, tracking a single root lockfile.


3. *Licensing Finalization:* Apply the **Business Source License 1.1** to the root `LICENSE`, with a `Change Date` of 2029-10-01 and the Apache 2.0 text preserved at `LICENSES/Apache-2.0.txt` as the conversion target. Clean the root `NOTICE` of third-party copyright artifacts. This follows the accepted decision in `docs/product/decisions/2026-09-28-distribution-oss-cloud.md` (Fork A, Q1) — not plain Apache 2.0, which would leave the hosted cloud tier unprotected.


4. *Documentation Sync:* Remove gitignore exclusions on `/docs/architecture/` and `/docs/product/`. Rewrite `clients/brotto-extension/README.md` to purge non-existent source references (e.g., `crypto.ts`, `pairing.ts`, `popup.tsx`).




* **Acceptance Criteria:**
* [ ] Running `uvx brotto` in a clean environment initializes the orchestrator CLI cleanly.


* [ ] `git status` confirms root dependencies resolve from a single `uv.lock`.


* [ ] `LICENSE` is BSL 1.1 with a 2029-10-01 change date, `LICENSES/Apache-2.0.txt` holds the conversion text, and repo-wide searches return zero references to legacy third-party entities.





### 2.2 Side Panel UI/UX Polish & Session State Isolation

* **Context & Objective:** The extension side panel UI handles live tasks, approvals, and history, but requires visual polish, cost visibility, and strict conversation isolation.



```
+-----------------------------------------------------------------------+
|  [■] Brotto                       ● CONNECTED   [Claude 3.5 Sonnet v] |
+-----------------------------------------------------------------------+
|  STEPS: 4        ACTIVE: 18.4s       CONTEXT: 12.8%     SPEND: ~$0.018|
+-----------------------------------------------------------------------+
|  TASK IN FLIGHT: mail.google.com                                      |
|  -> Summarising unread Primary emails and flagging urgent payments... |
|                                                                       |
|  +-----------------------------------------------------------------+  |
|  | [!] APPROVAL REQUIRED                                           |  |
|  | Action: click [0:1042] ("Archive Thread")                       |  |
|  | Reason: Sensitive Action (First time on mail.google.com)        |  |
|  |                                                                 |  |
|  |           [  Approve Action  ]       [  Deny  ]                 |  |
|  +-----------------------------------------------------------------+  |
+-----------------------------------------------------------------------+
|  [ Type instructions or mid-task steering correction...          ] [>]|
+-----------------------------------------------------------------------+

```

* **Implementation Design:**
1. *Token & Cost Governance Bar:* In `clients/brotto-extension/src/sidepanel.js`, expand the top metrics grid to calculate running task cost based on model token rates (Input / Output / Cache) alongside context utilization percentage.


2. *Session History Replay Isolation:* Ensure clicking a previous conversation from the history drawer opens an explicit read-only transcript view. Prevent historical task replay from overwriting active tab session listeners or triggering unintended ambient page suggestions.


3. *Budget Cap Controls:* Add a user-configurable task budget ceiling (e.g., default `$0.50`) in extension settings. If estimated token spend exceeds this limit, trigger an approval card before executing additional turns.




* **Acceptance Criteria:**
* [ ] Active tasks display real-time cumulative cost estimates with sub-cent accuracy based on active provider pricing.


* [ ] Exceeding the task budget cap pauses execution and displays a budget warning card in the side panel.


* [ ] Inspecting past conversations from history leaves the active tab debugger attachment and input prompt unaffected.





### 2.3 Idle Suggestions Disclosure & Privacy Governance

* **Context & Objective:** The `POST /v1/suggestions` endpoint samples active page text to suggest relevant prompts. Under Chrome Web Store policies, ambient page inspection without explicit user disclosure can cause store listing rejections.


* **Implementation Design:**
1. *Opt-In Architecture:* Default ambient idle suggestions to **Disabled**.


2. *Settings Control & UI Badge:* Add an explicit toggle in the settings view: `"Enable contextual page suggestions"`. When active, render a subtle visual indicator in the side panel (e.g., `[Sampling Page Context]`) whenever page text is read.


3. *Exclusion Rules:* Hardcode privacy exclusions preventing script execution and text extraction on sensitive domains (e.g., banking portals, password managers, and webmail compose windows) unless specifically initiated by a user task prompt.




* **Acceptance Criteria:**
* [ ] Fresh installs perform zero background page reads until the user explicitly enables suggestions in settings.


* [ ] When enabled, sampling active page text triggers a visible badge in the side panel header.





### 2.4 Chrome Web Store Submission Package

* **Context & Objective:** Securing an unlisted CWS listing initiates the 3–4 week review cycle and provides an installable link for closed-alpha users without sideloading friction.


* **Implementation Design:**
1. *Single-Purpose Declaration:* Apply the required single-purpose statement verbatim across `manifest.json`, the store listing, `welcome.html`, and `PRIVACY.md`:


> *"Let you ask an AI to perform tasks in your own logged-in browser."*
> 


2. *Permission Clean-Up:* Remove unused `tabs` permissions from `manifest.json` and delete the Firefox `browser_specific_settings.gecko` block (Firefox lacks CDP `chrome.debugger` support).


3. *Permission Justifications:* Formulate user-facing justifications in `PERMISSIONS.md` (e.g., explaining `chrome.debugger` as on-demand task execution and `scripting` as page context extraction).


4. *Reviewer Test Suite:* Prepare unlisted review assets: a pre-configured remote relay endpoint with test credentials, a sample task, and an explicit note confirming all model outputs are validated into a closed action enum.




* **Acceptance Criteria:**
* [ ] Chrome extension packages into a zip bundle compliant with Manifest V3 validation (`npm run build`).


* [ ] Privacy policy is hosted at a live, public URL.


* [ ] Unlisted submission is uploaded to the Chrome Developer Dashboard.





---

## 4. Track 3: GTM, Awareness & Launch Preparation

### 3.1 Closed Alpha & Dogfooding (Weeks 1–2)

* **Objective:** Distribute the unlisted Chrome extension to an initial cohort of 50–100 power users (recruiters, research analysts, SaaS operations engineers) to uncover edge-case failures across authenticated workflows.


* **Target Scenarios:**
1. *Authenticated Webmail:* Summarizing unread transactional emails and drafting responses in Gmail/Outlook.


2. *Recruitment / Sourcing:* Navigating LinkedIn search results and compiling profile data into internal spreadsheets.


3. *Internal Admin Workflows:* Operating multi-step form fills, table exports, and data entry inside Jira, GitHub, or billing portals.




* **Feedback & Reliability Instrumentation:** Direct users to report failures via GitHub Issues with anonymized session logs generated via `GET /v1/sessions/{id}/audit`.



### 3.2 Show HN Launch Package (Week 3)

* **Objective:** Launch on Hacker News to capture technical early adopters and open-source contributors.


* **Launch Parameters & Asset Checklist:**
* **Timing:** Tuesday or Wednesday at 8:00 AM ET.


* **Headline Formula:**
> `Show HN: Brotto – AI browser agent that runs in your logged-in Chrome (BYOK, AX-tree)`
> 


* **Above-the-Fold Demo Asset:** A concise 45-second demo GIF showing an authenticated workflow (e.g., extracting transaction alerts from a live portal and updating a tracker) with human-in-the-loop approval cards visible.


* **First Comment Narrative:**
* The architectural contrast: why remote headless Chromium agents fail on bot detection and login walls.


* Why the AX tree is preferred over raw screenshots: lower latency, reduced token spend, and accessibility-first perception.


* Security posture: session-only key storage in `chrome.storage.session`, no server disk writes, and deterministic approval cards for destructive actions.


* Transparent discussion of known limitations (canvas limitations, single-tab constraint, ongoing benchmark work).







### 3.3 Community Seeding & Post-Launch Distribution (Weeks 4–6)

* **Objective:** Sustain repository momentum and transition active users into ongoing contributors and future cloud waitlist subscribers.


* **Execution Channels:**
* *Subreddit Engagement:* Publish technical architecture write-ups on `r/AI_Agents` and `r/SideProject` focusing on solving browser agent bot detection and token billing surprises.


* *Developer Newsletter Inbound:* Distribute release summaries to technical AI newsletters (e.g., Ben's Bites, The Sequence, Latent Space) focusing on the CDP-over-extension design pattern.


* *Product Hunt Follow-Up:* Schedule a Product Hunt launch 5–7 days following the Show HN release once initial user testimonials and GitHub stars are established.





---

## 5. Traceability & Acceptance Matrix

| Item ID | Sub-System / Feature | Primary Deliverable | Acceptance Verification Gate |
| --- | --- | --- | --- |
| **ARCH-01** | Vision Fallback | Conditional `Page.captureScreenshot` CDP invocation

 | Triggers *only* when canvas/unmapped surfaces are targeted; pure AX turns execute without screenshots.

 |
| **ARCH-02** | Provider Registry | Gemini Flash/Pro & OpenAI-Compatible factories

 | Unit tests pass in `test_registry_settings.py`; local Ollama endpoints execute browser tasks.

 |
| **ARCH-03** | Ref Grounding | Composite ref normalization & strict Pydantic schemas

 | Bare integer refs resolve cleanly; failed execution outcomes never record as `ok: true`.

 |
| **ARCH-04** | Extension Testing | Headless Playwright integration test suite

 | Tests run in CI; `auth-slowjs` stability and cross-origin iframe scans pass.

 |
| **PKG-01** | Packaging | `brotto-orchestrator` `__init__.py` & lockfile cleanup

 | `pip install -e .` and `uvx brotto` run cleanly from a fresh shell.

 |
| **PKG-02** | Legal & Licensing | BSL 1.1 with 2029-10-01 Apache conversion, no third-party references

 | Root `LICENSE` is BSL 1.1 with the Apache 2.0 conversion target committed; repo contains zero external company artifacts.

 |
| **UI-01** | Panel Cost Tracker | Live token spend and task budget caps

 | Running spend renders dynamically; exceeding user budget triggers execution pause.

 |
| **UI-02** | Privacy Opt-In | Contextual suggestions gated behind settings toggle

 | Ambient page text is never read on idle unless explicitly enabled by the user.

 |
| **CWS-01** | Store Listing | Unlisted Chrome Web Store package submission

 | Single-purpose statement matches across manifest, UI, and privacy policy.

 |
| **GTM-01** | Alpha Dogfooding | 50–100 active user feedback cohort

 | Authenticated sessions (Gmail, LinkedIn, internal tools) achieve >80% completion.

 |
| **GTM-02** | Show HN Package | 45s demo asset, first-comment copy, and repo README

 | Public repository launches with complete quickstart, clear limitations, and active issue templates.

 |

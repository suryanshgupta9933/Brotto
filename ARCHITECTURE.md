# Brotto Browser Automation Platform

## Architecture and Implementation Plan

## 1. Executive recommendation

Build the platform around a **server-hosted agent harness** and two thin client connection options:

1. **Desktop Connector**

   * Distributed as signed ZIP packages for Windows, macOS, and Linux.
   * Launches a dedicated Chromium browser profile.
   * Exposes CDP only on the local loopback interface.
   * Creates an outbound encrypted tunnel to the server.

2. **Browser Extension**

   * Connects selected Chrome or Edge tabs to the server.
   * Uses the browser's `chrome.debugger` interface.
   * Reuses the user's existing authenticated browser sessions.
   * Requires explicit tab selection and displays an active automation indicator.

The server should run:

* Brotto inference.
* The complete agent loop and memory.
* Playwright MCP.
* CDP relay and session routing.
* Policy and approval controls.
* Audit logging and observability.
* File-transfer and credential-broker services.
* A control interface where users can watch, pause, approve, and terminate agents.

The preferred model configuration is:

* **Brotto-9B:** default production model.
* **Brotto-4B:** economical or self-hosted profile.
* **Brotto-27B:** optional quality-focused deployment.

Brotto is a screenshot-based computer-use model. It sees screenshots rather than the DOM or accessibility tree and produces coordinate-grounded actions such as clicks, typing, scrolling, and URL navigation. Therefore, Playwright MCP should be treated as the **browser execution layer**, not as the interface directly exposed to the model.

---

# 2. Recommended architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                        Control Plane                        │
│  Web UI · Task API · Authentication · Policies · Approvals │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                     Agent Orchestrator                      │
│                                                             │
│  Session State Machine                                      │
│  Brotto Prompt and History Manager                            │
│  Action Parser and Validator                                │
│  Policy and Critical-Action Engine                          │
│  Retry, Budget and Failure Management                       │
└───────────────┬───────────────────────────┬─────────────────┘
                │                           │
┌───────────────▼─────────────┐  ┌─────────▼─────────────────┐
│     Brotto Inference API      │  │   Browser MCP Gateway     │
│  vLLM · 4B/9B/27B models   │  │ Playwright MCP per session│
└─────────────────────────────┘  └─────────┬─────────────────┘
                                          │ Internal CDP
                                ┌─────────▼─────────────────┐
                                │       CDP Relay Broker    │
                                │ Auth · Routing · Backpress│
                                │ Heartbeats · Revocation   │
                                └─────────┬─────────────────┘
                                          │ Outbound WSS
                      ┌───────────────────┴───────────────────┐
                      │                                       │
          ┌───────────▼────────────┐              ┌──────────▼──────────┐
          │ Desktop ZIP Connector  │              │ Browser Extension   │
          │ Dedicated browser      │              │ Selected user tabs  │
          │ Loopback CDP bridge    │              │ chrome.debugger     │
          └────────────────────────┘              └─────────────────────┘
```

## Architectural rule

**Never expose a client browser's raw CDP port to the public internet.**

The browser should listen only on loopback, and the client should establish an outbound authenticated WebSocket connection to the relay. Anyone who gains access to a browser debugging endpoint can effectively control the browser and potentially access authenticated sessions.

Playwright MCP already supports CDP endpoints, CDP headers, browser extensions, and opt-in vision tools. Its coordinate tools include mouse clicks, movement, dragging, and wheel scrolling.

---

# 3. Main server components

## 3.1 Control plane

Responsibilities:

* User and organization authentication.
* Device registration.
* Task creation.
* Session monitoring.
* Approval prompts.
* Domain and action policies.
* Audit-log access.
* Session termination.
* Connector and extension downloads.

Recommended stack:

* TypeScript or Go API.
* PostgreSQL for control-plane state.
* Redis for session leases and queues.
* OIDC authentication.
* WebSocket or Server-Sent Events for live session updates.

The control plane must not directly send arbitrary CDP commands. All commands should pass through the agent orchestrator, policy engine, and MCP gateway.

## 3.2 Agent orchestrator

The orchestrator owns the complete agent harness.

Each browser session should have a state machine such as:

```text
CREATED
→ WAITING_FOR_CLIENT
→ CONNECTED
→ OBSERVING
→ PLANNING
→ POLICY_CHECK
→ WAITING_FOR_APPROVAL
→ EXECUTING
→ VERIFYING
→ COMPLETED / FAILED / CANCELLED
```

Responsibilities:

* Maintain the task goal.
* Maintain bounded action and screenshot history.
* Request inference from Brotto.
* Parse Brotto tool calls.
* Validate all model arguments.
* Request policy approval.
* Execute approved actions through MCP.
* Capture the next browser state.
* Detect completion and failure.
* Apply time, step, token, and cost budgets.

Do not let the model directly control:

* Authentication tokens.
* CDP session identifiers.
* Internal service URLs.
* Arbitrary JavaScript execution.
* Local file paths.
* System commands.
* Policy settings.

## 3.3 Brotto inference service

Use an OpenAI-compatible inference endpoint behind the orchestrator. The official 4B model card supports serving through vLLM and identifies the model as MIT-licensed.

Recommended deployment profiles:

### Standard profile

* Brotto-9B.
* GPU-backed vLLM deployment.
* Continuous batching.
* Separate inference autoscaling from orchestration autoscaling.

### Economy profile

* Brotto-4B.
* Lower GPU memory requirement.
* Suitable for development, private installations, and less complex flows.

### Quality profile

* Brotto-27B.
* Used selectively for difficult or long-tail tasks.
* Optional routing after repeated 9B failures.

Do not dynamically switch models during a task unless the action history and screenshots are carried across using a stable, versioned prompt format.

## 3.4 Browser MCP gateway

Run Playwright MCP as an internal server-side dependency.

Recommended configuration:

```text
Playwright MCP
  capabilities: vision
  connection: internal CDP relay endpoint
  browser: Chromium
  profile: one MCP process or isolated worker per browser session
```

The MCP server should be accessed through local IPC, STDIO, or a private internal interface. It should not be exposed directly to end users or the public network.

Playwright MCP explicitly states that it is not itself a security boundary. Its allowed-origin and blocked-origin options are useful controls, but they do not protect redirects and must not replace network-level enforcement.

## 3.5 Brotto action adapter

This is a critical component because Brotto's native action format and Playwright MCP's tools do not align perfectly.

Suggested mappings:

| Brotto action               | Execution tool                               |
| ------------------------- | -------------------------------------------- |
| `left_click`              | `browser_mouse_click_xy`                     |
| `double_click`            | `browser_mouse_click_xy` with `clickCount=2` |
| `right_click`             | `browser_mouse_click_xy` with right button   |
| `drag`                    | `browser_mouse_drag_xy`                       |
| `mouse_move`              | `browser_mouse_move_xy`                       |
| `scroll`                  | `browser_mouse_wheel`                         |
| `key`                     | `browser_press_key`                           |
| `visit_url`               | `browser_navigate`                            |
| `history_back`            | `browser_navigate_back`                       |
| `screenshot`              | `browser_take_screenshot`                     |
| `wait`                    | bounded orchestrator timer                    |
| `ask_user_question`        | control-plane approval request                |
| `terminate`               | orchestrator session completion               |
| `pause_and_memorize_fact` | server-side session memory                    |

### Typing nuance

Brotto expects to type into the currently focused field. Standard Playwright MCP typing normally expects an identified element.

Add a small, audited MCP tool such as:

```text
browser_keyboard_insert_text(text)
```

Internally, this should call Playwright's focused keyboard insertion functionality. This is safer and more reliable than using arbitrary Playwright code.

Do not expose `browser_run_code_unsafe`. Playwright describes this tool as arbitrary JavaScript execution in the server process and therefore equivalent to remote code execution.

## 3.6 Observation and verification layer

Brotto should receive:

* The current screenshot.
* The user's original goal.
* The relevant recent actions.
* Relevant approved user answers.
* The result of the previous action.
* A concise failure message when an action failed.

Keep only a limited number of screenshots in the active prompt and store the full trajectory separately.

Playwright's accessibility snapshot can be used as an **out-of-band verifier**, even though it should not replace screenshots in Brotto's perception loop. For example:

* Confirm that a button click opened the expected dialog.
* Confirm that text appeared.
* Check whether a form field contains the expected value.
* Detect that the browser navigated to an unexpected domain.
* Validate success before declaring a task complete.

This hybrid design preserves Brotto's trained visual behavior while using deterministic browser information for safety and reliability.

---

# 4. Client option A: desktop ZIP connector

## 4.1 Recommended design

Create a small native connector in **Rust or Go** rather than bundling an entire Node.js agent environment.

The server still contains:

* Brotto.
* Agent logic.
* Playwright MCP.
* Policies.
* Audit storage.

The client connector contains only:

* Browser launcher.
* Local CDP discovery.
* Secure relay client.
* Device authentication.
* Health checks.
* Session indicator.
* Local stop button.
* Update/version information.

## 4.2 Distribution formats

Publish separate signed artifacts:

```text
connector-windows-x64.zip
connector-windows-arm64.zip
connector-macos-x64.zip
connector-macos-arm64.zip
connector-linux-x64.zip
connector-linux-arm64.zip
```

Provide two desktop package variants:

### Lightweight connector

* Connector executable.
* Launch scripts.
* Configuration template.
* Uses installed Chrome or Edge.
* Smaller download.
* More browser-version variation.

### Deterministic connector

* Connector executable.
* Chrome for Testing.
* Known compatible browser version.
* Preconfigured dedicated profile directory.
* Larger download.
* Better reproducibility.

Chrome changed remote debugging behavior starting with Chrome 136: debugging switches are no longer honored against the normal default Chrome data directory and require a separate `--user-data-dir`. Google specifically recommends Chrome for Testing for automation scenarios.

## 4.3 Browser startup

The connector should launch Chromium approximately as follows:

```text
browser executable
--user-data-dir=<dedicated automation profile>
--remote-debugging-port=<random available local port>
--remote-debugging-address=127.0.0.1
--window-size=<controlled dimensions>
```

The connector should then:

1. Verify the CDP endpoint is bound only to loopback.
2. Read the browser's WebSocket debugger URL.
3. Establish an outbound WSS connection to the server.
4. Authenticate the device and session.
5. Tunnel permitted CDP frames.
6. Close the browser or detach when the session ends.

## 4.4 Profile modes

Support three explicit modes:

### Ephemeral

* New profile for each task.
* Deleted after completion.
* Safest default.
* No saved authentication.

### Persistent automation profile

* Dedicated browser profile retained across tasks.
* Keeps approved login state.
* Never uses the user's everyday Chrome profile.
* Encrypt profile data at rest where practical.

### Imported session state

* The user explicitly imports cookies or Playwright storage state.
* Import is scoped to selected domains.
* Secrets are encrypted and expire.
* Never log cookie values.

## 4.5 File downloads and uploads

Because Playwright runs on the server while the actual browser runs on the client, local and server file systems are different.

Create a dedicated artifact channel:

### Downloads

1. Browser downloads into a connector-controlled temporary directory.
2. Connector records filename, MIME type, size, and checksum.
3. User or policy approves transfer.
4. File is encrypted and uploaded to the server artifact service.
5. Temporary files are deleted according to retention policy.

### Uploads

1. User selects or approves a server-side artifact.
2. Server sends it through the encrypted artifact channel.
3. Connector places it into a session-specific temporary directory.
4. Browser uploads it.
5. Connector deletes the local temporary copy.

The CDP tunnel itself should not become an unrestricted filesystem bridge.

---

# 5. Client option B: browser extension

## 5.1 Recommended design

Use a Manifest V3 extension based on the official Playwright extension's connection pattern.

The official extension:

* Uses `chrome.debugger`.
* Supports active-tab and tab-group access.
* Uses a service worker.
* Requests broad host access.
* Receives an MCP relay URL to establish a browser connection.

The extension should not contain the agent or model. It remains a thin browser transport.

## 5.2 User flow

1. User installs the extension.
2. User signs into the control plane.
3. A one-time pairing code is displayed.
4. The extension exchanges the code for a device identity.
5. User starts a browser task.
6. Extension displays a tab-selection dialog.
7. User selects one tab or an automation tab group.
8. Extension attaches `chrome.debugger`.
9. Extension establishes an outbound WSS relay.
10. A persistent badge shows that automation is active.
11. User can disconnect from the toolbar at any time.

## 5.3 Extension scope

Default behavior should be:

* Manual tab selection.
* One tab group per automation session.
* No silent browser-wide attachment.
* No automatic reconnection after explicit user cancellation.
* Immediate debugger detachment when the socket closes.
* Token revocation when the task ends.
* Visible session owner and server domain.
* Clear warning before attaching authenticated tabs.

The official Playwright extension requests `debugger`, `activeTab`, `tabs`, `tabGroups`, and `<all_urls>` access. These are powerful permissions, so the open-source project should document exactly why each permission is needed.

## 5.4 Extension authentication

Browser extensions cannot practically use the same certificate model as a native desktop connector. Use:

* A device key generated using WebCrypto.
* Non-exportable private-key storage where supported.
* Signed server challenges.
* Short-lived session tokens.
* Audience-bound and tenant-bound tokens.
* Single-use pairing codes.
* Token rotation.
* Server-side revocation.

Never place a permanent API token in extension source, local storage, query parameters, or a publicly visible pairing URL.

## 5.5 Extension limitations

The extension path should be considered a higher-risk interactive mode because it can access the user's existing logged-in browser state.

Additionally:

* `chrome.debugger` exposes only supported CDP domains.
* Browser service workers can be suspended.
* Extension behavior can vary between Chrome and Edge versions.
* Window size and viewport cannot always be controlled consistently.
* Browser updates can change debugger behavior.
* Chrome Web Store review may scrutinize `<all_urls>` and debugger permissions.

Maintain a tested browser compatibility matrix and restrict unsupported CDP methods at the relay.

---

# 6. CDP relay protocol

The public connection should be a custom, narrow relay protocol rather than a generic open CDP server.

Every message should include:

```text
protocolVersion
tenantId
sessionId
deviceId
channelId
sequenceNumber
messageType
expiry
payload
signature or authenticated transport context
```

Required protocol properties:

* TLS-only.
* Mutual TLS for native connectors where possible.
* Short-lived session leases.
* Tenant-bound sessions.
* Cryptographically random identifiers.
* Replay protection.
* Ordered sequence numbers.
* Per-session bandwidth limits.
* Message-size limits.
* Heartbeats.
* Backpressure.
* Immediate revocation.
* Protocol version negotiation.
* No cross-session channel reuse.

MCP security guidance recommends securely generated state handles, binding handles to authenticated users, expiring them, and never treating possession of a state identifier as authentication.

---

# 7. Coordinate and screenshot handling

Brotto makes coordinate-based decisions, so screenshot consistency is fundamental.

## Required controls

* Device scale factor calibration.
* Browser zoom at 100% where possible.
* Stable screenshot format.
* Known viewport dimensions.
* Coordinate transformation tests.
* Detection of browser toolbar and viewport offsets.
* Recalibration after resize or display changes.

## Recommended strategy

Normalize every screenshot into a fixed model canvas:

```text
Model canvas: fixed width × height
Browser viewport: variable width × height
Transform: scale + optional letterbox
```

Store the transformation used for each screenshot. Before executing a model-generated coordinate, translate it back into browser viewport coordinates.

Reject the action when:

* Screenshot dimensions do not match the recorded transform.
* Device pixel ratio changed.
* Browser zoom changed.
* The selected tab changed.
* The page navigated between observation and action.
* The target coordinate lies outside the page viewport.

A monotonically increasing observation ID should accompany every screenshot. An action must reference the observation from which it was generated.

---

# 8. Security architecture

## 8.1 Threat: browser takeover through CDP

CDP provides extensive control over the browser.

Controls:

* Never bind remote debugging to `0.0.0.0`.
* Use random loopback ports.
* Require outbound client connections.
* Do not expose CDP URLs in logs or client-facing APIs.
* Use one relay channel per browser session.
* Immediately revoke the channel when the user stops the task.
* Use a dedicated profile by default.
* Detach the extension debugger on every disconnect path.

Playwright itself warns that CDP connections are Chromium-only and have lower fidelity than native Playwright protocol connections. This should be treated as a documented platform constraint rather than hidden from users.

## 8.2 Threat: prompt injection from websites

Everything rendered by a website is untrusted input.

A page may tell the agent to:

* Ignore its original goal.
* Reveal credentials.
* Upload a local file.
* Navigate to another site.
* Send sensitive information.
* Disable security settings.
* Execute a supposedly necessary command.

Controls:

* The model cannot change policy.
* The model cannot add domains to an allowlist.
* Instructions originating from pages are labelled untrusted.
* Secret values are never present in the model prompt where avoidable.
* External navigation is checked independently.
* File access requires explicit manifests and approvals.
* Page requests to reveal tokens, cookies, or system instructions are always denied.
* Irreversible actions require deterministic approval outside the model.

## 8.3 Critical-action approval

Require user approval before:

* Signing in.
* Entering personal information.
* Entering passwords or one-time codes.
* Sending an email or message.
* Publishing content.
* Submitting a form with external impact.
* Making a purchase.
* Accepting terms.
* Changing account permissions.
* Deleting data.
* Uploading a file.
* Downloading sensitive information.
* Inviting users.
* Creating API keys.
* Changing payment details.
* Completing a CAPTCHA.

Brotto itself is trained around critical-point pauses for personal information, submissions, sign-ins, payments, messages, and irreversible actions, but this model behavior should be reinforced through deterministic server policies.

The approval screen should show:

* Proposed action.
* Target website.
* Relevant field names.
* Data that will be submitted.
* Expected consequence.
* Screenshot preview.
* Approve once, deny, or stop session options.

## 8.4 Credential handling

Use a client-side credential broker where possible.

The model should request:

```text
Fill credential: "Acme account"
```

It should not receive:

```text
username@example.com
actual-password
```

The connector or extension inserts the credential after user approval.

Controls:

* Store native-client secrets in the OS keychain.
* Store server secrets in a KMS or secrets manager.
* Redact password fields from screenshots where feasible.
* Redact cookies, tokens, and authorization headers.
* Never retain one-time codes.
* Never include secrets in model traces.

## 8.5 Network restrictions

Implement restrictions at the relay or managed egress layer, not only through Playwright MCP options.

Controls:

* HTTPS by default.
* Domain allowlists.
* Validate every redirect.
* Block private, loopback, link-local, and cloud metadata addresses unless explicitly authorized.
* Resolve and validate DNS immediately before connection.
* Prevent DNS rebinding.
* Reject `file:`, `javascript:`, `data:`, and other dangerous URL schemes.
* Apply per-session request and bandwidth limits.

Official MCP security guidance specifically recommends HTTPS, private-IP blocking, redirect validation, and protection against DNS and SSRF attacks.

## 8.6 Tool minimization

Default MCP tool profile:

### Enabled

* Screenshot.
* Navigate.
* Back.
* Coordinate click.
* Coordinate drag.
* Mouse move.
* Scroll.
* Key press.
* Focused text insertion.
* Read-only accessibility snapshot for verification.
* Page title and URL.
* Tab listing and selection.

### Disabled unless explicitly enabled

* Cookie access.
* Storage access.
* Clipboard access.
* Network-body inspection.
* Browser console execution.
* Arbitrary JavaScript.
* PDF generation.
* Tracing containing sensitive data.
* Host filesystem access.
* Permission grants such as camera, microphone, or geolocation.

### Permanently unavailable to the model

* `browser_run_code_unsafe`.
* Shell execution.
* Connector update commands.
* Policy administration.
* Device registration.
* Raw CDP commands.

## 8.7 Session isolation

Use:

* One tenant per security boundary.
* One agent session per browser connection.
* Separate MCP process or strongly isolated worker per session.
* Unique browser profile directories.
* Separate screenshot and artifact encryption keys.
* No shared cookies between unrelated tasks.
* Cleanup after crashes and timeouts.
* Automatic debugger detachment.
* Explicit session expiration.

## 8.8 Resource budgets

Set configurable defaults such as:

* Maximum agent steps.
* Maximum session duration.
* Maximum consecutive failed actions.
* Maximum repeated navigation loops.
* Maximum screenshot size.
* Maximum upload and download size.
* Maximum model tokens.
* Maximum external domains.
* Maximum tab count.
* Maximum retry count.

Stop the agent when it repeatedly attempts the same action without changing browser state.

## 8.9 Auditability and privacy

Record:

* Session creator.
* Device identity.
* Selected browser or tabs.
* Current domain.
* Model version.
* Prompt template version.
* Screenshot hash.
* Proposed action.
* Policy result.
* Approval decision.
* Executed action.
* Result and error.
* Session termination reason.

Keep normal application logs separate from sensitive agent traces.

Recommended privacy defaults:

* Screenshot retention disabled or short-lived.
* Configurable organization retention.
* Encryption at rest.
* Automatic redaction.
* User-accessible deletion.
* No training on user sessions by default.
* Explicit consent before recording full screenshots.
* Exportable audit trails.

---

# 9. Reliability nuances

The implementation should explicitly handle:

* New tabs and popup windows.
* Cross-origin redirects.
* Browser dialogs.
* File pickers.
* Downloads.
* Authentication redirects.
* SSO.
* Two-factor authentication.
* Session expiration.
* Stale screenshots.
* Page animations.
* Lazy-loaded content.
* Infinite scrolling.
* Sticky headers obscuring coordinates.
* Browser zoom changes.
* Nested iframes.
* Shadow DOM.
* Service workers.
* Network disconnects.
* Browser crashes.
* Extension suspension.
* Client laptop sleep.
* Relay reconnects.
* Multiple monitors and display scaling.
* CAPTCHA pauses.
* Sites that prohibit automation.

Do not add stealth, fingerprint evasion, CAPTCHA bypassing, or anti-bot circumvention. Respect target-site terms and rate limits.

---

# 10. Open-source repository structure

```text
/apps
  /control-plane-web
  /admin-console

/services
  /api-gateway
  /agent-orchestrator
  /brotto-inference
  /browser-mcp-gateway
  /cdp-relay
  /artifact-service
  /audit-service

/clients
  /desktop-connector
  ...
/packages
  /relay-protocol
  /brotto-action-schema
  /policy-engine
  /coordinate-transform
  /sdk-typescript
  /sdk-python
  /shared-telemetry

/deploy
  /docker-compose
  /helm
  /terraform-examples

/evals
  /browser-tasks
  /prompt-injection
  /security
  /reliability
  /performance

/docs
  /architecture
  /security
  /threat-model
  /protocol
  /deployment
  /extension-review
  /client-packaging
  /adrs
```

## Licensing recommendation

Use **Apache-2.0** for the project source code.

Reasons:

* Playwright MCP is Apache-2.0.
* Apache-2.0 contains an explicit patent grant.
* It is appropriate for commercial and open-source adoption.
* Brotto model weights are MIT-licensed and can remain an external dependency rather than being included directly in the repository.

Include:

* `LICENSE`
* `NOTICE`
* `THIRD_PARTY_NOTICES`
* `SECURITY.md`
* `CONTRIBUTING.md`
* `CODE_OF_CONDUCT.md`
* `GOVERNANCE.md`
* `SUPPORT.md`
* `MODEL_USAGE.md`
* `PRIVACY.md`
* `THREAT_MODEL.md`

Do not bundle model weights in ordinary Git releases. Provide versioned model manifests with:

* Model repository.
* Revision or commit.
* Expected checksum.
* License.
* Supported inference runtime.
* Tested prompt version.

---

# 11. Release packaging

## Server releases

Publish:

* Versioned OCI container images.
* Docker Compose development stack.
* Helm chart.
* Example Kubernetes network policies.
* Database migrations.
* OpenTelemetry dashboards.
* GPU deployment examples.

Suggested images:

```text
project/control-plane
project/orchestrator
project/brotto-inference
project/playwright-mcp-gateway
project/cdp-relay
project/artifact-service
```

## Desktop releases

Publish:

* Platform-specific ZIP files.
* Checksums.
* Signed release manifest.
* SBOM.
* macOS notarization.
* Windows Authenticode signature.
* Linux package signatures where applicable.

## Extension releases

Publish:

* Reproducible source build.
* Unpacked development build.
* Chrome Web Store package.
* Enterprise-policy installation documentation.
* Permission justification document.
* Extension privacy disclosure.
* Signed release tag.

## Supply-chain controls

* Pin dependency versions.
* Commit lockfiles.
* Generate CycloneDX or SPDX SBOMs.
* Sign containers and release files using Sigstore or equivalent.
* Generate build provenance.
* Run license scans.
* Block unreviewed dependency installation scripts.
* Scan containers and ZIP packages.
* Use protected release workflows.
* Require two-person approval for releases.
* Fuzz the relay parser and Brotto action parser.

---

# 12. Implementation phases

## Phase 0 — Architecture validation

Deliverables:

* Architecture decision records.
* Threat model.
* Brotto 4B versus 9B evaluation.
* Playwright MCP vision test.
* CDP connection test.
* Extension relay proof of concept.
* Canonical browser-task test suite.

Acceptance criteria:

* Model output can be parsed reliably.
* All required Brotto actions have an execution mapping.
* Screenshots and coordinates remain aligned.
* Server-side MCP controls a remote client browser.
* Disconnecting the relay immediately stops browser control.
* No CDP port is reachable from another network host.

## Phase 1 — Relay protocol and desktop connector

Deliverables:

* Versioned relay protocol.
* Native connector.
* Device pairing.
* Dedicated browser profile launch.
* Heartbeats and reconnection.
* Kill switch.
* Signed ZIP build pipeline.

Acceptance criteria:

* Browser is reachable only through an authenticated relay.
* Session IDs cannot be reused across users.
* Replayed messages are rejected.
* Connector safely recovers from temporary network loss.
* Debugging shuts down after session revocation.

## Phase 2 — Core Brotto agent loop

Deliverables:

* vLLM inference service.
* Brotto prompt manager.
* Tool-call parser.
* MCP action adapter.
* Screenshot normalization.
* Action-result history.
* Step and time budgets.
* Task completion detection.

Acceptance criteria:

* End-to-end tasks execute without direct model access to CDP.
* Invalid model actions are rejected.
* Stale-screenshot actions are rejected.
* No arbitrary code tool is exposed.
* Task traces are reproducible enough for debugging.

## Phase 3 — Policy and human approval

Deliverables:

* Policy engine.
* Critical-action classifier.
* Approval interface.
* Pause, resume, and cancel.
* Domain allowlists.
* Audit events.

Acceptance criteria:

* Irreversible actions cannot run without approval.
* The user sees the exact proposed consequence.
* Cancellation takes effect immediately.
* The model cannot modify its own policies.
* Redirects are evaluated against network policy.

## Phase 4 — Browser extension

Deliverables:

* Manifest V3 extension.
* Pairing and device keys.
* Tab selector.
* Tab-group attachment.
* Active badge.
* WSS relay.
* Disconnect and cleanup logic.
* Chrome and Edge compatibility suite.

Acceptance criteria:

* Only approved tabs are attached.
* Debugger detaches after socket closure.
* Revoked tokens cannot reconnect.
* Automation cannot silently spread to unrelated tabs.
* Extension contains no remote executable code.

## Phase 5 — Files, credentials, and authenticated workflows

Deliverables:

* Artifact-transfer channel.
* Temporary file isolation.
* Download approval.
* Upload approval.
* Credential broker.
* Secret redaction.
* Optional storage-state import.

Acceptance criteria:

* Model never receives raw credentials by default.
* Files cannot escape the approved temporary directory.
* Upload and download contents are auditable.
* Temporary artifacts are deleted.
* Cross-tenant artifact references are rejected.

## Phase 6 — Hardening and adversarial testing

Deliverables:

* Prompt-injection test suite.
* SSRF and DNS-rebinding tests.
* Authentication replay tests.
* Protocol fuzzing.
* Tab-escape tests.
* Crash and disconnect tests.
* Load tests.
* SBOM and signed builds.

Acceptance criteria:

* Page content cannot lower policy.
* Private-network navigation is blocked by default.
* Raw CDP is never externally reachable.
* Repeated failures trigger circuit breakers.
* All release artifacts are signed and traceable to CI.

## Phase 7 — Open-source beta

Deliverables:

* Public repository.
* Docker Compose demo.
* Helm deployment.
* Desktop ZIPs.
* Extension package.
* SDK documentation.
* Security and governance documents.
* Example integrations.
* Compatibility matrix.

Acceptance criteria:

* A new contributor can run the local stack using documented steps.
* A user can connect through either client mode.
* License and dependency scans pass.
* Security disclosures have a documented process.
* Protocol compatibility is versioned.

## Phase 8 — Production readiness

Deliverables:

* Multi-tenant isolation review.
* GPU autoscaling.
* Session queueing.
* Metrics and alerting.
* Trace sampling.
* Backup and recovery.
* Release channels.
* External security assessment.

Acceptance criteria:

* Tenant-bound authorization is verified throughout the system.
* Session termination is reliable under failure.
* Audit records are complete.
* Capacity limits fail safely.
* Production rollout supports staged releases and rollback.

---

# 13. Testing strategy

## Unit tests

* Brotto action parsing.
* Action validation.
* Coordinate transforms.
* Policy evaluation.
* Session transitions.
* Token expiry.
* Redaction.
* Protocol serialization.

## Contract tests

* Connector-to-relay protocol.
* Extension-to-relay protocol.
* Relay-to-CDP mapping.
* Brotto action-to-MCP mapping.
* MCP version compatibility.
* Model prompt version compatibility.

## Browser integration matrix

Test:

* Chrome stable and beta.
* Edge stable.
* Windows x64.
* macOS Intel and Apple Silicon.
* Linux x64.
* Different display scale factors.
* Multiple tabs and windows.
* SSO and two-factor flows.
* Downloads and uploads.
* Browser restarts.
* Client sleep and resume.

## Security tests

* Prompt injection.
* Cross-tenant session access.
* CDP endpoint discovery.
* Token replay.
* DNS rebinding.
* Redirect to private IP.
* Malicious file upload.
* Oversized screenshots.
* Malformed CDP frames.
* Extension tab escape.
* Service-worker restart.
* Credential leakage.
* Audit-log tampering.

## Agent evaluation

Maintain an internal suite containing:

* Search and information retrieval.
* Multi-step forms.
* CRM workflows.
* Scheduling.
* File download and upload.
* Authenticated dashboard navigation.
* Dynamic single-page applications.
* Popups and nested frames.
* Tasks requiring approval.
* Tasks that must be refused or paused.

Track:

* Task success.
* Action accuracy.
* Average steps.
* Repeated-action rate.
* Human-intervention rate.
* Unsafe-action prevention.
* Screenshot-to-action latency.
* End-to-end latency.
* Model cost.
* Bandwidth per session.
* Failure category.

---

# 14. Final technology recommendation

## Server

* TypeScript for orchestration and MCP integration.
* Go or Rust for the high-throughput CDP relay.
* Python and vLLM for model inference.
* PostgreSQL.
* Redis.
* Object storage for encrypted artifacts.
* OpenTelemetry.
* Kubernetes for scalable deployments.
* Docker Compose for local and community use.

## Desktop connector

* Rust preferred.
* Go is also suitable.
* Single executable where possible.
* Minimal local dependencies.
* OS keychain integration.
* Signed platform releases.

## Extension

* TypeScript.
* Manifest V3.
* WebCrypto device keys.
* Direct outbound WSS.
* `chrome.debugger`.
* Explicit selected-tab attachment.
* No remote code or `eval`.

## Model

* Brotto-9B as default.
* Brotto-4B as economical profile.
* Brotto-27B as optional escalation profile.

## Browser transport

* Dedicated-profile CDP connector as the secure default.
* Browser extension as an interactive logged-in mode.
* Local Playwright MCP as a future compatibility fallback, not part of the initial client.

---

# 15. Decisions to lock before implementation

The recommended defaults are:

1. Apache-2.0 source-code license.
2. Brotto-9B as the standard model.
3. Dedicated browser profile for the desktop connector.
4. Existing browser profile only through explicit extension attachment.
5. Outbound WSS relay rather than inbound public CDP.
6. Server-only Playwright MCP and agent harness.
7. Fixed Brotto action schema with a controlled MCP adapter.
8. Mandatory approval for irreversible actions.
9. No arbitrary Playwright code execution.
10. Screenshot retention disabled by default.
11. Chrome and Edge support first.
12. No CAPTCHA bypass or stealth functionality.

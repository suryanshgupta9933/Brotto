# Brotto

**Drive your real browser with any AI model. Model-agnostic. Open-source.**

Brotto is a browser automation framework that attaches an AI agent to your
existing Chrome session — via a Manifest V3 extension. The agent sees what
you see, clicks what you'd click, and pauses for you to log in when sites
require authentication. No separate browser profile. No headless Chromium
spinning up behind a sandbox.

```bash
# Start the planning server
cd services/brotto-orchestrator && pnpm demo:server

# Build the extension
cd clients/brotto-extension && pnpm build

# Load the extension in Chrome: chrome://extensions → Developer mode →
# Load unpacked → select clients/brotto-extension/dist/
```

Click the Brotto action icon, type a goal, watch it drive your real browser.

## Why Brotto

| | browser-use | Claude in Chrome | Brotto |
|---|---|---|---|
| Attaches to your real browser session | ❌ (separate Playwright profile) | ✅ | ✅ |
| Model-agnostic (any OpenAI-compatible endpoint) | ✅ | ❌ (Claude only) | ✅ |
| Strict CDP allowlist (only 5 methods) | ❌ | ✅ | ✅ |
| Open source (Apache-2.0) | ✅ | ❌ | ✅ |
| Side-panel live activity stream | ❌ | ✅ | ✅ |
| Login pause + manual authentication | ❌ | ✅ | ✅ |
| Mid-task clarifying questions | partial | ✅ | ✅ (UI ready, planner hook pending) |
| No vendor lock-in | ❌ | ❌ | ✅ |

## How it works

1. The Chrome extension attaches to a tab via `chrome.debugger` (Chrome DevTools Protocol)
2. It captures the page — DOM, accessibility tree, screenshot — and renders it into a compact text format the model can scan
3. The model emits an action (click, type, navigate, etc.); the extension dispatches it via the strict 5-CDP-method allowlist
4. The loop continues until the model calls `terminate` or hits a stopping condition

```
Extension (chrome.debugger)  ──►  Planner (HTTP /plan)
       ▲                                │
       │                                ▼
       └──── action.command ◄────  gpt-4o-mini / Claude / Ollama / Fara
```

The framework ships with the [OpenAI-compatible planner](services/brotto-orchestrator/src/adapters/openai-compatible-planner.ts), so any endpoint that speaks `/v1/chat/completions` works: OpenAI, Azure OpenAI, Ollama, vLLM, Fara, or your own.

## What's in the repo

```
/apps                 - control-plane-web, admin-console
/services             - api-gateway, brotto-orchestrator, brotto-inference, cdp-relay, ...
/clients              - desktop-connector, brotto-extension
/packages             - brotto-action-schema, brotto-relay-protocol, sdk-typescript, sdk-python, ...
/docs                 - architecture, security, threat-model
```

- **`services/brotto-orchestrator/`** — the server-side harness: state machine, planner adapter, action execution, history
- **`clients/brotto-extension/`** — the Chrome extension (Manifest V3 + side panel)
- **`packages/brotto-action-schema/`** — the action vocabulary the model can emit
- **`packages/brotto-relay-protocol/`** — the wire protocol between orchestrator and extension

## Security

- 5-CDP-method allowlist enforced at runtime. The model cannot run arbitrary CDP commands.
- Sensitive regions (passwords, API keys) are masked before observation leaves the browser.
- Customer-controlled DNS resolution to prevent rebinding attacks.
- Mandatory approval for irreversible actions (deletes, payments, posts).

See [SECURITY.md](SECURITY.md) and [THREAT_MODEL.md](THREAT_MODEL.md).

## Status

| Slice | Status |
|---|---|
| OpenAI-compatible planner adapter | ✅ shipped |
| Context rendering (stable IDs, diff, history) | ✅ shipped |
| Login pause + manual authentication | ✅ shipped |
| Side panel UI (Claude in Chrome style) | ✅ shipped |
| Strict CDP allowlist | ✅ shipped |
| Sensitive region masking | ✅ shipped |
| Multi-tab flows | ⏳ planned |
| Anthropic-native computer-use adapter | ⏳ planned |
| Desktop connector (native binary, isolated profile) | ⏳ planned |
| Deterministic step recording + replay | ⏳ planned |

## Development

```bash
# Install workspace deps
pnpm install

# Typecheck + build extension
cd clients/brotto-extension && pnpm build:tsc && pnpm build

# Run extension tests
node test.mjs

# Start the demo planner
cd services/brotto-orchestrator && pnpm demo:server
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contribution guide.

## License

Apache-2.0. See [LICENSE](LICENSE).

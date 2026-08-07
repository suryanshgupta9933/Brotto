# Brotto

Open-source browser automation framework. The agent harness runs any
OpenAI-compatible model against your real Chrome session via a Manifest V3
extension. See [README.md](README.md) for the one-paragraph pitch; this file
covers the architecture.

## Architecture Overview

Server-hosted agent harness with two thin client connection options:
- **Desktop Connector**: Native executable (Rust/Go) for dedicated browser profiles
- **Browser Extension**: Manifest V3 extension using chrome.debugger for the user's existing browser session

## Key Security Principles

- Never expose client CDP ports to public internet
- Server runs the agent loop, action execution, and CDP relay
- Outbound WSS relay rather than inbound public CDP
- Mandatory approval for irreversible actions
- No arbitrary Playwright code execution exposed to the model

## Repository Structure

```
/apps           - control-plane-web, admin-console
/services       - api-gateway, brotto-orchestrator, brotto-inference, cdp-relay, artifact-service, audit-service
/clients        - desktop-connector, brotto-extension
/packages       - brotto-relay-protocol, brotto-action-schema, policy-engine, coordinate-transform, sdk-typescript, sdk-python, shared-telemetry
/deploy         - docker-compose, helm, terraform-examples
/evals          - browser-tasks, prompt-injection, security, reliability, performance
/docs           - architecture, security, threat-model, protocol, deployment docs
```

## Implementation Phases

1. Phase 0 - Architecture validation
2. Phase 1 - Relay protocol and desktop connector
3. Phase 2 - Core agent loop
4. Phase 3 - Policy and human approval
5. Phase 4 - Browser extension
6. Phase 5 - Files, credentials, authenticated workflows
7. Phase 6 - Hardening and adversarial testing
8. Phase 7 - Open-source beta
9. Phase 8 - Production readiness

## Technology Stack

- **Server**: TypeScript, Go/Rust (CDP relay), Python (inference), PostgreSQL, Redis
- **Desktop connector**: Rust or Go, single executable, OS keychain integration
- **Extension**: TypeScript, Manifest V3, WebCrypto device keys, chrome.debugger
- **Model**: model-agnostic. Works with any OpenAI-compatible endpoint (OpenAI, Azure OpenAI, Ollama, vLLM, Fara). No vendor lock-in.

## Locked Decisions

1. Apache-2.0 license
2. Model-agnostic — works with any OpenAI-compatible endpoint
3. Dedicated browser profile for desktop connector
4. Outbound WSS relay
5. Server-only Playwright MCP and agent harness
6. Fixed action schema with controlled MCP adapter
7. Mandatory approval for irreversible actions
8. Screenshot retention disabled by default
9. Chrome and Edge support first
10. No CAPTCHA bypass or stealth functionality

## Commands

```bash
# Start the demo planner (port 3001)
cd services/brotto-orchestrator
set -a && source .env.demo && set +a   # OPENAI_API_KEY, SMOKE_MODEL
pnpm demo:server

# Build the extension
cd clients/brotto-extension && pnpm build

# Run extension tests
node test.mjs
```

## Relevant Skills

Use `superpowers:execute-plan` for implementation planning and tracking.
Use `superpowers:brainstorming` when exploring new designs or major changes.

## Branches

- `stable` — pinned working set for install + try.
- `main` — canonical-path / security work.
- `feature/v2-dom-workflow` — active harness iteration (goal-detector,
  working memory, stagnation nudges, pre-navigate-to-goal-site, etc.).

Recent fixes are documented in [CHANGELOG.md](CHANGELOG.md).

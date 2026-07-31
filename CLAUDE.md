# Fara1.5 Browser Automation Platform

This is the project working directory for the Fara1.5 Browser Automation Platform.

## Architecture Overview

Server-hosted agent harness with two thin client connection options:
- **Desktop Connector**: Native executable (Rust/Go) for dedicated browser profiles
- **Browser Extension**: Manifest V3 extension using chrome.debugger for existing browser sessions

## Key Security Principles

- Never expose client CDP ports to public internet
- Server runs Fara inference, agent loop, Playwright MCP, CDP relay
- Outbound WSS relay rather than inbound public CDP
- Mandatory approval for irreversible actions
- No arbitrary Playwright code execution exposed to the model

## Repository Structure

```
/apps           - control-plane-web, admin-console
/services       - api-gateway, agent-orchestrator, fara-inference, browser-mcp-gateway, cdp-relay, artifact-service, audit-service
/clients        - desktop-connector, browser-extension
/packages       - relay-protocol, fara-action-schema, policy-engine, coordinate-transform, sdk-typescript, sdk-python, shared-telemetry
/deploy         - docker-compose, helm, terraform-examples
/evals          - browser-tasks, prompt-injection, security, reliability, performance
/docs           - architecture, security, threat-model, protocol, deployment docs
```

## Implementation Phases

1. Phase 0 - Architecture validation
2. Phase 1 - Relay protocol and desktop connector
3. Phase 2 - Core Fara agent loop
4. Phase 3 - Policy and human approval
5. Phase 4 - Browser extension
6. Phase 5 - Files, credentials, authenticated workflows
7. Phase 6 - Hardening and adversarial testing
8. Phase 7 - Open-source beta
9. Phase 8 - Production readiness

## Technology Stack

- **Server**: TypeScript, Go/Rust (CDP relay), Python/vLLM (inference), PostgreSQL, Redis
- **Desktop connector**: Rust or Go, single executable, OS keychain integration
- **Extension**: TypeScript, Manifest V3, WebCrypto device keys, chrome.debugger
- **Model**: Fara1.5-9B (standard), Fara1.5-4B (economy), Fara1.5-27B (quality)

## Locked Decisions

1. Apache-2.0 license
2. Fara1.5-9B as standard model
3. Dedicated browser profile for desktop connector
4. Outbound WSS relay
5. Server-only Playwright MCP and agent harness
6. Fixed Fara action schema with controlled MCP adapter
7. Mandatory approval for irreversible actions
8. Screenshot retention disabled by default
9. Chrome and Edge support first
10. No CAPTCHA bypass or stealth functionality

## Commands

```bash
# Start development environment
docker-compose -f deploy/docker-compose/dev.yml up

# Run tests
npm test

# Build desktop connector
cd clients/desktop-connector && cargo build --release
```

## Relevant Skills

Use `superpowers:execute-plan` for implementation planning and tracking.
Use `superpowers:brainstorming` when exploring new designs or major changes.

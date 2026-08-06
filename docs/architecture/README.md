# Architecture Documentation

Detailed architecture documentation for the Brotto Browser Automation Platform.

## Contents

- [Overview](./overview.md) - High-level system architecture
- [Control Plane](./control-plane.md) - Web UI and API design
- [Agent Orchestrator](./orchestrator.md) - Session state machine and agent loop
- [Brotto Inference](./inference.md) - Model inference architecture
- [Browser MCP Gateway](./mcp-gateway.md) - Playwright MCP integration
- [CDP Relay](./relay.md) - Protocol and tunnel design
- [Coordinate System](./coordinates.md) - Screenshot normalization and transforms
- [Session Isolation](./isolation.md) - Security boundaries and tenant isolation

## Overview

The Brotto platform uses a server-hosted agent architecture:
- **Server**: Runs Brotto inference, agent logic, Playwright MCP, CDP relay, policy engine, and audit logging
- **Clients**: Thin transports - Desktop connector (Rust/Go) or Browser extension (TypeScript)
- **Transport**: Authenticated outbound WebSocket connections from clients to server

The model (Brotto) is screenshot-based and produces coordinate-grounded actions. Playwright MCP is the browser execution layer.

## Key Architectural Decisions

1. **Outbound WSS relay** - Clients establish outbound connections; CDP never exposed on public network
2. **Server-side MCP** - Playwright MCP runs server-side, not on clients
3. **Fixed action schema** - Brotto actions mapped to controlled MCP tools
4. **Mandatory approval** - Irreversible actions require explicit user approval
5. **Apache-2.0** - Project source code license

## Related

- [ARCHITECTURE.md](../../ARCHITECTURE.md) - Master architecture document
- [Protocol Documentation](../protocol/README.md)
- [Security Documentation](../security/README.md)

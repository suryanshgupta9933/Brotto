# Control Plane Web

The web-based control interface for the Fara1.5 Browser Automation Platform. This is the primary UI where users create tasks, monitor sessions, approve critical actions, and manage policies.

## Purpose

The control plane web UI provides:
- User and organization authentication (OIDC)
- Task creation and monitoring
- Real-time session updates (WebSocket/SSE)
- Critical-action approval prompts
- Domain and action policy management
- Audit log access
- Session termination controls
- Connector and extension download links

## Technology

- TypeScript
- React (or Next.js for SSR)
- PostgreSQL for control-plane state
- Redis for session leases and queues

## Architecture

The control plane must not directly send arbitrary CDP commands. All browser commands pass through the agent orchestrator, policy engine, and MCP gateway. The control plane only manages task lifecycle, authentication, and approval workflows.

## Related

- [Agent Orchestrator](../services/agent-orchestrator/README.md)
- [Admin Console](../apps/admin-console/README.md)

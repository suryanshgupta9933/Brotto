# Agent Orchestrator

The core agent harness that owns the complete browser automation loop. The orchestrator maintains session state, manages the Fara inference pipeline, and coordinates actions through the MCP gateway.

## Purpose

The agent orchestrator owns:
- Session state machine (CREATED → WAITING_FOR_CLIENT → CONNECTED → OBSERVING → PLANNING → POLICY_CHECK → WAITING_FOR_APPROVAL → EXECUTING → VERIFYING → COMPLETED/FAILED/CANCELLED)
- Task goal maintenance
- Bounded action and screenshot history
- Fara inference requests
- Fara tool call parsing and validation
- Policy approval requests
- Action execution through MCP
- Screenshot capture and next browser state
- Completion and failure detection
- Time, step, token, and cost budgets

## Technology

- TypeScript
- Coordinates with Fara inference service and Browser MCP gateway

## Security

The orchestrator is a critical security boundary. It never lets the model directly control authentication tokens, CDP session identifiers, internal service URLs, arbitrary JavaScript execution, local file paths, system commands, or policy settings.

## Related

- [Fara Inference Service](../fara-inference/README.md)
- [Browser MCP Gateway](../browser-mcp-gateway/README.md)
- [Policy Engine](../../packages/policy-engine/README.md)

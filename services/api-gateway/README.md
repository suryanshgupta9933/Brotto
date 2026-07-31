# API Gateway

Central API gateway for the Fara1.5 Browser Automation Platform. Routes incoming requests to appropriate services and handles authentication, rate limiting, and request validation.

## Purpose

The API gateway provides:
- Request routing to backend services
- JWT/OIDC token validation
- Rate limiting and quotas
- Request/response transformation
- API versioning
- Load balancing for backend services

## Technology

- TypeScript or Go
- Stateless design for horizontal scaling

## Architecture

All external API traffic flows through the gateway. It is the single entry point for:
- Control plane web requests
- SDK client requests
- Webhook callbacks

## Related

- [Control Plane Web](../../apps/control-plane-web/README.md)
- [Agent Orchestrator](../agent-orchestrator/README.md)

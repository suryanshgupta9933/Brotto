# Docker Compose

Docker Compose configurations for local development and community deployments of the Fara1.5 platform.

## Purpose

This directory contains:
- `docker-compose.yml` - Full platform stack for local development
- `docker-compose.dev.yml` - Development configuration with hot reload
- `docker-compose.prod.yml` - Production configuration with resource limits

## Quick Start

```bash
# Start the full platform locally
docker compose up

# Start in development mode
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

## Services

The compose stack includes:
- control-plane - Web UI and API
- orchestrator - Agent orchestration service
- fara-inference - Model inference service
- browser-mcp-gateway - Playwright MCP gateway
- cdp-relay - CDP relay broker
- artifact-service - File transfer service
- audit-service - Audit logging service
- postgres - Control plane database
- redis - Session leases and queues

## Notes

- Model weights are not included - configure FARA_INFERENCE_BASE_URL to point to a vLLM endpoint
- Requires Docker Engine 20.10+ and Docker Compose v2
- See `../helm` for Kubernetes production deployments

## Related

- [Helm Charts](../helm/README.md)
- [Terraform Examples](../terraform-examples/README.md)

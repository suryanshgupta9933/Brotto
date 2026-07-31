# Helm Charts

Helm charts for deploying the Fara1.5 platform to Kubernetes.

## Purpose

This directory contains:
- `control-plane/` - Control plane web and API
- `orchestrator/` - Agent orchestrator service
- `fara-inference/` - Model inference deployment
- `browser-mcp-gateway/` - Playwright MCP gateway
- `cdp-relay/` - CDP relay service
- `artifact-service/` - Artifact storage service
- `audit-service/` - Audit logging service
- `platform/` - Unified chart deploying the full stack

## Installation

```bash
# Add the repository
helm repo add fara https://charts.fara.example.com
helm repo update

# Install the platform
helm install fara-platform fara/platform

# Install with custom values
helm install fara-platform fara/platform -f values.yaml
```

## Production Considerations

- Use GPU node pools for fara-inference (NVIDIA GPU required)
- Configure PostgreSQL with high availability
- Configure Redis with replication
- Set up object storage for artifacts
- Enable TLS and configure certificates
- Set resource limits and requests
- Configure autoscaling for stateless services

## Related

- [Docker Compose](../docker-compose/README.md)
- [Terraform Examples](../terraform-examples/README.md)
- [Deployment Documentation](../../docs/deployment/README.md)

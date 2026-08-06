# Docker Compose

Docker Compose configurations for local development and community deployments of the Brotto platform.

## Quick Start

```bash
# Start the full platform locally (development mode)
docker compose -f dev.yml up

# Start in production mode
docker compose -f prod.yml up

# Start with observability stack
docker compose -f dev.yml -f ../otel/docker-compose.observability.yml up
```

## Services

The compose stack includes:

| Service | Port | Description |
|---------|------|-------------|
| control-plane | 3000 | Web UI and API Gateway |
| orchestrator | 3002 | Agent orchestration service |
| brotto-inference | 8000/8080 | Model inference service (vLLM) |
| playwright-mcp-gateway | 8080 | Playwright MCP gateway |
| cdp-relay | 8081 | CDP relay broker |
| artifact-service | 3003 | File transfer service |
| audit-service | 3004 | Audit logging service |
| postgres | 5432 | PostgreSQL database |
| redis | 6379 | Redis cache |

## Development Mode

```bash
# Start core services only
docker compose -f dev.yml --profile core up

# Start with browser automation
docker compose -f dev.yml --profile core --profile browser up

# Start with inference (requires GPU)
docker compose -f dev.yml --profile inference up

# Start with observability (Prometheus, Grafana, Jaeger)
docker compose -f dev.yml --profile observability up
```

## Production Mode

```bash
# Set required environment variables
export POSTGRES_USER=fara15
export POSTGRES_PASSWORD=<secure-password>
export POSTGRES_DB=fara15_control_plane
export REDIS_PASSWORD=<secure-password>
export OIDC_ISSUER=https://auth.example.com
export OIDC_CLIENT_ID=fara15
export OIDC_CLIENT_SECRET=<client-secret>
export VLLM_MODEL_REPO=inventic/fara1.5-9b
export IMAGE_TAG=latest

# Start production stack
docker compose -f prod.yml --profile core up
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `POSTGRES_USER` | PostgreSQL username | fara15 |
| `POSTGRES_PASSWORD` | PostgreSQL password | (required) |
| `POSTGRES_DB` | Database name | fara15_control_plane |
| `REDIS_PASSWORD` | Redis password | (required) |
| `OIDC_ISSUER` | OIDC provider URL | - |
| `OIDC_CLIENT_ID` | OIDC client ID | api-gateway |
| `OIDC_CLIENT_SECRET` | OIDC client secret | (required) |
| `VLLM_MODEL_REPO` | Model repository | inventic/fara1.5-9b |
| `IMAGE_TAG` | Container image tag | latest |

## Notes

- Model weights are not included - configure FARA_INFERENCE_BASE_URL to point to a vLLM endpoint
- Requires Docker Engine 20.10+ and Docker Compose v2
- GPU support requires nvidia-container-toolkit
- See `../helm` for Kubernetes production deployments
- See `../terraform` for cloud infrastructure examples

## Related

- [Helm Charts](../helm/README.md)
- [Terraform Examples](../terraform-examples/README.md)

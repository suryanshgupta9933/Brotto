# Deployment Documentation

Deployment guides and operational documentation for the Brotto Browser Automation Platform.

## Contents

- [Overview](./overview.md) - Deployment architecture
- [Local Development](./local-dev.md) - Running the platform locally
- [Docker Compose](./docker.md) - Docker Compose deployment
- [Kubernetes](./kubernetes.md) - Helm chart deployment
- [Cloud Providers](./cloud.md) - AWS/GCP/Azure deployment
- [GPU Setup](./gpu.md) - NVIDIA GPU configuration for inference
- [Monitoring](./monitoring.md) - Observability and alerting
- [Backup](./backup.md) - Backup and recovery procedures
- [Scaling](./scaling.md) - Horizontal and vertical scaling

## Deployment Options

### Local Development
```bash
docker compose up
```

### Production

1. **Kubernetes (Recommended)**
   ```bash
   helm install fara fara/platform -n fara --create-namespace
   ```

2. **Terraform (AWS/GCP/Azure)**
   See `../../deploy/terraform-examples/`

## Infrastructure Requirements

### Minimum
- 4 vCPU / 8 GB RAM for control plane
- 8 vCPU / 32 GB RAM with 1 GPU for inference
- PostgreSQL 14+
- Redis 6+
- 100 GB object storage

### Recommended
- Multi-AZ deployment
- GPU node pools for inference autoscaling
- Managed database with read replicas
- Redis cluster mode
- CDN for static assets

## Related

- [Docker Compose Templates](../../deploy/docker-compose/README.md)
- [Helm Charts](../../deploy/helm/README.md)
- [Terraform Examples](../../deploy/terraform-examples/README.md)

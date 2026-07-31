# Terraform Examples

Infrastructure as Code examples for deploying the Fara1.5 platform to cloud providers.

## Purpose

This directory contains:
- `aws/` - AWS deployment (EKS, RDS, ElastiCache, S3)
- `gcp/` - Google Cloud deployment (GKE, Cloud SQL, Memorystore, GCS)
- `azure/` - Azure deployment (AKS, Azure Database, Redis, Blob Storage)

## Usage

```bash
# Initialize Terraform
cd aws/eks
terraform init

# Plan deployment
terraform plan -var-file=vars/dev.tfvars

# Apply
terraform apply -var-file=vars/dev.tfvars
```

## Prerequisites

- Terraform >= 1.0
- kubectl configured for target cluster
- Appropriate cloud provider CLI configured
- GPU quota for inference nodes (where applicable)

## Components

Each example deploys:
- Kubernetes cluster (EKS/GKE/AKS)
- Managed PostgreSQL database
- Managed Redis/cache
- Object storage bucket
- Load balancers and ingress
- Secrets management integration
- GPU node pools for inference (optional)

## Related

- [Docker Compose](../docker-compose/README.md)
- [Helm Charts](../helm/README.md)
- [Deployment Documentation](../../docs/deployment/README.md)

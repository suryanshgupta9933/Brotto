# AWS EKS Terraform Configuration for Fara1.5 Platform
# This module creates an EKS cluster with GPU node pools for inference

terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.23"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.12"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_availability_zones" "available" {
  state = "available"
}

# VPC Configuration
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "${var.cluster_name}-vpc"
  cidr = var.vpc_cidr

  azs             = slice(data.aws_availability_zones.available.names, 0, 3)
  private_subnets = var.private_subnet_cidrs
  public_subnets  = var.public_subnet_cidrs

  enable_nat_gateway     = true
  single_nat_gateway    = false
  enable_dns_hostnames   = true
  enable_dns_support     = true

  tags = merge(var.common_tags, {
    Name = "${var.cluster_name}-vpc"
  })
}

# EKS Cluster
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 19.0"

  cluster_name    = var.cluster_name
  cluster_version = var.kubernetes_version

  vpc_id                   = module.vpc.vpc_id
  subnet_ids               = module.vpc.private_subnets
  control_plane_subnet_ids = module.vpc.private_subnets

  # EKS Managed Node Groups
  eks_managed_node_groups = {
    general = {
      name            = "general"
      instance_types  = var.general_instance_types
      min_size        = var.general_node_min_size
      max_size        = var.general_node_max_size
      desired_size    = var.general_node_desired_size

      key_name        = var.ssh_key_name
      enable_monitoring = true

      labels = {
        role = "general"
      }

      tags = {
        "karpenter.sh/capacity-type" = "on-demand"
      }
    }

    gpu = {
      name            = "gpu"
      instance_types  = var.gpu_instance_types
      min_size        = var.gpu_node_min_size
      max_size        = var.gpu_node_max_size
      desired_size    = var.gpu_node_desired_size

      key_name        = var.ssh_key_name
      enable_monitoring = true

      labels = {
        role            = "gpu"
        node.kubernetes.io/lifecycle = "gpu"
      }

      taints = [
        {
          key    = "nvidia.com/gpu"
          value  = "present"
          effect = "NO_SCHEDULE"
        }
      ]

      tags = {
        "karpenter.sh/capacity-type" = "on-demand"
      }
    }
  }

  # Cluster addons
  cluster_addons = {
    coredns = {
      most_recent = true
    }
    kube-proxy = {
      most_recent = true
    }
    vpc-cni = {
      most_recent = true
    }
  }

  # OIDC Provider
  enable_oidc = true

  # Tags
  tags = merge(var.common_tags, {
    Name = var.cluster_name
  })
}

# Kubernetes provider for Helm
provider "kubernetes" {
  host                   = module.eks.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name]
  }
}

# Helm provider
provider "helm" {
  kubernetes {
    host                   = module.eks.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name]
    }
  }
}

# AWS Load Balancer Controller
resource "helm_release" "aws_lb_controller" {
  name = "aws-load-balancer-controller"

  repository = "https://aws.github.io/eks-charts"
  chart      = "aws-load-balancer-controller"
  namespace  = "kube-system"
  version    = "1.6.2"

  set {
    name  = "clusterName"
    value = var.cluster_name
  }

  set {
    name  = "serviceAccount.create"
    value = "true"
  }

  set {
    name  = "serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn"
    value = module.aws_lb_controller_iam_role.iam_role_arn
  }

  depends_on = [module.eks]
}

# External DNS
resource "helm_release" "external_dns" {
  name = "external-dns"

  repository = "https://kubernetes-sigs.github.io/external-dns/"
  chart      = "external-dns"
  namespace  = "kube-system"
  version    = "1.13.1"

  set {
    name  = "provider"
    value = "aws"
  }

  set {
    name  = "aws.zoneType"
    value = "public"
  }

  set {
    name  = "policy"
    value = "sync"
  }

  set {
    name  = "serviceAccount.create"
    value = "true"
  }

  set {
    name  = "serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn"
    value = module.external_dns_iam_role.iam_role_arn
  }

  depends_on = [module.eks]
}

# Metrics Server
resource "helm_release" "metrics_server" {
  name = "metrics-server"

  repository = "https://kubernetes-sigs.github.io/metrics-server/"
  chart      = "metrics-server"
  namespace  = "kube-system"
  version    = "3.11.0"

  set {
    name  = "resources.requests.cpu"
    value = "100m"
  }

  set {
    name  = "resources.requests.memory"
    value = "200Mi"
  }
}

# Cluster Autoscaler
resource "helm_release" "cluster_autoscaler" {
  name = "cluster-autoscaler"

  repository = "https://kubernetes.github.io/kube-ops-tools"
  chart      = "cluster-autoscaler"
  namespace  = "kube-system"
  version    = "9.35.0"

  set {
    name  = "cloudProvider"
    value = "aws"
  }

  set {
    name  = "autoDiscovery.clusterName"
    value = var.cluster_name
  }

  set {
    name  = "awsRegion"
    value = var.aws_region
  }

  set {
    name  = "serviceAccount.create"
    value = "true"
  }

  set {
    name  = "serviceAccount.name"
    value = "cluster-autoscaler"
  }

  set {
    name  = "serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn"
    value = module.cluster_autoscaler_iam_role.iam_role_arn
  }

  set {
    name  = "extraArgs.scale-up-utilization-threshold"
    value = "0.5"
  }

  depends_on = [module.eks]
}

# Fara Platform Helm Release
resource "helm_release" "fara_platform" {
  name = "fara-platform"

  repository = "file://../../helm/fara-platform"
  chart      = "fara-platform"
  namespace  = "fara15"

  create_namespace = true

  version = "1.0.0"

  values = [
    file("${path.module}/values.yaml")
  ]

  set {
    name  = "global.imageRegistry"
    value = "ghcr.io/inventic/fara15"
  }

  set {
    name  = "imageTag"
    value = var.image_tag
  }

  set {
    name  = "controlPlane.ingress.enabled"
    value = "true"
  }

  set {
    name  = "controlPlane.ingress.hosts[0].host"
    value = var.api_domain
  }

  set {
    name  = "artifactService.ingress.enabled"
    value = "true"
  }

  set {
    name  = "artifactService.ingress.hosts[0].host"
    value = var.artifacts_domain
  }

  set {
    name  = "opentelemetry.exporterEndpoint"
    value = var.otel_endpoint
  }

  set {
    name  = "postgresql.auth.username"
    value = "fara15"
  }

  set {
    name  = "postgresql.auth.database"
    value = "fara15_control_plane"
  }

  set_sensitive {
    name  = "postgresql.auth.password"
    value = var.postgres_password
  }

  set {
    name  = "redis.auth.enabled"
    value = "true"
  }

  set_sensitive {
    name  = "redis.auth.password"
    value = var.redis_password
  }

  set {
    name  = "faraInference.nodeSelector.node\\.kubernetes\\.io/lifecycle"
    value = "gpu"
  }

  set {
    name  = "faraInference.tolerations[0].key"
    value = "nvidia.com/gpu"
  }

  set {
    name  = "faraInference.tolerations[0].operator"
    value = "Exists"
  }

  set {
    name  = "faraInference.tolerations[0].effect"
    value = "NoSchedule"
  }

  depends_on = [
    helm_release.aws_lb_controller,
    helm_release.metrics_server,
    module.eks
  ]
}

# IAM Roles for IRSA (optional components)
module "aws_lb_controller_iam_role" {
  source = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"

  role_name = "${var.cluster_name}-aws-lb-controller"

  role_policy_arns = {
    policy = "arn:aws:iam::aws:policy/AWSLoadBalancerControllerIAMPolicy"
  }

  oidc_providers = {
    main = {
      provider_arn = module.eks.oidc_provider_arn
      namespace_service_accounts = ["kube-system:aws-load-balancer-controller"]
    }
  }
}

module "external_dns_iam_role" {
  source = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"

  role_name = "${var.cluster_name}-external-dns"

  role_policy_arns = {
    policy = "arn:aws:iam::aws:policy/AmazonRoute53FullAccess"
  }

  oidc_providers = {
    main = {
      provider_arn = module.eks.oidc_provider_arn
      namespace_service_accounts = ["kube-system:external-dns"]
    }
  }
}

module "cluster_autoscaler_iam_role" {
  source = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"

  role_name = "${var.cluster_name}-cluster-autoscaler"

  role_policy_arns = {
    policy = "arn:aws:iam::aws:policy/autoscaling:DescribeAutoScalingGroups"
  }

  oidc_providers = {
    main = {
      provider_arn = module.eks.oidc_provider_arn
      namespace_service_accounts = ["kube-system:cluster-autoscaler"]
    }
  }
}

# Outputs
output "cluster_endpoint" {
  description = "EKS cluster endpoint"
  value      = module.eks.cluster_endpoint
}

output "cluster_name" {
  description = "EKS cluster name"
  value      = module.eks.cluster_name
}

output "cluster_arn" {
  description = "EKS cluster ARN"
  value      = module.eks.cluster_arn
}

output "vpc_id" {
  description = "VPC ID"
  value      = module.vpc.vpc_id
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value      = module.vpc.private_subnets
}

output "node_roles" {
  description = "Node IAM role ARNs"
  value = {
    general = module.eks.managed_node_groups["general"].iam_role_arn
    gpu     = module.eks.managed_node_groups["gpu"].iam_role_arn
  }
}

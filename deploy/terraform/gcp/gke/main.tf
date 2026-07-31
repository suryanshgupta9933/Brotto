# GCP GKE Terraform Configuration for Fara1.5 Platform
# This module creates a GKE cluster with GPU node pools for inference

terraform {
  required_version = ">= 1.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
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

provider "google" {
  project = var.project_id
  region  = var.gcp_region
}

provider "google-beta" {
  project = var.project_id
  region  = var.gcp_region
}

# VPC Network
resource "google_compute_network" "vpc" {
  name                    = "${var.cluster_name}-vpc"
  auto_create_subnetworks = false
  description             = "Fara1.5 Platform VPC"
}

# Subnet
resource "google_compute_subnetwork" "subnet" {
  name          = "${var.cluster_name}-subnet"
  network       = google_compute_network.vpc.id
  ip_cidr_range = var.subnet_cidr

  region = var.gcp_region

  secondary_ip_range = [
    {
      range_name    = "pods"
      ip_cidr_range = "10.1.0.0/16"
    },
    {
      range_name    = "services"
      ip_cidr_range = "10.2.0.0/16"
    }
  ]

  private_ip_google_access = true
}

# Cloud Router and NAT
resource "google_compute_router" "router" {
  name    = "${var.cluster_name}-router"
  network = google_compute_network.vpc.id
  region  = var.gcp_region
}

resource "google_compute_router_nat" "nat" {
  name                               = "${var.cluster_name}-nat"
  router                             = google_compute_router.router.name
  region                             = var.gcp_region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_PRIMARY_RANGES"

  log_config {
    filter = "ERRORS_ONLY"
    metadata = "INCLUDE_ALL_METADATA"
  }
}

# GKE Cluster
resource "google_container_cluster" "primary" {
  name     = var.cluster_name
  location = var.gcp_region

  # Network
  network    = google_compute_network.vpc.name
  subnetwork = google_compute_subnetwork.subnet.name

  # Release channel
  release_channel {
    channel = "STABLE"
  }

  # Version
  min_master_version = var.kubernetes_version

  # Addons
  addons_config {
    http_load_balancing {
      disabled = false
    }
    horizontal_pod_autoscaling {
      disabled = false
    }
    network_policy_config {
      disabled = false
    }
  }

  # Network policy
  network_policy {
    enabled  = true
    provider = "CALICO"
  }

  # IP allocation
  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  # Private cluster
  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }

  # Master authorized networks
  master_authorized_networks_config {
    cidr_blocks {
      cidr_block   = var.master_authorized_cidr
      display_name = "Admin CIDR"
    }
  }

  # Node pools
  node_pool {
    name               = "general"
    initial_node_count = var.general_node_count

    node_config {
      machine_type  = var.general_machine_type
      preemptible   = false
      disk_size_gb  = 100
      disk_type     = "pd-ssd"

      labels = {
        role = "general"
      }

      service_account = google_service_account.node.email
    }

    management {
      auto_repair  = true
      auto_upgrade = true
    }
  }

  # GPU Node Pool
  node_pool {
    name               = "gpu"
    initial_node_count = var.gpu_node_count

    node_config {
      machine_type   = var.gpu_machine_type
      preemptible    = false
      disk_size_gb   = 100
      disk_type      = "pd-ssd"

      guest_accelerators {
        accelerator_type  = var.gpu_accelerator_type
        accelerator_count = var.gpu_count_per_node
      }

      labels = {
        role                      = "gpu"
        "cloud.google.com/gke-nodepool" = "gpu"
      }

      taints {
        key    = "nvidia.com/gpu"
        value  = "present"
        effect = "NO_SCHEDULE"
      }

      service_account = google_service_account.node.email
    }

    management {
      auto_repair  = true
      auto_upgrade = true
    }

    autoscaling {
      min_node_count = var.gpu_node_min_count
      max_node_count = var.gpu_node_max_count
    }
  }

  # EnableShieldedNodes
  enable_shielded_nodes = true

  # Workload Identity
  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  # Labels
  resource_labels = merge(var.common_labels, {
    name = var.cluster_name
  })
}

# Service Account for Nodes
resource "google_service_account" "node" {
  account_id   = "${var.cluster_name}-node"
  display_name = "GKE Node Service Account"
}

# Node Service Account Roles
resource "google_project_iam_member" "node_roles" {
  for_each = toset([
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/monitoring.notificationSender",
    "roles/storage.objectViewer"
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.node.email}"
}

# Kubernetes Provider
provider "kubernetes" {
  host                   = "https://${google_container_cluster.primary.endpoint}"
  token                  = data.google_client_config.default.access_token
  cluster_ca_certificate = base64decode(google_container_cluster.primary.master_auth[0].cluster_ca_certificate)
}

data "google_client_config" "default" {}

# Helm Provider
provider "helm" {
  kubernetes {
    host                   = "https://${google_container_cluster.primary.endpoint}"
    token                  = data.google_client_config.default.access_token
    cluster_ca_certificate = base64decode(google_container_cluster.primary.master_auth[0].cluster_ca_certificate)
  }
}

# Workload Identity Binding for Helm
resource "kubernetes_service_account" "helm" {
  metadata {
    name      = "helm"
    namespace = "kube-system"
  }

  automount_service_account_token = true
}

resource "google_service_account_iam_member" "helm_workload_identity" {
  service_account_id = google_service_account.node.id
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[kube-system/${kubernetes_service_account.helm.metadata[0].name}]"
}

# Nginx Ingress Controller
resource "helm_release" "nginx_ingress" {
  name = "nginx-ingress"

  repository = "https://kubernetes.github.io/ingress-nginx"
  chart      = "ingress-nginx"
  namespace  = "kube-system"
  version    = "4.8.0"

  set {
    name  = "controller.service.type"
    value = "LoadBalancer"
  }

  set {
    name  = "controller.service.account.name"
    value = google_service_account.node.account_id
  }

  set {
    name  = "controller.publishService.enabled"
    value = "true"
  }
}

# Metrics Server
resource "helm_release" "metrics_server" {
  name = "metrics-server"

  repository = "https://kubernetes-sigs.github.io/metrics-server/"
  chart      = "metrics-server"
  namespace  = "kube-system"
  version    = "3.11.0"
}

# Cluster Autoscaler
resource "helm_release" "cluster_autoscaler" {
  name = "cluster-autoscaler"

  repository = "https://kubernetes.github.io/kube-ops-tools"
  chart      = "cluster-autoscaler"
  namespace  = "kube-system"
  version    = "9.35.0"

  set {
    name  = "autoDiscovery.clusterName"
    value = var.cluster_name
  }

  set {
    name  = "cloudProvider"
    value = "gce"
  }

  set {
    name  = "serviceAccount.create"
    value = "true"
  }

  set {
    name  = "serviceAccount.name"
    value = "cluster-autoscaler"
  }
}

# GCE PD CSI Driver
resource "helm_release" "gce_pd_csi" {
  name = "gce-pd-csi-driver"

  repository = "https://kubernetes-sigs.github.io/gcp-compute-persistent-disk-csi-driver"
  chart      = "gce-pd-csi-driver"
  namespace  = "kube-system"
  version    = "1.13.0"

  set {
    name  = "controller.serviceAccount.create"
    value = "true"
  }

  set {
    name  = "node.serviceAccount.create"
    value = "true"
  }
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
    name  = "controlPlane.ingress.className"
    value = "nginx"
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
    name  = "artifactService.ingress.className"
    value = "nginx"
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
    name  = "faraInference.nodeSelector.cloud\\.google\\.com/gke-nodepool"
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
    google_container_cluster.primary,
    helm_release.nginx_ingress
  ]
}

# Outputs
output "cluster_endpoint" {
  description = "GKE cluster endpoint"
  value      = google_container_cluster.primary.endpoint
}

output "cluster_name" {
  description = "GKE cluster name"
  value      = google_container_cluster.primary.name
}

output "cluster_location" {
  description = "GKE cluster location"
  value      = google_container_cluster.primary.location
}

output "vpc_id" {
  description = "VPC ID"
  value      = google_compute_network.vpc.id
}

output "subnet_id" {
  description = "Subnet ID"
  value      = google_compute_subnetwork.subnet.id
}

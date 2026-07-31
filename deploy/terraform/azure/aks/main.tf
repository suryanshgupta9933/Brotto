# Azure AKS Terraform Configuration for Fara1.5 Platform
# This module creates an AKS cluster with GPU node pools for inference

terraform {
  required_version = ">= 1.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.80"
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

provider "azurerm" {
  features {}
  use_oidc = true
}

# Resource Group
resource "azurerm_resource_group" "rg" {
  name     = "${var.cluster_name}-rg"
  location = var.azure_location

  tags = merge(var.common_tags, {
    Name = "${var.cluster_name}-rg"
  })
}

# Virtual Network
resource "azurerm_virtual_network" "vnet" {
  name                = "${var.cluster_name}-vnet"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  address_space       = [var.vnet_cidr]

  tags = merge(var.common_tags, {
    Name = "${var.cluster_name}-vnet"
  })
}

# Subnet for AKS
resource "azurerm_subnet" "aks_subnet" {
  name                 = "${var.cluster_name}-aks-subnet"
  resource_group_name   = azurerm_resource_group.rg.name
  virtual_network_name  = azurerm_virtual_network.vnet.name
  address_prefixes      = var.aks_subnet_cidrs

  private_endpoint_network_policies_enabled     = true
  private_link_service_network_policies_enabled = true
}

# Azure CNI
resource "azurerm_subscription" "current" {}

# AKS Cluster
resource "azurerm_kubernetes_cluster" "aks" {
  name                = var.cluster_name
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  dns_prefix          = var.cluster_name
  kubernetes_version  = var.kubernetes_version
  sku_tier            = "Standard"

  identity {
    type = "SystemAssigned"
  }

  # Network profile
  network_profile {
    network_plugin     = "azure"
    network_policy     = "calico"
    load_balancer_sku  = "standard"
    outbound_type      = "loadBalancer"
    service_cidr       = var.service_cidr
    dns_service_ip     = var.dns_service_ip
  }

  # Default node pool
  default_node_pool {
    name                = "general"
    node_count          = var.general_node_count
    vm_size             = var.general_vm_size
    type                = "VirtualMachineScaleSets"
    availability_zones  = ["1", "2", "3"]
    enable_auto_scaling = true
    min_count           = var.general_node_min_count
    max_count           = var.general_node_max_count
    os_disk_size_gb     = 100
    os_disk_type        = "Managed"
    vnet_subnet_id      = azurerm_subnet.aks_subnet.id

    node_labels = {
      "role" = "general"
    }
  }

  # Kubelet config
  kubelet_identity {
    client_id = azurerm_kubernetes_cluster.aks.kubelet_identity[0].client_id
    object_id = azurerm_kubernetes_cluster.aks.kubelet_identity[0].object_id
    resource_id = azurerm_kubernetes_cluster.aks.kubelet_identity[0].resource_id
  }

  # Azure Monitor
  azure_monitor_profile {
    log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  }

  # Key Management
  key_vault_secrets_provider {
    secret_rotation_enabled = true
  }

  tags = merge(var.common_tags, {
    Name = var.cluster_name
  })
}

# GPU Node Pool
resource "azurerm_kubernetes_cluster_node_pool" "gpu" {
  name                  = "gpu"
  kubernetes_cluster_id  = azurerm_kubernetes_cluster.aks.id
  vm_size               = var.gpu_vm_size
  node_count            = var.gpu_node_count
  type                 = "VirtualMachineScaleSets"
  availability_zones    = ["1", "2", "3"]
  enable_auto_scaling   = true
  min_count             = var.gpu_node_min_count
  max_count             = var.gpu_node_max_count
  os_disk_size_gb      = 100
  os_disk_type         = "Managed"
  vnet_subnet_id       = azurerm_subnet.aks_subnet.id
  node_labels = {
    "role" = "gpu"
  }
  node_taints = [
    "nvidia.com/gpu=present:NoSchedule"
  ]

  depends_on = [
    azurerm_role_assignment.kubernetes_network_contributor
  ]
}

# Log Analytics Workspace
resource "azurerm_log_analytics_workspace" "main" {
  name                = "${var.cluster_name}-logs"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
}

# Role Assignment for VNet
resource "azurerm_role_assignment" "kubernetes_network_contributor" {
  scope                = azurerm_virtual_network.vnet.id
  role_definition_name = "Network Contributor"
  principal_id         = azurerm_kubernetes_cluster.aks.kubelet_identity[0].object_id
}

# User Assigned Identity for LB
resource "azurerm_user_assigned_identity" "lb" {
  name                = "${var.cluster_name}-lb-identity"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
}

resource "azurerm_role_assignment" "lb_reader" {
  scope                = azurerm_resource_group.rg.id
  role_definition_name = "Reader"
  principal_id         = azurerm_user_assigned_identity.lb.principal_id
}

# Kubernetes Provider
provider "kubernetes" {
  host                   = azurerm_kubernetes_cluster.aks.kube_config.0.host
  client_certificate     = base64decode(azurerm_kubernetes_cluster.aks.kube_config.0.client_certificate)
  client_key             = base64decode(azurerm_kubernetes_cluster.aks.kube_config.0.client_key)
  cluster_ca_certificate = base64decode(azurerm_kubernetes_cluster.aks.kube_config.0.cluster_ca_certificate)
}

# Helm Provider
provider "helm" {
  kubernetes {
    host                   = azurerm_kubernetes_cluster.aks.kube_config.0.host
    client_certificate     = base64decode(azurerm_kubernetes_cluster.aks.kube_config.0.client_certificate)
    client_key             = base64decode(azurerm_kubernetes_cluster.aks.kube_config.0.client_key)
    cluster_ca_certificate = base64decode(azurerm_kubernetes_cluster.aks.kube_config.0.cluster_ca_certificate)
  }
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
    name  = "controller.service.externalTrafficPolicy"
    value = "Local"
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
    value = "azure"
  }

  set {
    name  = "azureClientID"
    value = azurerm_kubernetes_cluster.aks.identity_config[0].client_id
  }

  set {
    name  = "azureClientSecret"
    value = "" # Set via azuread app registration in production
  }

  set {
    name  = "azureTenantID"
    value = azurerm_subscription.current.tenant_id
  }

  set {
    name  = "azureResourceGroup"
    value = azurerm_resource_group.rg.name
  }

  set {
    name  = "azureVMType"
    value = "vmss"
  }

  set {
    name  = "cloudConfig"
    value = "/etc/kubernetes/azure.json"
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

# CSI Driver for Azure Disks
resource "helm_release" "azure_disk_csi" {
  name = "csi-azure-disk-controller"

  repository = "https://raw.githubusercontent.com/kubernetes-sigs/azuredisk-csi-driver/master/charts"
  chart      = "azuredisk-csi-driver"
  namespace  = "kube-system"
  version    = "1.30.0"

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
    name  = "faraInference.nodeSelector.agentpool"
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
    azurerm_kubernetes_cluster.aks,
    helm_release.nginx_ingress
  ]
}

# Outputs
output "cluster_endpoint" {
  description = "AKS cluster endpoint"
  value      = azurerm_kubernetes_cluster.aks.kube_config.0.host
}

output "cluster_name" {
  description = "AKS cluster name"
  value      = azurerm_kubernetes_cluster.aks.name
}

output "cluster_id" {
  description = "AKS cluster ID"
  value      = azurerm_kubernetes_cluster.aks.id
}

output "resource_group" {
  description = "Resource group name"
  value      = azurerm_resource_group.rg.name
}

output "vnet_id" {
  description = "VNet ID"
  value      = azurerm_virtual_network.vnet.id
}

output "kubelet_identity_client_id" {
  description = "Kubelet identity client ID"
  value      = azurerm_kubernetes_cluster.aks.kubelet_identity[0].client_id
}

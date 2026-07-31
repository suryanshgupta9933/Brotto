# Azure AKS Variables

variable "azure_location" {
  description = "Azure region"
  type        = string
  default     = "eastus"
}

variable "cluster_name" {
  description = "AKS cluster name"
  type        = string
  default     = "fara15-platform"
}

variable "kubernetes_version" {
  description = "Kubernetes version"
  type        = string
  default     = "1.28"
}

variable "vnet_cidr" {
  description = "VNet CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "aks_subnet_cidrs" {
  description = "AKS subnet CIDRs"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
}

variable "service_cidr" {
  description = "Kubernetes service CIDR"
  type        = string
  default     = "10.1.0.0/16"
}

variable "dns_service_ip" {
  description = "Kubernetes DNS service IP"
  type        = string
  default     = "10.1.0.10"
}

# General node pool
variable "general_vm_size" {
  description = "VM size for general node pool"
  type        = string
  default     = "Standard_D4s_v5"
}

variable "general_node_count" {
  description = "Initial node count for general node pool"
  type        = number
  default     = 2
}

variable "general_node_min_count" {
  description = "Minimum node count for general node pool"
  type        = number
  default     = 2
}

variable "general_node_max_count" {
  description = "Maximum node count for general node pool"
  type        = number
  default     = 10
}

# GPU node pool
variable "gpu_vm_size" {
  description = "VM size for GPU node pool"
  type        = string
  default     = "Standard_NC4as_T4_v3"
}

variable "gpu_node_count" {
  description = "Initial node count for GPU node pool"
  type        = number
  default     = 0
}

variable "gpu_node_min_count" {
  description = "Minimum node count for GPU node pool"
  type        = number
  default     = 0
}

variable "gpu_node_max_count" {
  description = "Maximum node count for GPU node pool"
  type        = number
  default     = 4
}

variable "api_domain" {
  description = "API domain for ingress"
  type        = string
  default     = "api.fara.example.com"
}

variable "artifacts_domain" {
  description = "Artifacts domain for ingress"
  type        = string
  default     = "artifacts.fara.example.com"
}

variable "otel_endpoint" {
  description = "OpenTelemetry collector endpoint"
  type        = string
  default     = ""
}

variable "image_tag" {
  description = "Container image tag"
  type        = string
  default     = "latest"
}

variable "postgres_password" {
  description = "PostgreSQL password"
  type        = string
  sensitive   = true
  default     = ""
}

variable "redis_password" {
  description = "Redis password"
  type        = string
  sensitive   = true
  default     = ""
}

variable "common_tags" {
  description = "Common tags to apply to resources"
  type        = map(string)
  default = {
    Project     = "Fara1.5"
    Environment = "production"
    ManagedBy   = "Terraform"
  }
}

# GCP GKE Variables

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "gcp_region" {
  description = "GCP region"
  type        = string
  default     = "us-west1"
}

variable "cluster_name" {
  description = "GKE cluster name"
  type        = string
  default     = "fara15-platform"
}

variable "kubernetes_version" {
  description = "Kubernetes version"
  type        = string
  default     = "1.28"
}

variable "subnet_cidr" {
  description = "Subnet CIDR block"
  type        = string
  default     = "10.0.0.0/20"
}

variable "master_authorized_cidr" {
  description = "Master authorized CIDR block"
  type        = string
  default     = "0.0.0.0/0"
}

# General node pool
variable "general_machine_type" {
  description = "Machine type for general node pool"
  type        = string
  default     = "n2-standard-4"
}

variable "general_node_count" {
  description = "Initial node count for general node pool"
  type        = number
  default     = 2
}

# GPU node pool
variable "gpu_machine_type" {
  description = "Machine type for GPU node pool"
  type        = string
  default     = "n1-standard-8"
}

variable "gpu_accelerator_type" {
  description = "GPU accelerator type"
  type        = string
  default     = "nvidia-tesla-t4"
}

variable "gpu_count_per_node" {
  description = "Number of GPUs per node"
  type        = number
  default     = 1
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

variable "common_labels" {
  description = "Common labels to apply to resources"
  type        = map(string)
  default = {
    Project     = "Fara1.5"
    Environment = "production"
    ManagedBy   = "Terraform"
  }
}

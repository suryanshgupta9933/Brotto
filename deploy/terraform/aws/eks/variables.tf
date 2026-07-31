# AWS EKS Variables

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-west-2"
}

variable "cluster_name" {
  description = "EKS cluster name"
  type        = string
  default     = "fara15-platform"
}

variable "kubernetes_version" {
  description = "Kubernetes version"
  type        = string
  default     = "1.28"
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "private_subnet_cidrs" {
  description = "Private subnet CIDRs"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
}

variable "public_subnet_cidrs" {
  description = "Public subnet CIDRs"
  type        = list(string)
  default     = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]
}

variable "ssh_key_name" {
  description = "SSH key pair name for nodes"
  type        = string
  default     = ""
}

variable "general_instance_types" {
  description = "Instance types for general node pool"
  type        = list(string)
  default     = ["m6i.xlarge", "m6i.2xlarge"]
}

variable "gpu_instance_types" {
  description = "Instance types for GPU node pool"
  type        = list(string)
  default     = ["g5.xlarge", "g5.2xlarge"]
}

variable "general_node_min_size" {
  description = "Minimum number of nodes in general node pool"
  type        = number
  default     = 2
}

variable "general_node_max_size" {
  description = "Maximum number of nodes in general node pool"
  type        = number
  default     = 10
}

variable "general_node_desired_size" {
  description = "Desired number of nodes in general node pool"
  type        = number
  default     = 2
}

variable "gpu_node_min_size" {
  description = "Minimum number of nodes in GPU node pool"
  type        = number
  default     = 0
}

variable "gpu_node_max_size" {
  description = "Maximum number of nodes in GPU node pool"
  type        = number
  default     = 4
}

variable "gpu_node_desired_size" {
  description = "Desired number of nodes in GPU node pool"
  type        = number
  default     = 0
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

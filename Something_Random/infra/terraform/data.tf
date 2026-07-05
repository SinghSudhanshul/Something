# Data sources for Campusly Terraform

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_eks_cluster_auth" "main" {
  name = aws_eks_cluster.main.name
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

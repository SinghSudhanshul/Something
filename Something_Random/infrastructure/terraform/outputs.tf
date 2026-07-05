# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# NEXUS — Outputs
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# ── VPC ─────────────────────────────────────────────────
output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = module.vpc.public_subnet_ids
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = module.vpc.private_subnet_ids
}

output "database_subnet_ids" {
  description = "Database subnet IDs"
  value       = module.vpc.database_subnet_ids
}

# ── RDS ─────────────────────────────────────────────────
output "rds_endpoint" {
  description = "RDS instance endpoint"
  value       = module.rds.db_instance_endpoint
}

output "rds_port" {
  description = "RDS instance port"
  value       = module.rds.db_instance_port
}

output "rds_secret_arn" {
  description = "ARN of the RDS credentials secret"
  value       = module.secrets.postgres_secret_arn
}

# ── ElastiCache ─────────────────────────────────────────
output "redis_endpoint" {
  description = "Redis primary endpoint"
  value       = module.elasticache.redis_primary_endpoint
}

output "redis_port" {
  description = "Redis port"
  value       = module.elasticache.redis_port
}

# ── S3 ──────────────────────────────────────────────────
output "media_bucket_name" {
  description = "Media S3 bucket name"
  value       = module.s3.media_bucket_name
}

output "cloudfront_domain" {
  description = "CloudFront distribution domain"
  value       = module.s3.cloudfront_domain
}

# ── ECS ─────────────────────────────────────────────────
output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.ecs.cluster_name
}

output "ecr_repository_urls" {
  description = "Map of service name to ECR repository URL"
  value       = module.ecs.ecr_repository_urls
}

output "alb_dns_name" {
  description = "ALB DNS name"
  value       = module.ecs.alb_dns_name
}

# ── Secrets ─────────────────────────────────────────────
output "secret_arns" {
  description = "Map of secret names to ARNs"
  value = {
    postgres = module.secrets.postgres_secret_arn
    redis    = module.secrets.redis_secret_arn
    jwt      = module.secrets.jwt_secret_arn
    razorpay = module.secrets.razorpay_secret_arn
  }
}

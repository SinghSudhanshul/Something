# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# NEXUS — Root Terraform Module
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Orchestrates all infrastructure modules for the NEXUS
# campus super-app. Year 1 MVP — single campus, dev env.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# ── VPC & Networking ────────────────────────────────────
module "vpc" {
  source = "./modules/vpc"

  name_prefix     = local.name_prefix
  vpc_cidr        = var.vpc_cidr
  azs             = local.azs
  environment     = var.environment
  common_tags     = local.common_tags
}

# ── RDS PostgreSQL 15 + PostGIS ─────────────────────────
module "rds" {
  source = "./modules/rds"

  name_prefix             = local.name_prefix
  environment             = var.environment
  common_tags             = local.common_tags
  vpc_id                  = module.vpc.vpc_id
  database_subnet_ids     = module.vpc.database_subnet_ids
  sg_rds_id               = module.vpc.sg_rds_id
  instance_class          = var.db_instance_class
  allocated_storage       = var.db_allocated_storage
  max_allocated_storage   = var.db_max_allocated_storage
}

# ── ElastiCache Redis 7.1 ──────────────────────────────
module "elasticache" {
  source = "./modules/elasticache"

  name_prefix         = local.name_prefix
  environment         = var.environment
  common_tags         = local.common_tags
  database_subnet_ids = module.vpc.database_subnet_ids
  sg_redis_id         = module.vpc.sg_redis_id
  node_type           = var.redis_node_type
}

# ── S3 Buckets + CloudFront ────────────────────────────
module "s3" {
  source = "./modules/s3"

  name_prefix = local.name_prefix
  environment = var.environment
  common_tags = local.common_tags
  account_id  = local.account_id
}

# ── ECS Cluster + ECR + ALB ────────────────────────────
module "ecs" {
  source = "./modules/ecs"

  name_prefix         = local.name_prefix
  environment         = var.environment
  common_tags         = local.common_tags
  vpc_id              = module.vpc.vpc_id
  public_subnet_ids   = module.vpc.public_subnet_ids
  private_subnet_ids  = module.vpc.private_subnet_ids
  sg_alb_id           = module.vpc.sg_alb_id
  sg_ecs_id           = module.vpc.sg_ecs_id
  acm_certificate_arn = var.acm_certificate_arn
  logs_bucket_name    = module.s3.logs_bucket_name
}

# ── AWS Secrets Manager ────────────────────────────────
module "secrets" {
  source = "./modules/secrets"

  name_prefix    = local.name_prefix
  environment    = var.environment
  common_tags    = local.common_tags
  rds_endpoint   = module.rds.db_instance_endpoint
  rds_port       = module.rds.db_instance_port
  rds_db_name    = module.rds.db_instance_name
  rds_username   = module.rds.db_instance_username
  rds_password   = module.rds.db_instance_password
  redis_endpoint = module.elasticache.redis_primary_endpoint
  redis_port     = module.elasticache.redis_port
  redis_auth     = module.elasticache.redis_auth_token
}

# ── IAM Roles (Least Privilege) ────────────────────────
module "iam" {
  source = "./modules/iam"

  name_prefix         = local.name_prefix
  environment         = var.environment
  common_tags         = local.common_tags
  account_id          = local.account_id
  region              = local.region
  ecr_repository_arns = module.ecs.ecr_repository_arns
  secret_arns         = module.secrets.all_secret_arns
  media_bucket_arn    = module.s3.media_bucket_arn
  documents_bucket_arn = module.s3.documents_bucket_arn
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# NEXUS — VPC Module
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 2 AZs, 3 subnet tiers, single NAT (Year 1 cost saving),
# VPC flow logs, and 5 security groups.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.8.1"

  name = "${var.name_prefix}-vpc"
  cidr = var.vpc_cidr
  azs  = var.azs

  # Subnet CIDRs
  public_subnets   = ["10.0.1.0/24", "10.0.2.0/24"]
  private_subnets  = ["10.0.11.0/24", "10.0.12.0/24"]
  database_subnets = ["10.0.21.0/24", "10.0.22.0/24"]

  # NAT Gateway — single for Year 1 cost saving
  enable_nat_gateway = true
  single_nat_gateway = true

  # DNS
  enable_dns_hostnames = true
  enable_dns_support   = true

  # Database subnets — no internet route
  create_database_subnet_group       = true
  create_database_subnet_route_table = true

  # VPC Flow Logs
  enable_flow_log                                 = true
  create_flow_log_cloudwatch_iam_role             = true
  create_flow_log_cloudwatch_log_group            = true
  flow_log_cloudwatch_log_group_retention_in_days = 14
  flow_log_max_aggregation_interval               = 60

  # Tags
  tags = var.common_tags

  public_subnet_tags = {
    Tier = "public"
  }

  private_subnet_tags = {
    Tier = "private"
  }

  database_subnet_tags = {
    Tier = "database"
  }
}

# ── Security Group: ALB ─────────────────────────────────
resource "aws_security_group" "alb" {
  name_prefix = "${var.name_prefix}-sg-alb-"
  description = "Security group for Application Load Balancer"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description = "HTTP from internet"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS from internet"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description     = "To ECS tasks"
    from_port       = 3000
    to_port         = 3100
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }

  egress {
    description     = "To Kong proxy"
    from_port       = 8000
    to_port         = 8001
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }

  tags = merge(var.common_tags, { Name = "${var.name_prefix}-sg-alb" })

  lifecycle {
    create_before_destroy = true
  }
}

# ── Security Group: ECS Tasks ───────────────────────────
resource "aws_security_group" "ecs" {
  name_prefix = "${var.name_prefix}-sg-ecs-"
  description = "Security group for ECS Fargate tasks"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "From ALB"
    from_port       = 3000
    to_port         = 3100
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  ingress {
    description     = "Kong proxy from ALB"
    from_port       = 8000
    to_port         = 8001
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "HTTPS to AWS APIs"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description     = "To RDS"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.rds.id]
  }

  egress {
    description     = "To Redis"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.redis.id]
  }

  tags = merge(var.common_tags, { Name = "${var.name_prefix}-sg-ecs" })

  lifecycle {
    create_before_destroy = true
  }
}

# ── Security Group: RDS ─────────────────────────────────
resource "aws_security_group" "rds" {
  name_prefix = "${var.name_prefix}-sg-rds-"
  description = "Security group for RDS PostgreSQL — ECS access only"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "PostgreSQL from ECS"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }

  tags = merge(var.common_tags, { Name = "${var.name_prefix}-sg-rds" })

  lifecycle {
    create_before_destroy = true
  }
}

# ── Security Group: Redis ───────────────────────────────
resource "aws_security_group" "redis" {
  name_prefix = "${var.name_prefix}-sg-redis-"
  description = "Security group for ElastiCache Redis — ECS access only"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "Redis from ECS"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }

  tags = merge(var.common_tags, { Name = "${var.name_prefix}-sg-redis" })

  lifecycle {
    create_before_destroy = true
  }
}

# ── Security Group: Kafka (future MSK) ──────────────────
resource "aws_security_group" "kafka" {
  name_prefix = "${var.name_prefix}-sg-kafka-"
  description = "Security group for Kafka/MSK — ECS access only"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "Kafka from ECS"
    from_port       = 9092
    to_port         = 9092
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }

  tags = merge(var.common_tags, { Name = "${var.name_prefix}-sg-kafka" })

  lifecycle {
    create_before_destroy = true
  }
}

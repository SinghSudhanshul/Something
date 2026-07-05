# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# NEXUS — ECS Module (Fargate Cluster + ECR + ALB)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

locals {
  services = [
    "auth", "bazaar", "wallet", "rides", "feast",
    "swift", "skills", "pulse", "trust",
    "notifications", "search", "analytics"
  ]
}

# ── ECS Cluster ─────────────────────────────────────────
resource "aws_ecs_cluster" "nexus" {
  name = "${var.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = merge(var.common_tags, { Name = "${var.name_prefix}-cluster" })
}

resource "aws_ecs_cluster_capacity_providers" "nexus" {
  cluster_name = aws_ecs_cluster.nexus.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    base              = 1
    weight            = 30
    capacity_provider = "FARGATE"
  }

  default_capacity_provider_strategy {
    weight            = 70
    capacity_provider = "FARGATE_SPOT"
  }
}

# ── ECR Repositories ───────────────────────────────────
resource "aws_ecr_repository" "services" {
  for_each = toset(local.services)

  name                 = "nexus-${each.key}"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = merge(var.common_tags, { Service = each.key })
}

resource "aws_ecr_lifecycle_policy" "services" {
  for_each = aws_ecr_repository.services

  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep last 10 tagged images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["v", "latest", "main"]
          countType     = "imageCountMoreThan"
          countNumber   = 10
        }
        action = { type = "expire" }
      }
    ]
  })
}

# ── ALB (Application Load Balancer) ─────────────────────
resource "aws_lb" "nexus" {
  name               = "${var.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.sg_alb_id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection = true

  access_logs {
    bucket  = var.logs_bucket_name
    prefix  = "alb-logs"
    enabled = true
  }

  tags = merge(var.common_tags, { Name = "${var.name_prefix}-alb" })
}

# ── Target Group for Kong ───────────────────────────────
resource "aws_lb_target_group" "kong" {
  name        = "${var.name_prefix}-kong-tg"
  port        = 8000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/health"
    port                = "traffic-port"
    healthy_threshold   = 3
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    matcher             = "200"
  }

  tags = merge(var.common_tags, { Name = "${var.name_prefix}-kong-tg" })
}

# ── ALB Listeners ───────────────────────────────────────
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.nexus.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }

  tags = var.common_tags
}

resource "aws_lb_listener" "https" {
  count = var.acm_certificate_arn != "" ? 1 : 0

  load_balancer_arn = aws_lb.nexus.arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.kong.arn
  }

  tags = var.common_tags
}

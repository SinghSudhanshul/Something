# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# NEXUS — IAM Module (Least-Privilege Roles)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# ── ECS Task Execution Role (Shared) ───────────────────
resource "aws_iam_role" "ecs_execution" {
  name = "${var.name_prefix}-ecs-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = { Service = "ecs-tasks.amazonaws.com" }
      }
    ]
  })

  tags = var.common_tags
}

resource "aws_iam_role_policy_attachment" "ecs_execution_base" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "${var.name_prefix}-ecs-execution-secrets"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowSecretsAccess"
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = var.secret_arns
      },
      {
        Sid    = "AllowECRAccess"
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage"
        ]
        Resource = var.ecr_repository_arns
      },
      {
        Sid      = "AllowECRAuth"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      }
    ]
  })
}

# ── Auth Service Task Role ─────────────────────────────
resource "aws_iam_role" "auth_task" {
  name = "${var.name_prefix}-auth-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action    = "sts:AssumeRole"
        Effect    = "Allow"
        Principal = { Service = "ecs-tasks.amazonaws.com" }
      }
    ]
  })

  tags = merge(var.common_tags, { Service = "auth" })
}

resource "aws_iam_role_policy" "auth_task" {
  name = "${var.name_prefix}-auth-task-policy"
  role = aws_iam_role.auth_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowSES"
        Effect = "Allow"
        Action = ["ses:SendEmail", "ses:SendRawEmail"]
        Resource = "arn:aws:ses:${var.region}:${var.account_id}:identity/*"
      },
      {
        Sid    = "AllowDocumentsBucket"
        Effect = "Allow"
        Action = ["s3:PutObject"]
        Resource = "${var.documents_bucket_arn}/*"
      }
    ]
  })
}

# ── Bazaar Service Task Role ───────────────────────────
resource "aws_iam_role" "bazaar_task" {
  name = "${var.name_prefix}-bazaar-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action    = "sts:AssumeRole"
        Effect    = "Allow"
        Principal = { Service = "ecs-tasks.amazonaws.com" }
      }
    ]
  })

  tags = merge(var.common_tags, { Service = "bazaar" })
}

resource "aws_iam_role_policy" "bazaar_task" {
  name = "${var.name_prefix}-bazaar-task-policy"
  role = aws_iam_role.bazaar_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowMediaBucket"
        Effect = "Allow"
        Action = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
        Resource = "${var.media_bucket_arn}/*"
      },
      {
        Sid    = "AllowRekognition"
        Effect = "Allow"
        Action = [
          "rekognition:DetectLabels",
          "rekognition:DetectModerationLabels"
        ]
        Resource = "*"
      }
    ]
  })
}

# ── Wallet Service Task Role ───────────────────────────
resource "aws_iam_role" "wallet_task" {
  name = "${var.name_prefix}-wallet-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action    = "sts:AssumeRole"
        Effect    = "Allow"
        Principal = { Service = "ecs-tasks.amazonaws.com" }
      }
    ]
  })

  tags = merge(var.common_tags, { Service = "wallet" })
}

# Wallet gets NO additional AWS permissions — DB/Redis only via secrets

# ── Notifications Service Task Role ────────────────────
resource "aws_iam_role" "notifications_task" {
  name = "${var.name_prefix}-notifications-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action    = "sts:AssumeRole"
        Effect    = "Allow"
        Principal = { Service = "ecs-tasks.amazonaws.com" }
      }
    ]
  })

  tags = merge(var.common_tags, { Service = "notifications" })
}

resource "aws_iam_role_policy" "notifications_task" {
  name = "${var.name_prefix}-notifications-task-policy"
  role = aws_iam_role.notifications_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowSES"
        Effect = "Allow"
        Action = ["ses:SendEmail", "ses:SendRawEmail", "ses:SendTemplatedEmail"]
        Resource = "arn:aws:ses:${var.region}:${var.account_id}:identity/*"
      },
      {
        Sid    = "AllowSNSPublish"
        Effect = "Allow"
        Action = ["sns:Publish"]
        Resource = "arn:aws:sns:${var.region}:${var.account_id}:nexus-*"
      }
    ]
  })
}

# ── Generic Service Task Role (services with no AWS perms) ──
resource "aws_iam_role" "generic_task" {
  name = "${var.name_prefix}-generic-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action    = "sts:AssumeRole"
        Effect    = "Allow"
        Principal = { Service = "ecs-tasks.amazonaws.com" }
      }
    ]
  })

  tags = var.common_tags
}

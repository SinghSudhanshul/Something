# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# NEXUS — Secrets Manager Module
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# ── Random passwords for JWT secrets ────────────────────
resource "random_password" "jwt_access" {
  length  = 64
  special = true
}

resource "random_password" "jwt_refresh" {
  length  = 64
  special = true
}

# ── PostgreSQL Credentials ──────────────────────────────
resource "aws_secretsmanager_secret" "postgres" {
  name                    = "nexus/${var.environment}/postgres"
  description             = "NEXUS PostgreSQL database credentials"
  recovery_window_in_days = 7
  tags                    = var.common_tags
}

resource "aws_secretsmanager_secret_version" "postgres" {
  secret_id = aws_secretsmanager_secret.postgres.id
  secret_string = jsonencode({
    host     = var.rds_endpoint
    port     = var.rds_port
    dbname   = var.rds_db_name
    username = var.rds_username
    password = var.rds_password
  })
}

# ── Redis Credentials ──────────────────────────────────
resource "aws_secretsmanager_secret" "redis" {
  name                    = "nexus/${var.environment}/redis"
  description             = "NEXUS Redis auth credentials"
  recovery_window_in_days = 7
  tags                    = var.common_tags
}

resource "aws_secretsmanager_secret_version" "redis" {
  secret_id = aws_secretsmanager_secret.redis.id
  secret_string = jsonencode({
    host       = var.redis_endpoint
    port       = var.redis_port
    auth_token = var.redis_auth
  })
}

# ── JWT Secrets ─────────────────────────────────────────
resource "aws_secretsmanager_secret" "jwt" {
  name                    = "nexus/${var.environment}/jwt"
  description             = "NEXUS JWT signing secrets"
  recovery_window_in_days = 7
  tags                    = var.common_tags
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id = aws_secretsmanager_secret.jwt.id
  secret_string = jsonencode({
    access_secret  = random_password.jwt_access.result
    refresh_secret = random_password.jwt_refresh.result
  })
}

# ── Razorpay Credentials ───────────────────────────────
resource "aws_secretsmanager_secret" "razorpay" {
  name                    = "nexus/${var.environment}/razorpay"
  description             = "Razorpay payment gateway credentials"
  recovery_window_in_days = 7
  tags                    = var.common_tags
}

resource "aws_secretsmanager_secret_version" "razorpay" {
  secret_id = aws_secretsmanager_secret.razorpay.id
  secret_string = jsonencode({
    key_id         = "rzp_test_PLACEHOLDER"
    key_secret     = "PLACEHOLDER_SECRET"
    webhook_secret = "PLACEHOLDER_WEBHOOK_SECRET"
  })
}

# ── AWS SES Config ──────────────────────────────────────
resource "aws_secretsmanager_secret" "ses" {
  name                    = "nexus/${var.environment}/aws-ses"
  description             = "AWS SES email configuration"
  recovery_window_in_days = 7
  tags                    = var.common_tags
}

resource "aws_secretsmanager_secret_version" "ses" {
  secret_id = aws_secretsmanager_secret.ses.id
  secret_string = jsonencode({
    from_email = "no-reply@nexus.app"
  })
}

# ── FCM (Firebase Cloud Messaging) ─────────────────────
resource "aws_secretsmanager_secret" "fcm" {
  name                    = "nexus/${var.environment}/fcm"
  description             = "Firebase Cloud Messaging service account"
  recovery_window_in_days = 7
  tags                    = var.common_tags
}

resource "aws_secretsmanager_secret_version" "fcm" {
  secret_id = aws_secretsmanager_secret.fcm.id
  secret_string = jsonencode({
    service_account_json = "{}"
  })
}

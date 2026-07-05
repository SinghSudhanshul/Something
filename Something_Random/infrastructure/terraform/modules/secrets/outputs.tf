output "postgres_secret_arn" {
  value = aws_secretsmanager_secret.postgres.arn
}

output "redis_secret_arn" {
  value = aws_secretsmanager_secret.redis.arn
}

output "jwt_secret_arn" {
  value = aws_secretsmanager_secret.jwt.arn
}

output "razorpay_secret_arn" {
  value = aws_secretsmanager_secret.razorpay.arn
}

output "ses_secret_arn" {
  value = aws_secretsmanager_secret.ses.arn
}

output "fcm_secret_arn" {
  value = aws_secretsmanager_secret.fcm.arn
}

output "all_secret_arns" {
  description = "List of all secret ARNs for IAM policy"
  value = [
    aws_secretsmanager_secret.postgres.arn,
    aws_secretsmanager_secret.redis.arn,
    aws_secretsmanager_secret.jwt.arn,
    aws_secretsmanager_secret.razorpay.arn,
    aws_secretsmanager_secret.ses.arn,
    aws_secretsmanager_secret.fcm.arn,
  ]
}

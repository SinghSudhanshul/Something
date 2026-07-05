output "redis_primary_endpoint" {
  value = aws_elasticache_replication_group.nexus.primary_endpoint_address
}

output "redis_port" {
  value = aws_elasticache_replication_group.nexus.port
}

output "redis_auth_token" {
  value     = random_password.redis.result
  sensitive = true
}

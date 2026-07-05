# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# NEXUS — ElastiCache Module (Redis 7.1)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

resource "random_password" "redis" {
  length           = 32
  special          = false # Redis auth tokens don't support all special chars
}

resource "aws_elasticache_parameter_group" "nexus" {
  name   = "${var.name_prefix}-redis71"
  family = "redis7"

  parameter {
    name  = "maxmemory-policy"
    value = "allkeys-lru"
  }

  tags = var.common_tags
}

resource "aws_elasticache_subnet_group" "nexus" {
  name       = "${var.name_prefix}-redis-subnet"
  subnet_ids = var.database_subnet_ids

  tags = var.common_tags
}

resource "aws_elasticache_replication_group" "nexus" {
  replication_group_id = "${var.name_prefix}-redis"
  description          = "NEXUS Redis — sessions, cache, pub/sub, queues"

  node_type            = var.node_type
  num_cache_clusters   = 1 # No replicas in Year 1
  engine_version       = "7.1"
  port                 = 6379
  parameter_group_name = aws_elasticache_parameter_group.nexus.name
  subnet_group_name    = aws_elasticache_subnet_group.nexus.name
  security_group_ids   = [var.sg_redis_id]

  # Encryption
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.redis.result

  # Year 1 — single node, no failover
  automatic_failover_enabled = false
  multi_az_enabled           = false

  # Maintenance
  maintenance_window       = "Sun:22:00-Sun:23:00"
  snapshot_retention_limit  = 3
  snapshot_window           = "21:00-22:00"

  tags = merge(var.common_tags, { Name = "${var.name_prefix}-redis" })
}

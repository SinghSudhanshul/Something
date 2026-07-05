output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = module.vpc.public_subnets
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = module.vpc.private_subnets
}

output "database_subnet_ids" {
  description = "Database subnet IDs"
  value       = module.vpc.database_subnets
}

output "database_subnet_group_name" {
  description = "Database subnet group name"
  value       = module.vpc.database_subnet_group_name
}

output "sg_alb_id" {
  description = "ALB security group ID"
  value       = aws_security_group.alb.id
}

output "sg_ecs_id" {
  description = "ECS tasks security group ID"
  value       = aws_security_group.ecs.id
}

output "sg_rds_id" {
  description = "RDS security group ID"
  value       = aws_security_group.rds.id
}

output "sg_redis_id" {
  description = "Redis security group ID"
  value       = aws_security_group.redis.id
}

output "sg_kafka_id" {
  description = "Kafka security group ID"
  value       = aws_security_group.kafka.id
}

output "cluster_name" {
  value = aws_ecs_cluster.nexus.name
}

output "cluster_arn" {
  value = aws_ecs_cluster.nexus.arn
}

output "ecr_repository_urls" {
  value = { for k, v in aws_ecr_repository.services : k => v.repository_url }
}

output "ecr_repository_arns" {
  value = [for v in aws_ecr_repository.services : v.arn]
}

output "alb_dns_name" {
  value = aws_lb.nexus.dns_name
}

output "alb_zone_id" {
  value = aws_lb.nexus.zone_id
}

output "alb_arn" {
  value = aws_lb.nexus.arn
}

output "kong_target_group_arn" {
  value = aws_lb_target_group.kong.arn
}

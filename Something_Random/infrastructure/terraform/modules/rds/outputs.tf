output "db_instance_endpoint" {
  value = aws_db_instance.nexus.endpoint
}

output "db_instance_port" {
  value = aws_db_instance.nexus.port
}

output "db_instance_name" {
  value = aws_db_instance.nexus.db_name
}

output "db_instance_username" {
  value     = aws_db_instance.nexus.username
  sensitive = true
}

output "db_instance_password" {
  value     = random_password.rds.result
  sensitive = true
}

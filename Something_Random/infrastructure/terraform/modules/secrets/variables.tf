variable "name_prefix" { type = string }
variable "environment" { type = string }
variable "common_tags" { type = map(string) }
variable "rds_endpoint" { type = string }
variable "rds_port" { type = number }
variable "rds_db_name" { type = string }
variable "rds_username" {
  type      = string
  sensitive = true
}
variable "rds_password" {
  type      = string
  sensitive = true
}
variable "redis_endpoint" { type = string }
variable "redis_port" { type = number }
variable "redis_auth" {
  type      = string
  sensitive = true
}

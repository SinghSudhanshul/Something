variable "name_prefix" { type = string }
variable "environment" { type = string }
variable "common_tags" { type = map(string) }
variable "database_subnet_ids" { type = list(string) }
variable "sg_redis_id" { type = string }
variable "node_type" { type = string }

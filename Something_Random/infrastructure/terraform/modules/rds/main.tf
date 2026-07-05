# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# NEXUS — RDS Module (PostgreSQL 15 + PostGIS)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

resource "random_password" "rds" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_db_parameter_group" "nexus" {
  name_prefix = "${var.name_prefix}-pg15-"
  family      = "postgres15"
  description = "NEXUS PostgreSQL 15 parameter group"

  parameter {
    name  = "shared_preload_libraries"
    value = "pg_stat_statements,pg_trgm"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  parameter {
    name  = "max_connections"
    value = "200"
  }

  tags = var.common_tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_subnet_group" "nexus" {
  name_prefix = "${var.name_prefix}-"
  description = "NEXUS database subnet group"
  subnet_ids  = var.database_subnet_ids

  tags = merge(var.common_tags, { Name = "${var.name_prefix}-db-subnet-group" })
}

resource "aws_db_instance" "nexus" {
  identifier = "${var.name_prefix}-postgres"

  engine         = "postgres"
  engine_version = "15.7"
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_encrypted     = true
  storage_type          = "gp3"

  db_name  = "nexus"
  username = "nexus_admin"
  password = random_password.rds.result
  port     = 5432

  multi_az               = false # Year 1 cost saving
  db_subnet_group_name   = aws_db_subnet_group.nexus.name
  vpc_security_group_ids = [var.sg_rds_id]
  parameter_group_name   = aws_db_parameter_group.nexus.name
  publicly_accessible    = false

  # Backup
  backup_retention_period = 7
  backup_window           = "19:00-20:00"
  maintenance_window      = "Sun:20:00-Sun:21:00"

  # Protection
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name_prefix}-postgres-final"

  # Monitoring
  performance_insights_enabled          = true
  performance_insights_retention_period = 7
  enabled_cloudwatch_logs_exports       = ["postgresql"]

  tags = merge(var.common_tags, { Name = "${var.name_prefix}-postgres" })
}

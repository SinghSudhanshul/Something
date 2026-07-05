# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# NEXUS — Common Locals
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

locals {
  name_prefix = "nexus-${var.environment}"
  account_id  = data.aws_caller_identity.current.account_id
  region      = data.aws_region.current.name

  common_tags = {
    Project     = "NEXUS"
    Environment = var.environment
    ManagedBy   = "Terraform"
    CostCenter  = "engineering"
    Owner       = "platform-team"
  }

  azs = ["${var.aws_region}a", "${var.aws_region}b"]
}

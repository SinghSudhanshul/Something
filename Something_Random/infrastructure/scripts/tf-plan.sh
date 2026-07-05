#!/usr/bin/env bash
set -euo pipefail
ENV="${1:-dev}"
cd "$(dirname "$0")/../terraform"
echo "Planning Terraform for environment: ${ENV}"
terraform plan -var-file="${ENV}.tfvars" -out="tfplan-${ENV}"
echo "✓ Plan saved to tfplan-${ENV}"

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../terraform"
echo "Initializing Terraform..."
terraform init -reconfigure
echo "✓ Terraform initialized"

#!/usr/bin/env bash
set -euo pipefail
ENV="${1:-dev}"
cd "$(dirname "$0")/../terraform"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  NEXUS — Terraform Apply (${ENV})"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

PLAN_FILE="tfplan-${ENV}"
if [ ! -f "${PLAN_FILE}" ]; then
  echo "No plan file found. Run tf-plan.sh first."
  exit 1
fi

echo "Applying plan: ${PLAN_FILE}"
terraform apply "${PLAN_FILE}"
echo "✓ Terraform apply complete"

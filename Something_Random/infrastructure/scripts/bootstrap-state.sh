#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# NEXUS — Bootstrap Terraform State Backend
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Creates the S3 bucket and DynamoDB table for Terraform
# state management. Safe to run multiple times (idempotent).
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -euo pipefail

REGION="${AWS_REGION:-ap-south-1}"
BUCKET="nexus-terraform-state-${REGION}"
TABLE="nexus-terraform-locks"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  NEXUS — Terraform State Bootstrap"
echo "  Region: ${REGION}"
echo "  Bucket: ${BUCKET}"
echo "  Table:  ${TABLE}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Create S3 Bucket ────────────────────────────────────
echo ""
echo "Creating S3 bucket..."
if aws s3api head-bucket --bucket "${BUCKET}" 2>/dev/null; then
  echo "  ✓ Bucket already exists: ${BUCKET}"
else
  aws s3api create-bucket \
    --bucket "${BUCKET}" \
    --region "${REGION}" \
    --create-bucket-configuration LocationConstraint="${REGION}"
  echo "  ✓ Bucket created: ${BUCKET}"
fi

# Enable versioning
echo "Enabling versioning..."
aws s3api put-bucket-versioning \
  --bucket "${BUCKET}" \
  --versioning-configuration Status=Enabled
echo "  ✓ Versioning enabled"

# Enable encryption
echo "Enabling encryption..."
aws s3api put-bucket-encryption \
  --bucket "${BUCKET}" \
  --server-side-encryption-configuration '{
    "Rules": [
      {
        "ApplyServerSideEncryptionByDefault": {
          "SSEAlgorithm": "AES256"
        }
      }
    ]
  }'
echo "  ✓ Encryption enabled (AES256)"

# Block public access
echo "Blocking public access..."
aws s3api put-public-access-block \
  --bucket "${BUCKET}" \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
echo "  ✓ Public access blocked"

# ── Create DynamoDB Table ───────────────────────────────
echo ""
echo "Creating DynamoDB lock table..."
if aws dynamodb describe-table --table-name "${TABLE}" --region "${REGION}" >/dev/null 2>&1; then
  echo "  ✓ Table already exists: ${TABLE}"
else
  aws dynamodb create-table \
    --table-name "${TABLE}" \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region "${REGION}" \
    --tags Key=Project,Value=NEXUS Key=ManagedBy,Value=Terraform
  echo "  ✓ Table created: ${TABLE}"

  echo "  Waiting for table to become active..."
  aws dynamodb wait table-exists --table-name "${TABLE}" --region "${REGION}"
  echo "  ✓ Table is active"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✓ Terraform state backend is ready!"
echo "  Run: cd infrastructure/terraform && terraform init"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

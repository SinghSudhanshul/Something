# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# NEXUS — Root Makefile
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

.PHONY: help install dev build test lint type-check \
        docker-up docker-down docker-logs \
        tf-init tf-plan-dev tf-apply-dev tf-destroy-dev tf-fmt tf-validate

# ── Node.js ─────────────────────────────────────────────
install:
	pnpm install

dev:
	pnpm dev

build:
	pnpm build

test:
	pnpm test

lint:
	pnpm lint

type-check:
	pnpm type-check

# ── Docker ──────────────────────────────────────────────
docker-up:
	docker compose -f infrastructure/docker-compose.yml up -d

docker-down:
	docker compose -f infrastructure/docker-compose.yml down

docker-logs:
	docker compose -f infrastructure/docker-compose.yml logs -f

# ── Terraform ───────────────────────────────────────────
TF_DIR := infrastructure/terraform

tf-init:
	terraform -chdir=$(TF_DIR) init -reconfigure

tf-plan-dev:
	terraform -chdir=$(TF_DIR) plan -var-file=dev.tfvars -out=tfplan-dev

tf-apply-dev:
	terraform -chdir=$(TF_DIR) apply tfplan-dev

tf-destroy-dev:
	terraform -chdir=$(TF_DIR) destroy -var-file=dev.tfvars

tf-fmt:
	terraform -chdir=$(TF_DIR) fmt -recursive

tf-validate:
	terraform -chdir=$(TF_DIR) validate

# ── Help ────────────────────────────────────────────────
help:
	@echo "NEXUS Makefile Targets:"
	@echo "  install       — Install all dependencies"
	@echo "  dev           — Start all services in dev mode"
	@echo "  build         — Build all packages and services"
	@echo "  test          — Run all tests"
	@echo "  lint          — Run linting"
	@echo "  type-check    — TypeScript type checking"
	@echo "  docker-up     — Start Docker infrastructure"
	@echo "  docker-down   — Stop Docker infrastructure"
	@echo "  docker-logs   — Follow Docker logs"
	@echo "  tf-init       — Initialize Terraform"
	@echo "  tf-plan-dev   — Plan Terraform (dev)"
	@echo "  tf-apply-dev  — Apply Terraform (dev)"
	@echo "  tf-fmt        — Format Terraform files"
	@echo "  tf-validate   — Validate Terraform config"

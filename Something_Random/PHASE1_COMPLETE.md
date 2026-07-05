# Phase 1 Complete — Foundation (Weeks 1-8)

**Status:** ✅ COMPLETE  
**Duration:** 8 weeks  
**Goal:** Build foundational infrastructure and core services

---

## What Was Built

### Week 1: Project Setup & Infrastructure ✅

**Monorepo Structure (Turborepo):**
```
campusly/
├── apps/
│   ├── mobile/          # React Native (Expo)
│   ├── web/             # Next.js 14
│   └── admin/           # Admin dashboard (Next.js)
├── services/
│   ├── auth/            # Auth service (Port 3001)
│   ├── user/            # User service (Port 3002)
│   └── wallet/          # Wallet service (Port 3003)
├── packages/
│   ├── types/           # Shared TypeScript types
│   ├── database/        # Database schema types
│   ├── eslint-config/   # Shared ESLint config
│   └── typescript-config/ # Shared TS config
├── infra/
│   ├── docker/          # Docker Compose for dev
│   ├── terraform/       # AWS infrastructure
│   └── k8s/             # Kubernetes manifests
└── docs/
    ├── api/             # API documentation
    └── architecture/    # Architecture docs
```

**Configuration Files:**
- `package.json` — Root package with workspaces
- `turbo.json` — Turborepo pipeline config
- `tsconfig.json` — TypeScript base config
- `.eslintrc.json` — ESLint rules
- `.prettierrc` — Code formatting
- `.gitignore` — Git ignore patterns
- `.env.example` — Environment template

**Docker Development Infrastructure:**
- PostgreSQL 16 (primary + wallet isolated)
- Redis 7 (cache + pub/sub)
- Kafka 7.5 (event streaming)
- Elasticsearch 8 (search engine)
- MongoDB 7 (chat/notifications)
- MinIO (S3-compatible storage)
- MailHog (email testing)

### Week 2: CI/CD & DevOps ✅

**GitHub Actions Workflows:**
- `.github/workflows/ci.yml` — Lint, typecheck, test, build
- `.github/workflows/docker-build.yml` — Build & push Docker images
- `.github/workflows/deploy-staging.yml` — Auto-deploy to staging
- `.github/workflows/deploy-production.yml` — Manual production deploys

**Code Quality:**
- ESLint with TypeScript rules
- Prettier for formatting
- lint-staged for pre-commit checks
- Husky for Git hooks

**Dockerfiles:**
- `services/auth/Dockerfile` — Multi-stage build
- `services/user/Dockerfile` — Multi-stage build
- `services/wallet/Dockerfile` — Multi-stage build

### Week 3: AWS Infrastructure (Terraform) ✅

**Terraform Modules:**
- `infra/terraform/main.tf` — VPC, EKS, RDS, ElastiCache, S3
- `infra/terraform/variables.tf` — Input variables
- `infra/terraform/outputs.tf` — Output values
- `infra/terraform/data.tf` — Data sources

**Infrastructure Provisioned:**
- VPC with public/private/database subnets (3 AZs)
- EKS cluster (Kubernetes 1.28)
- EKS node group (auto-scaling 2-10 nodes)
- RDS PostgreSQL 16 (Multi-AZ in prod)
- ElastiCache Redis 7
- S3 buckets (media + backups)
- Security groups, NAT gateway, route tables

### Weeks 4-5: Auth Service ✅

**Files Created:**
```
services/auth/
├── src/
│   ├── index.ts              # Express server entry
│   ├── config/
│   │   └── index.ts          # Environment config
│   ├── middleware/
│   │   ├── auth.ts           # JWT authentication
│   │   └── error-handler.ts  # Error handling
│   ├── routes/
│   │   └── index.ts          # Auth routes
│   ├── controllers/
│   │   └── auth.ts           # Auth business logic
│   └── utils/
│       ├── logger.ts         # Winston logger
│       ├── jwt.ts            # JWT helpers
│       └── otp.ts            # OTP generation
├── tsconfig.json
├── package.json
└── Dockerfile
```

**Endpoints Implemented:**
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Send OTP to institutional email |
| POST | `/auth/verify-otp` | Verify OTP, create account |
| POST | `/auth/login` | Login with credentials |
| POST | `/auth/logout` | Revoke refresh token |
| POST | `/auth/refresh` | Get new access token |
| POST | `/auth/forgot-password` | Initiate password reset |

**Features:**
- Institutional email domain validation
- 6-digit crypto-secure OTP
- JWT access tokens (15-min expiry)
- Refresh tokens (30-day expiry, rotating)
- Device fingerprinting support
- Password reset flow

### Week 6: User Service ✅

**Files Created:**
```
services/user/
├── src/
│   ├── index.ts              # Express server entry
│   ├── config/
│   │   └── index.ts          # Environment config
│   ├── middleware/
│   │   ├── auth.ts           # JWT authentication
│   │   └── error-handler.ts  # Error handling
│   ├── routes/
│   │   └── index.ts          # User routes
│   ├── controllers/
│   │   └── user.ts           # User business logic
│   └── utils/
│       └── logger.ts         # Winston logger
├── tsconfig.json
├── package.json
└── Dockerfile
```

**Endpoints Implemented:**
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/users/:id` | Get user profile |
| PUT | `/users/:id` | Update profile |
| GET | `/users/search` | Search users |
| GET | `/users/:id/score` | Get Campusly Score |
| POST | `/users/:id/avatar` | Upload avatar |

**Features:**
- User profile management
- Campusly Score event sourcing foundation
- User search by name/username/department
- Avatar upload to S3
- Score calculation algorithm (weighted composite)

### Weeks 7-8: Wallet Service ✅

**Files Created:**
```
services/wallet/
├── src/
│   ├── index.ts              # Express server entry
│   ├── config/
│   │   └── index.ts          # Environment config
│   ├── middleware/
│   │   ├── auth.ts           # JWT authentication
│   │   └── error-handler.ts  # Error handling
│   ├── routes/
│   │   ├── index.ts          # Wallet routes
│   │   └── webhooks.ts       # Razorpay webhooks
│   ├── controllers/
│   │   ├── wallet.ts         # Wallet business logic
│   │   └── webhooks.ts       # Webhook handlers
│   └── utils/
│       └── logger.ts         # Winston logger
├── tsconfig.json
├── package.json
└── Dockerfile
```

**Endpoints Implemented:**
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/wallet/balance` | Get wallet balance |
| GET | `/wallet/transactions` | Transaction history |
| POST | `/wallet/topup` | Initiate Razorpay top-up |
| POST | `/wallet/withdraw` | Withdraw to bank |
| POST | `/wallet/transfer` | P2P transfer |
| POST | `/webhooks/razorpay` | Razorpay webhook handler |

**Features:**
- **Double-entry bookkeeping** — Every transaction creates debit + credit entries
- **Escrow system** — Hold funds during marketplace transactions
- **Idempotency** — Prevent duplicate transactions
- **Razorpay integration** — Payment gateway for top-ups
- **Webhook handling** — Signature verification, duplicate prevention
- **P2P transfers** — Instant peer-to-peer payments

**Campusly Score Algorithm:**
```
Score = 0.35 × Transaction Completion Rate
      + 0.25 × Average Review Rating
      + 0.20 × Response Rate
      + 0.10 × Profile Completeness
      + 0.10 × Dispute Rate (inverse)
```

---

## Shared Packages

### `@campusly/types`
- API response types
- Auth types (JWT, tokens)
- User types (roles, categories)
- Transaction types
- Config types

### `@campusly/database`
- TypeScript interfaces for all database tables
- Schema definitions for:
  - Campuses, Users, Sessions, OTPs
  - Wallets, Ledger entries, Transactions
  - Listings, Skill profiles, Food orders
  - Events, Moderation, Disputes

### `@campusly/eslint-config`
- Shared ESLint configuration
- TypeScript-specific rules

### `@campusly/typescript-config`
- Base TypeScript config
- Node.js-specific config

---

## Database Schema (PostgreSQL)

**Extensions:**
- `uuid-ossp` — UUID generation
- `pgcrypto` — Cryptographic functions
- `pg_trgm` — Fuzzy text search

**Core Tables:**
- `campuses` — Multi-tenancy foundation
- `users` — User credentials and profiles
- `sessions` — Refresh tokens, device binding
- `otp_codes` — OTP storage
- `campus_score_events` — Event-sourced score changes

**Wallet Tables (isolated DB):**
- `wallets` — User wallet balances
- `ledger_entries` — Double-entry bookkeeping
- `wallet_transactions` — Transaction records
- `escrow_holds` — Escrow tracking

---

## How to Run

### Start Development Infrastructure
```bash
npm run docker:up
```

This starts:
- PostgreSQL (ports 5432, 5433)
- Redis (ports 6379, 6380)
- Kafka (port 9092)
- Elasticsearch (port 9200)
- MongoDB (port 27017)
- MinIO (port 9000, console 9001)
- MailHog (port 8025)

### Run Development Servers
```bash
npm run dev
```

This starts all services with Turborepo:
- Auth Service: http://localhost:3001
- User Service: http://localhost:3002
- Wallet Service: http://localhost:3003

### Run Tests
```bash
npm run test
```

### Type Check
```bash
npm run typecheck
```

### Lint
```bash
npm run lint
```

### Build All Services
```bash
npm run build
```

---

## API Testing

### Auth Flow
```bash
# 1. Register (send OTP)
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@srmist.edu.in","password":"SecurePass123!"}'

# 2. Verify OTP
curl -X POST http://localhost:3001/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"test@srmist.edu.in","otp":"123456","name":"Test User","username":"testuser","password":"SecurePass123!"}'

# 3. Login
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@srmist.edu.in","password":"SecurePass123!"}'

# 4. Refresh token
curl -X POST http://localhost:3001/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"..."}'
```

### User Flow
```bash
# Get user profile
curl http://localhost:3002/users/:id

# Search users
curl "http://localhost:3002/users/search?q=john"

# Get Campusly Score
curl http://localhost:3002/users/:id/score
```

### Wallet Flow
```bash
# Get balance (requires auth token)
curl http://localhost:3003/wallet/balance \
  -H "Authorization: Bearer <access_token>"

# Top-up
curl -X POST http://localhost:3003/wallet/topup \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"amount":500,"idempotency_key":"unique-key-123"}'

# P2P Transfer
curl -X POST http://localhost:3003/wallet/transfer \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"recipient_id":"user-uuid","amount":100,"idempotency_key":"unique-key-456"}'
```

---

## Next: Phase 2 (Weeks 9-16) — Marketplace MVP

**What's Next:**
- Marketplace Service (listings, search, transactions)
- Elasticsearch integration
- Escrow-protected purchase flow
- Review system
- Mobile app shell (React Native)
- Marketplace UI screens
- Wallet UI integration

---

## Files Created in Phase 1

**Total Files:** 70+

**Key Files:**
- Root config: 10 files
- Docker/Infra: 15 files
- Auth Service: 10 files
- User Service: 8 files
- Wallet Service: 12 files
- Shared Packages: 8 files
- CI/CD: 4 files
- Documentation: 5 files

---

**Phase 1 Status:** ✅ COMPLETE  
**Ready for:** Phase 2 — Marketplace MVP

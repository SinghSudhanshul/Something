# NEXUS — Campus Super-App

> A production-grade, event-driven campus super-app for Indian universities.
> Marketplace · Food Delivery · Rides · Errands · Skills · Events

```
┌─────────────────────────────────────────────────────────────────┐
│                     NEXUS ARCHITECTURE                          │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                     │
│  │  Mobile   │  │   Web    │  │  Admin   │    ← Client Apps    │
│  │ (Expo)   │  │(Next.js) │  │(Next.js) │                     │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                     │
│       │              │              │                            │
│  ┌────▼──────────────▼──────────────▼────┐                     │
│  │         Kong API Gateway (8000)       │   ← Rate Limiting   │
│  └────┬──────┬──────┬──────┬──────┬─────┘     + JWT Auth       │
│       │      │      │      │      │                             │
│  ┌────▼──┐┌──▼───┐┌─▼──┐┌─▼───┐┌─▼────┐                      │
│  │ Auth  ││Bazaar││Feast││Swift││Skills │                      │
│  │ 3001  ││ 3002 ││3004 ││3006 ││ 3007 │                      │
│  └───────┘└──────┘└─────┘└─────┘└──────┘                      │
│  ┌───────┐┌──────┐┌─────┐┌──────┐┌─────┐                      │
│  │ Pulse ││Trust ││Notif││Search││ Ana  │                      │
│  │ 3008  ││ 3009 ││3010 ││ 3011 ││3012 │                      │
│  └───────┘└──────┘└─────┘└──────┘└─────┘                      │
│  ┌───────────┐┌───────────┐                                    │
│  │  Wallet   ││   Rides   │   ← Go Services (ACID/Geospatial) │
│  │   3003    ││   3005    │                                    │
│  └───────────┘└───────────┘                                    │
│       │              │                                          │
│  ┌────▼──────────────▼──────────────────┐                      │
│  │    PostgreSQL + PostGIS  │  Redis    │                      │
│  │    Kafka  │  Elasticsearch │ MongoDB │   ← Infrastructure  │
│  └──────────────────────────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer          | Technology                    | Rationale                                |
|----------------|-------------------------------|------------------------------------------|
| Mobile         | React Native (Expo SDK 51)    | Cross-platform, OTA updates              |
| Web            | Next.js 14                    | SSR/SSG, React ecosystem                 |
| API Gateway    | Kong 3.7                      | Rate limiting, JWT auth, routing         |
| Node Services  | Fastify + TypeScript          | High-performance HTTP, schema validation |
| Go Services    | Gin + pgx/v5                  | ACID transactions, geospatial ops        |
| Python Service | FastAPI                       | Analytics, ML pipeline                   |
| Database       | PostgreSQL 15 + PostGIS       | ACID, geospatial queries                 |
| Cache          | Redis 7.2                     | Sessions, rate limiting, pub/sub         |
| Message Queue  | Apache Kafka 7.6 (KRaft)      | Event sourcing, async processing         |
| Search         | Elasticsearch 8.13            | Full-text search, fuzzy matching         |
| Documents      | MongoDB 7.0                   | Notifications, analytics events          |
| ORM            | Drizzle ORM                   | Type-safe, lightweight                   |
| Monorepo       | Turborepo + pnpm              | Fast builds, dependency caching          |
| IaC            | Terraform                     | AWS infrastructure as code               |

## Prerequisites

- **Node.js** 20.14.0+ (`nvm use` will pick up `.nvmrc`)
- **pnpm** 9.1.2+ (`corepack enable && corepack prepare pnpm@9.1.2 --activate`)
- **Go** 1.22+
- **Docker** + Docker Compose
- **Python** 3.12+ (for analytics service)

## Quick Start

```bash
# 1. Clone and install dependencies
git clone https://github.com/nexus-campus/nexus.git && cd nexus
pnpm install

# 2. Start infrastructure (PostgreSQL, Redis, Kafka, etc.)
pnpm docker:up

# 3. Run database migrations and seed data
pnpm db:migrate && pnpm db:seed

# 4. Start all services in development mode
pnpm dev
```

## Service Ports

| Port | Service              | Tech Stack        |
|------|----------------------|-------------------|
| 8000 | Kong API Gateway     | Kong 3.7          |
| 8001 | Kong Admin API       | Kong 3.7          |
| 8080 | Kafka UI             | kafka-ui          |
| 3001 | Auth Service         | Fastify + TS      |
| 3002 | Bazaar Service       | Fastify + TS      |
| 3003 | Wallet Service       | Go + Gin          |
| 3004 | Feast Service        | Fastify + TS      |
| 3005 | Rides Service        | Go + Gin          |
| 3006 | Swift Service        | Fastify + TS      |
| 3007 | Skills Service       | Fastify + TS      |
| 3008 | Pulse Service        | Fastify + TS      |
| 3009 | Trust Service        | Fastify + TS      |
| 3010 | Notifications Service| Fastify + BullMQ  |
| 3011 | Search Service       | Fastify + TS      |
| 3012 | Analytics Service    | Python + FastAPI  |
| 3100 | Admin Dashboard      | Next.js 14        |

## Modules

| Module   | Service        | Description                                       |
|----------|----------------|---------------------------------------------------|
| Bazaar   | `bazaar`       | Campus marketplace — buy/sell goods between students |
| Feast    | `feast`        | Food ordering from campus canteens & vendors       |
| Rides    | `rides`        | Intra-campus ride sharing with geospatial matching |
| Swift    | `swift`        | Errand & task completion marketplace               |
| Skills   | `skills`       | Peer tutoring & skill sharing platform             |
| Pulse    | `pulse`        | Campus events discovery & management               |
| Trust    | `trust`        | User trust scoring, moderation, dispute resolution |
| Wallet   | `wallet`       | Digital wallet with escrow & double-entry ledger   |

## Project Structure

```
nexus/
├── apps/           — Client applications (mobile, web, admin)
├── services/       — Microservices (12 services)
├── packages/       — Shared packages (types, kafka, utils, database)
├── infrastructure/ — Docker, Terraform, K8s, Kong
└── .github/        — CI/CD workflows, templates
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for branch naming, commit conventions, and the PR checklist.

## License

Copyright © 2024 NEXUS Campus. All rights reserved.
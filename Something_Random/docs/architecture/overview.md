# Campusly Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                          │
│   Android App    iOS App    Web Dashboard    Admin Panel    │
└─────────────────────────────┬───────────────────────────────┘
                              │ HTTPS / WebSocket
┌─────────────────────────────▼───────────────────────────────┐
│                      API GATEWAY LAYER                       │
│   Kong API Gateway — Rate Limiting, Auth, Routing           │
│   AWS CloudFront CDN — Static assets, Media delivery        │
└──┬──────────┬──────────┬──────────┬──────────┬──────────────┘
   │          │          │          │          │
┌──▼──┐  ┌───▼──┐  ┌────▼──┐  ┌───▼──┐  ┌───▼──┐
│Auth │  │User  │  │Wallet │  │Market│  │Food  │  ...more
│Svc  │  │Svc   │  │Svc    │  │Svc   │  │Svc   │
└──┬──┘  └───┬──┘  └────┬──┘  └───┬──┘  └───┬──┘
   │          │          │          │          │
┌──▼──────────▼──────────▼──────────▼──────────▼─────────────┐
│                  MESSAGE BROKER — Apache Kafka              │
│          Event streaming, async communication               │
└──┬──────────────────────────────────────────────────────────┘
   │
┌──▼──────────────────────────────────────────────────────────┐
│                       DATA LAYER                            │
│  PostgreSQL (primary)    Redis (cache)    Elasticsearch     │
│  MongoDB (unstructured)  S3 (media)       TimescaleDB       │
└─────────────────────────────────────────────────────────────┘
```

## Services

| Service | Port | Responsibility |
|---------|------|----------------|
| Auth | 3001 | Authentication, JWT, OTP, Sessions |
| User | 3002 | User profiles, Campusly Score, Search |
| Wallet | 3003 | Payments, Double-entry bookkeeping, Escrow |
| Marketplace | 3004 | Buy/sell listings, Transactions |
| Food | 3005 | Vendor management, Orders, Delivery |
| Event | 3006 | Events, RSVP, Team formation |
| Notification | 3007 | Push, SMS, Email notifications |
| Moderation | 3008 | Content moderation, Trust & Safety |

## Database Per Service

Each service owns its database. Cross-service communication happens via:
- Synchronous: REST/gRPC API calls
- Asynchronous: Kafka events

No shared databases between services.

## Key Design Decisions

1. **Monorepo with Turborepo** — Shared types, configs, and utilities
2. **TypeScript everywhere** — Type safety across services
3. **Event-driven architecture** — Kafka for async workflows
4. **Double-entry bookkeeping** — Wallet service uses accounting principles
5. **CQRS for read-heavy services** — Read replicas + Elasticsearch

## Technology Stack

### Backend
- Node.js (TypeScript) — Primary
- Go — High-performance services (matching engine)
- NestJS / Express — API frameworks
- Kafka — Event streaming
- BullMQ — Task queues

### Frontend
- React Native — Mobile app
- Next.js 14 — Web dashboard, Admin panel
- Zustand + React Query — State management

### Data
- PostgreSQL 16 — Primary database
- Redis 7 — Cache, sessions, pub/sub
- Elasticsearch 8 — Search engine
- MongoDB — Chat, notifications
- TimescaleDB — Metrics, analytics

### Infrastructure
- AWS EKS — Kubernetes
- Terraform — Infrastructure as Code
- GitHub Actions — CI/CD
- Docker — Containerization

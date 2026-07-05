# Contributing to NEXUS

Thank you for contributing to NEXUS! This guide covers our development workflow, coding standards, and review process.

## Branch Naming Convention

All branches must follow this format:

```
{type}/{scope}-{short-description}
```

| Type     | Use Case                          |
|----------|-----------------------------------|
| `feat/`  | New features                      |
| `fix/`   | Bug fixes                         |
| `chore/` | Tooling, deps, config changes     |
| `docs/`  | Documentation only                |
| `perf/`  | Performance improvements          |
| `ci/`    | CI/CD pipeline changes            |

**Examples:**
- `feat/auth-otp-verification`
- `fix/wallet-idempotency-race-condition`
- `chore/deps-bump-fastify-4.27`

## Commit Convention

We follow **[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)**:

```
{type}({scope}): {subject}

{body}

{footer}
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `revert`, `ci`, `security`

**Scopes:** `auth`, `bazaar`, `wallet`, `rides`, `feast`, `swift`, `skills`, `pulse`, `trust`, `notifications`, `search`, `analytics`, `mobile`, `web`, `admin`, `infra`, `ci`, `deps`, `types`, `kafka`, `database`, `utils`, `global`

**Examples:**
```
feat(auth): add OTP verification via institutional email
fix(wallet): prevent double-spend in concurrent P2P transfers
chore(deps): bump fastify from 4.26.0 to 4.27.1
```

## Pull Request Process

1. Create a branch from `develop` following the naming convention above
2. Make your changes with atomic commits
3. Ensure all checks pass locally:
   ```bash
   pnpm type-check
   pnpm lint
   pnpm test
   ```
4. Open a PR against `develop` using the PR template
5. Request review from the appropriate code owners
6. Address review feedback
7. Squash and merge after approval

## Code Review Checklist

Before requesting review, verify:

- [ ] Types pass — `pnpm type-check` exits 0
- [ ] Tests pass — `pnpm test` exits 0
- [ ] No `console.log` statements (use structured pino logger)
- [ ] Database migrations tested (up and down)
- [ ] Swagger/OpenAPI spec updated for new endpoints
- [ ] Environment variables documented in `.env.example`
- [ ] No secrets or credentials committed
- [ ] Error handling uses `AppError` class from `@nexus/utils`
- [ ] All config loaded via Zod-validated environment variables

## Development Setup

```bash
# Install dependencies
pnpm install

# Start infrastructure
pnpm docker:up

# Run all services
pnpm dev

# Run tests
pnpm test

# Type check
pnpm type-check
```

## Architecture Decisions

- **Fastify** over Express for all Node.js services (performance, schema validation)
- **Drizzle ORM** for type-safe database access
- **Zod** for runtime validation (config, request bodies)
- **pino** for structured JSON logging everywhere
- **workspace:\*** protocol for inter-package imports
- **@nexus/types** as the single source of truth — no type duplication

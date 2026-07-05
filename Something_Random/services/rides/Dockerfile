# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# NEXUS Rides Service — Multi-stage Dockerfile
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# ── Stage 1: Build ─────────────────────────────
FROM golang:1.22-alpine AS builder

RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download && go mod verify

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-s -w -X main.version=$(git describe --tags --always 2>/dev/null || echo dev)" \
    -o /rides-server ./cmd/server

# ── Stage 2: Runtime ───────────────────────────
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata curl && \
    addgroup -g 1000 nexus && adduser -u 1000 -G nexus -s /bin/sh -D nexus

COPY --from=builder /rides-server /usr/local/bin/rides-server
COPY --from=builder /build/migrations /app/migrations

WORKDIR /app
USER nexus

EXPOSE 3005

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3005/health || exit 1

ENTRYPOINT ["rides-server"]

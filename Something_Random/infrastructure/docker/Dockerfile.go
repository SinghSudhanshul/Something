FROM golang:1.22.3-alpine AS builder

# Install SSL ca certificates and tzdata
RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Build statically linked binary
ARG SERVICE_DIR
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/service ./${SERVICE_DIR}/cmd/server/main.go

FROM scratch AS runner

COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /app/service /service

EXPOSE 8080
ENTRYPOINT ["/service"]

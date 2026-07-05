module github.com/rideandgo/shared-go

go 1.22

require (
	github.com/gin-gonic/gin v1.10.0
	github.com/go-playground/validator/v10 v10.20.0
	github.com/golang-jwt/jwt/v5 v5.2.1
	github.com/jackc/pgx/v5 v5.6.0
	github.com/jackc/pgx/v5/pgxpool v5.6.0
	github.com/prometheus/client_golang v1.19.0
	github.com/redis/go-redis/v9 v9.5.3
	github.com/segmentio/kafka-go v0.4.47
	github.com/spf13/viper v1.18.2
	go.opentelemetry.io/otel v1.24.0
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc v1.24.0
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp v1.24.0
	go.opentelemetry.io/otel/sdk v1.24.0
	go.uber.org/zap v1.27.0
	golang.org/x/crypto v0.23.0
	golang.org/x/time v0.6.0
)
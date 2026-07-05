// Package config loads, validates, and exposes runtime configuration
// for the Ride&Go microservice. The struct is constructed from environment
// variables (12-factor), with sane production defaults for optional fields.
// Load() panics on missing required values — fail fast, never start
// degraded. Configuration is read-only after load.
package config

import (
	"fmt"
	"strings"
	"time"

	"github.com/kelseyhightower/envconfig"
)

// Config is the typed runtime configuration for the service.
// All sensitive values (DATABASE_URL, secrets, API keys) must come
// from a secret manager in production. ENV files are accepted in
// local development only and are explicitly excluded from version
// control.
type Config struct {
	// Service identity
	ServiceName string `envconfig:"SERVICE_NAME" default:"rideandgo"`
	Version     string `envconfig:"SERVICE_VERSION" default:"1.0.0"`
	Env         string `envconfig:"APP_ENV" default:"development"`
	Port        int    `envconfig:"PORT" default:"8080"`
	Region      string `envconfig:"REGION" default:"ap-south-1"`
	InstanceID  string `envconfig:"INSTANCE_ID" default:""`

	// HTTP server
	HTTPReadTimeout     time.Duration `envconfig:"HTTP_READ_TIMEOUT" default:"15s"`
	HTTPWriteTimeout    time.Duration `envconfig:"HTTP_WRITE_TIMEOUT" default:"30s"`
	HTTPIdleTimeout     time.Duration `envconfig:"HTTP_IDLE_TIMEOUT" default:"120s"`
	HTTPShutdownTimeout time.Duration `envconfig:"HTTP_SHUTDOWN_TIMEOUT" default:"30s"`
	HTTPMaxBodyBytes    int64         `envconfig:"HTTP_MAX_BODY_BYTES" default:"1048576"` // 1MB

	// PostgreSQL
	DatabaseURL             string        `envconfig:"DATABASE_URL" required:"true"`
	DatabaseMaxConns        int32         `envconfig:"DATABASE_MAX_CONNS" default:"50"`
	DatabaseMinConns        int32         `envconfig:"DATABASE_MIN_CONNS" default:"5"`
	DatabaseMaxConnLifetime time.Duration `envconfig:"DATABASE_MAX_CONN_LIFETIME" default:"1h"`
	DatabaseMaxConnIdleTime time.Duration `envconfig:"DATABASE_MAX_CONN_IDLE_TIME" default:"30m"`
	DatabaseHealthCheck     time.Duration `envconfig:"DATABASE_HEALTH_CHECK_PERIOD" default:"30s"`
	DatabaseStatementCache  int           `envconfig:"DATABASE_STATEMENT_CACHE_CAP" default:"512"`

	// Redis
	RedisURL          string        `envconfig:"REDIS_URL" required:"true"`
	RedisPassword     string        `envconfig:"REDIS_PASSWORD" default:""`
	RedisDB           int           `envconfig:"REDIS_DB" default:"0"`
	RedisPoolSize     int           `envconfig:"REDIS_POOL_SIZE" default:"50"`
	RedisMinIdleConns int           `envconfig:"REDIS_MIN_IDLE_CONNS" default:"10"`
	RedisDialTimeout  time.Duration `envconfig:"REDIS_DIAL_TIMEOUT" default:"5s"`
	RedisReadTimeout  time.Duration `envconfig:"REDIS_READ_TIMEOUT" default:"3s"`
	RedisWriteTimeout time.Duration `envconfig:"REDIS_WRITE_TIMEOUT" default:"3s"`
	RedisClusterMode  bool          `envconfig:"REDIS_CLUSTER_MODE" default:"false"`

	// Kafka
	KafkaBrokers       []string      `envconfig:"KAFKA_BROKERS" required:"true"`
	KafkaClientID      string        `envconfig:"KAFKA_CLIENT_ID" default:"rideandgo"`
	KafkaConsumerGroup string        `envconfig:"KAFKA_CONSUMER_GROUP" default:"rideandgo-default"`
	KafkaTLSEnabled    bool          `envconfig:"KAFKA_TLS_ENABLED" default:"false"`
	KafkaSASLUser      string        `envconfig:"KAFKA_SASL_USER" default:""`
	KafkaSASLPassword  string        `envconfig:"KAFKA_SASL_PASSWORD" default:""`
	KafkaProduceFlushMs int          `envconfig:"KAFKA_PRODUCE_FLUSH_MS" default:"100"`
	KafkaProduceRetries int          `envconfig:"KAFKA_PRODUCE_RETRIES" default:"5"`

	// JWT — issued by the Auth service, validated here
	JWTAccessSecret   string        `envconfig:"JWT_ACCESS_SECRET" required:"true"`
	JWTRefreshSecret  string        `envconfig:"JWT_REFRESH_SECRET" required:"true"`
	JWTIssuer         string        `envconfig:"JWT_ISSUER" default:"nexus.auth"`
	JWTAccessTTL      time.Duration `envconfig:"JWT_ACCESS_TTL" default:"15m"`
	JWTRefreshTTL     time.Duration `envconfig:"JWT_REFRESH_TTL" default:"30d"`
	JWTClockSkew      time.Duration `envconfig:"JWT_CLOCK_SKEW" default:"60s"`

	// Internal service-to-service auth
	InternalServiceSecret string `envconfig:"INTERNAL_SERVICE_SECRET" required:"true"`

	// External integrations
	GoogleMapsAPIKey      string `envconfig:"GOOGLE_MAPS_API_KEY" default:""`
	MapboxAccessToken     string `envconfig:"MAPBOX_ACCESS_TOKEN" default:""`
	StripeSecretKey       string `envconfig:"STRIPE_SECRET_KEY" default:""`
	StripeWebhookSecret   string `envconfig:"STRIPE_WEBHOOK_SECRET" default:""`
	RazorpayKeyID         string `envconfig:"RAZORPAY_KEY_ID" default:""`
	RazorpayKeySecret     string `envconfig:"RAZORPAY_KEY_SECRET" default:""`
	RazorpayWebhookSecret string `envconfig:"RAZORPAY_WEBHOOK_SECRET" default:""`
	TwilioAccountSID      string `envconfig:"TWILIO_ACCOUNT_SID" default:""`
	TwilioAuthToken       string `envconfig:"TWILIO_AUTH_TOKEN" default:""`
	TwilioFromNumber      string `envconfig:"TWILIO_FROM_NUMBER" default:""`
	FCMServiceAccountJSON string `envconfig:"FCM_SERVICE_ACCOUNT_JSON" default:""`
	APNsKeyID             string `envconfig:"APNS_KEY_ID" default:""`
	APNsTeamID            string `envconfig:"APNS_TEAM_ID" default:""`
	APNsBundleID          string `envconfig:"APNS_BUNDLE_ID" default:""`

	// Storage
	S3Region         string `envconfig:"S3_REGION" default:"ap-south-1"`
	S3Bucket         string `envconfig:"S3_BUCKET" default:"rideandgo-prod"`
	S3Endpoint       string `envconfig:"S3_ENDPOINT" default:""` // for MinIO in dev
	S3AccessKey      string `envconfig:"S3_ACCESS_KEY" default:""`
	S3SecretKey      string `envconfig:"S3_SECRET_KEY" default:""`
	S3ForcePathStyle bool   `envconfig:"S3_FORCE_PATH_STYLE" default:"false"`

	// Ride business rules
	MatchingRadiusMeters         int           `envconfig:"MATCHING_RADIUS_METERS" default:"5000"`
	MatchingRadiusStepMeters    int           `envconfig:"MATCHING_RADIUS_STEP_METERS" default:"1000"`
	MatchingOfferTimeoutSeconds  int           `envconfig:"MATCHING_OFFER_TIMEOUT_SECONDS" default:"30"`
	MatchingMaxConcurrentOffers int           `envconfig:"MATCHING_MAX_CONCURRENT_OFFERS" default:"3"`
	DriverOnlineTTLSeconds       int           `envconfig:"DRIVER_ONLINE_TTL_SECONDS" default:"30"`
	GPSTrackingMinIntervalMs     int           `envconfig:"GPS_TRACKING_MIN_INTERVAL_MS" default:"2000"`
	GPSTrackingMinIntervalIdleMs int           `envconfig:"GPS_TRACKING_MIN_INTERVAL_IDLE_MS" default:"10000"`
	TripSearchTimeoutSeconds     int           `envconfig:"TRIP_SEARCH_TIMEOUT_SECONDS" default:"300"`
	MaxAdvanceBookingDays        int           `envconfig:"MAX_ADVANCE_BOOKING_DAYS" default:"30"`
	DefaultCancellationWindowMin int           `envconfig:"DEFAULT_CANCELLATION_WINDOW_MIN" default:"2"`
	FareQuoteValiditySeconds     int           `envconfig:"FARE_QUOTE_VALIDITY_SECONDS" default:"900"`
	SurgeMaxMultiplier           float64       `envconfig:"SURGE_MAX_MULTIPLIER" default:"3.0"`
	SurgeRefreshInterval         time.Duration `envconfig:"SURGE_REFRESH_INTERVAL" default:"30s"`
	SOSResponseTimeoutSeconds    int           `envconfig:"SOS_RESPONSE_TIMEOUT_SECONDS" default:"15"`
	SOSEscalationTimeoutSeconds  int           `envconfig:"SOS_ESCALATION_TIMEOUT_SECONDS" default:"30"`

	// Rate limiting (per-user, per-minute)
	RateLimitRPS        int `envconfig:"RATE_LIMIT_RPS" default:"100"`
	RateLimitBurst      int `envconfig:"RATE_LIMIT_BURST" default:"200"`
	RateLimitSOSRPS     int `envconfig:"RATE_LIMIT_SOS_RPS" default:"10"`
	RateLimitAuthRPS    int `envconfig:"RATE_LIMIT_AUTH_RPS" default:"20"`
	RateLimitWebsocketConnections int `envconfig:"RATE_LIMIT_WEBSOCKET_CONNECTIONS" default:"5"`

	// Observability
	LogLevel       string `envconfig:"LOG_LEVEL" default:"info"`
	LogFormat      string `envconfig:"LOG_FORMAT" default:"json"` // json | console
	OTELExporter   string `envconfig:"OTEL_EXPORTER" default:""`  // otlp | none
	OTELEndpoint   string `envconfig:"OTEL_EXPORTER_OTLP_ENDPOINT" default:""`
	PrometheusPort int    `envconfig:"PROMETHEUS_PORT" default:"9090"`
	SentryDSN      string `envconfig:"SENTRY_DSN" default:""`
	Environment    string `envconfig:"DEPLOY_ENV" default:"local"` // local | staging | production

	// Feature flags
	FeatureCashPayments    bool `envconfig:"FEATURE_CASH_PAYMENTS" default:"true"`
	FeatureScheduledRides  bool `envconfig:"FEATURE_SCHEDULED_RIDES" default:"true"`
	FeatureSharedRides     bool `envconfig:"FEATURE_SHARED_RIDES" default:"true"`
	FeatureSurgePricing    bool `envconfig:"FEATURE_SURGE_PRICING" default:"true"`
	FeatureWomenOnlyRides  bool `envconfig:"FEATURE_WOMEN_ONLY_RIDES" default:"true"`
	FeatureIntercityRides  bool `envconfig:"FEATURE_INTERCITY_RIDES" default:"false"`
	FeatureRentalVehicles  bool `envconfig:"FEATURE_RENTAL_VEHICLES" default:"false"`

	// CORS
	CORSAllowedOrigins []string `envconfig:"CORS_ALLOWED_ORIGINS" default:"*"`
	CORSAllowedMethods []string `envconfig:"CORS_ALLOWED_METHODS" default:"GET,POST,PUT,PATCH,DELETE,OPTIONS"`
	CORSAllowedHeaders []string `envconfig:"CORS_ALLOWED_HEADERS" default:"Authorization,Content-Type,X-Request-ID,X-Idempotency-Key"`

	// Trusted proxies (for X-Forwarded-For, X-Real-IP)
	TrustedProxies []string `envconfig:"TRUSTED_PROXIES" default:""`
}

// Load reads configuration from environment. It panics if any
// required field is missing — silent startup with zero-values is
// strictly worse than crashing, which is observable and recoverable.
func Load() (*Config, error) {
	var c Config
	if err := envconfig.Process("", &c); err != nil {
		return nil, fmt.Errorf("config: load failed: %w", err)
	}
	if err := c.validate(); err != nil {
		return nil, fmt.Errorf("config: validation failed: %w", err)
	}
	c.applyProductionDefaults()
	return &c, nil
}

// validate enforces cross-field invariants that envconfig cannot.
func (c *Config) validate() error {
	if c.Port <= 0 || c.Port > 65535 {
		return fmt.Errorf("PORT must be 1..65535, got %d", c.Port)
	}
	if c.DatabaseMaxConns < c.DatabaseMinConns {
		return fmt.Errorf("DATABASE_MAX_CONNS (%d) must be >= DATABASE_MIN_CONNS (%d)",
			c.DatabaseMaxConns, c.DatabaseMinConns)
	}
	if c.MatchingOfferTimeoutSeconds < 5 || c.MatchingOfferTimeoutSeconds > 120 {
		return fmt.Errorf("MATCHING_OFFER_TIMEOUT_SECONDS out of range: %d", c.MatchingOfferTimeoutSeconds)
	}
	if c.SurgeMaxMultiplier < 1.0 || c.SurgeMaxMultiplier > 5.0 {
		return fmt.Errorf("SURGE_MAX_MULTIPLIER must be 1.0..5.0, got %f", c.SurgeMaxMultiplier)
	}
	if c.SOSResponseTimeoutSeconds > 60 {
		return fmt.Errorf("SOS_RESPONSE_TIMEOUT_SECONDS must be <= 60")
	}
	if c.HTTPReadTimeout <= 0 || c.HTTPWriteTimeout <= 0 {
		return fmt.Errorf("HTTP timeouts must be positive")
	}
	for _, broker := range c.KafkaBrokers {
		if strings.TrimSpace(broker) == "" {
			return fmt.Errorf("KAFKA_BROKERS contains an empty value")
		}
	}
	return nil
}

// applyProductionDefaults locks down behavior in production: stricter
// rate limits, encryption-required fields, no console logging.
func (c *Config) applyProductionDefaults() {
	if c.IsProduction() {
		if c.LogFormat == "console" {
			c.LogFormat = "json"
		}
		if c.CORSAllowedOrigins[0] == "*" {
			c.CORSAllowedOrigins = []string{}
		}
		if c.DatabaseMaxConns < 20 {
			c.DatabaseMaxConns = 20
		}
	}
}

// IsProduction reports whether the service is running in production.
// It checks both the DeployEnv and Env fields — the former is set by
// the orchestrator, the latter is set by the developer.
func (c *Config) IsProduction() bool {
	return c.Environment == "production" || c.Env == "production"
}

// IsDevelopment reports whether the service is running locally.
func (c *Config) IsDevelopment() bool {
	return c.Env == "development" || c.Environment == "local"
}

// IsStaging reports whether the service is running in staging.
func (c *Config) IsStaging() bool {
	return c.Env == "staging" || c.Environment == "staging"
}

// Redacted returns a redacted copy of the config safe to log.
func (c *Config) Redacted() map[string]any {
	r := map[string]any{
		"service_name":     c.ServiceName,
		"version":          c.Version,
		"env":              c.Env,
		"port":             c.Port,
		"region":           c.Region,
		"instance_id":      c.InstanceID,
		"deployment_env":   c.Environment,
		"database_max":     c.DatabaseMaxConns,
		"redis_pool":       c.RedisPoolSize,
		"kafka_brokers":    len(c.KafkaBrokers),
		"log_level":        c.LogLevel,
		"log_format":       c.LogFormat,
		"is_production":    c.IsProduction(),
		"feature_flags": map[string]bool{
			"cash_payments":     c.FeatureCashPayments,
			"scheduled_rides":   c.FeatureScheduledRides,
			"shared_rides":      c.FeatureSharedRides,
			"surge_pricing":     c.FeatureSurgePricing,
			"women_only_rides":  c.FeatureWomenOnlyRides,
			"intercity_rides":   c.FeatureIntercityRides,
			"rental_vehicles":   c.FeatureRentalVehicles,
		},
	}
	return r
}

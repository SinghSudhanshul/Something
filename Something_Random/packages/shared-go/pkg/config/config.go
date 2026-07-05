package config

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/spf13/viper"
)

type Config struct {
	App        AppConfig
	Database   DatabaseConfig
	Redis      RedisConfig
	Kafka      KafkaConfig
	Auth       AuthConfig
	HTTP       HTTPConfig
	Logging    LoggingConfig
	Metrics    MetricsConfig
	Tracing    TracingConfig
	RateLimit  RateLimitConfig
	Storage    StorageConfig
	External   ExternalConfig
	Feature    FeatureFlags
}

type AppConfig struct {
	Name        string
	Environment string
	Version     string
	Port        int
	Host        string
	Debug       bool
}

type DatabaseConfig struct {
	Host            string
	Port            int
	User            string
	Password        string
	Name            string
	SSLMode         string
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration
	ConnMaxIdleTime time.Duration
	MigrationsPath  string
}

func (d DatabaseConfig) DSN() string {
	return fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=%s",
		d.User, d.Password, d.Host, d.Port, d.Name, d.SSLMode)
}

type RedisConfig struct {
	Host         string
	Port         int
	Password     string
	DB           int
	PoolSize     int
	MinIdleConns int
	DialTimeout  time.Duration
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
}

func (r RedisConfig) Address() string {
	return fmt.Sprintf("%s:%d", r.Host, r.Port)
}

type KafkaConfig struct {
	Brokers        []string
	ConsumerGroup  string
	Topics         KafkaTopics
	Producer       KafkaProducerConfig
	Consumer       KafkaConsumerConfig
}

type KafkaTopics struct {
	RideRequested       string
	RideAccepted        string
	RideStarted         string
	RideCompleted       string
	RideCancelled       string
	RideRating          string
	DriverLocation      string
	PaymentRequested    string
	PaymentCompleted    string
	PaymentFailed       string
	NotificationSend    string
	SOSEvent            string
	AnalyticsEvent      string
	WalletTransaction   string
	PayoutRequested     string
	ScheduledRideDue    string
	PromoApplied        string
	DriverOnboarded     string
	VehicleRegistered   string
}

type KafkaProducerConfig struct {
	Async           bool
	BatchSize       int
	BatchTimeout    time.Duration
	RequiredAcks    int
	Compression     string
	MaxMessageBytes int
}

type KafkaConsumerConfig struct {
	MinBytes       int
	MaxBytes       int
	MaxWait        time.Duration
	CommitInterval time.Duration
	StartOffset    int64
}

type AuthConfig struct {
	JWTSecret           string
	JWTIssuer           string
	JWTAudience         string
	AccessTokenExpiry   time.Duration
	RefreshTokenExpiry  time.Duration
	OTPExpiry           time.Duration
	OTPLength           int
	MaxOTPAttempts      int
	PasswordMinLength   int
	RequireEmailVerify  bool
	RequirePhoneVerify  bool
	AllowedOrigins      []string
	TrustedProxies      []string
	InternalSecret      string
}

type HTTPConfig struct {
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
	MaxHeaderBytes    int
	ShutdownTimeout   time.Duration
	BodyLimit         int64
	EnableCompression bool
	TrustedProxies    []string
}

type LoggingConfig struct {
	Level       string
	Format      string
	OutputPaths []string
	ErrorPaths  []string
	Development bool
	Sampling    SamplingConfig
}

type SamplingConfig struct {
	Initial    int
	Thereafter int
}

type MetricsConfig struct {
	Enabled     bool
	Path        string
	Port        int
	ServiceName string
}

type TracingConfig struct {
	Enabled     bool
	Endpoint    string
	ServiceName string
	SampleRate  float64
	Insecure    bool
}

type RateLimitConfig struct {
	Enabled           bool
	RequestsPerMinute int
	Burst             int
	CustomRules       map[string]RateLimitRule
}

type RateLimitRule struct {
	Path        string
	Method      string
	Limit       int
	Window      time.Duration
	KeyGenerator string
}

type StorageConfig struct {
	Provider        string
	Bucket          string
	Region          string
	AccessKey       string
	SecretKey       string
	Endpoint        string
	UsePathStyle    bool
	PublicBaseURL   string
	MaxUploadSize   int64
	AllowedMimeTypes []string
}

type ExternalConfig struct {
	Stripe       StripeConfig
	Razorpay     RazorpayConfig
	Firebase     FirebaseConfig
	Twilio       TwilioConfig
	SendGrid     SendGridConfig
	Mapbox       MapboxConfig
	GoogleMaps   GoogleMapsConfig
	Digilocker   DigilockerConfig
	Truecaller   TruecallerConfig
	RTOAPI       RTOAPIConfig
}

type StripeConfig struct {
	SecretKey      string
	PublishableKey string
	WebhookSecret  string
	APIVersion     string
}

type RazorpayConfig struct {
	KeyID     string
	KeySecret string
	WebhookSecret string
}

type FirebaseConfig {
	ProjectID     string
	CredentialsPath string
	DatabaseURL   string
}

type TwilioConfig struct {
	AccountSID   string
	AuthToken    string
	FromNumber   string
	MessagingSID string
}

type SendGridConfig struct {
	APIKey       string
	FromEmail    string
	FromName     string
	TemplateIDs  map[string]string
}

type MapboxConfig struct {
	AccessToken string
	StyleURL    string
}

type GoogleMapsConfig struct {
	APIKey          string
	PlacesAPIKey    string
	DirectionsAPIKey string
}

type DigilockerConfig struct {
	ClientID     string
	ClientSecret string
	RedirectURL  string
	AuthURL      string
	TokenURL     string
	APIBaseURL   string
}

type TruecallerConfig struct {
	ClientID     string
	ClientSecret string
	APIBaseURL   string
}

type RTOAPIConfig struct {
	BaseURL    string
	APIKey     string
	Timeout    time.Duration
}

type FeatureFlags struct {
	EnableSurgePricing        bool
	EnablePoolRides           bool
	EnableScheduledRides      bool
	EnableCorporateAccounts   bool
	EnableWomenOnlyRides      bool
	EnablePetFriendlyRides    bool
	EnableAccessibilityRides  bool
	EnableLuggageHandling     bool
	EnableRealTimeTracking    bool
	EnableSOS                 bool
	EnableRatings             bool
	EnablePromos              bool
	EnableReferrals           bool
	EnableLoyalty             bool
	EnableWallet              bool
	EnableCashPayments        bool
	EnableCardPayments        bool
	EnableUPIPayments         bool
	EnableStripe              bool
	EnableRazorpay            bool
	EnableWebhooks            bool
	EnableKafka               bool
	EnableMetrics             bool
	EnableTracing             bool
	EnableProfiling           bool
	MaintenanceMode           bool
	ReadOnlyMode              bool
}

func Load(path ...string) (*Config, error) {
	v := viper.New()

	v.SetConfigName("config")
	v.SetConfigType("yaml")
	v.AddConfigPath(".")
	v.AddConfigPath("./config")
	v.AddConfigPath("/etc/rideandgo")

	for _, p := range path {
		v.AddConfigPath(p)
	}

	v.SetEnvPrefix("RIDEGO")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	setDefaults(v)

	if err := v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("failed to read config: %w", err)
		}
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("config validation failed: %w", err)
	}

	return &cfg, nil
}

func setDefaults(v *viper.Viper) {
	v.SetDefault("app.name", "rideandgo")
	v.SetDefault("app.environment", "development")
	v.SetDefault("app.version", "1.0.0")
	v.SetDefault("app.port", 8080)
	v.SetDefault("app.host", "0.0.0.0")
	v.SetDefault("app.debug", false)

	v.SetDefault("database.host", "localhost")
	v.SetDefault("database.port", 5432)
	v.SetDefault("database.user", "rideandgo")
	v.SetDefault("database.password", "rideandgo")
	v.SetDefault("database.name", "rideandgo")
	v.SetDefault("database.sslmode", "disable")
	v.SetDefault("database.max_open_conns", 25)
	v.SetDefault("database.max_idle_conns", 5)
	v.SetDefault("database.conn_max_lifetime", "5m")
	v.SetDefault("database.conn_max_idle_time", "1m")
	v.SetDefault("database.migrations_path", "migrations")

	v.SetDefault("redis.host", "localhost")
	v.SetDefault("redis.port", 6379)
	v.SetDefault("redis.password", "")
	v.SetDefault("redis.db", 0)
	v.SetDefault("redis.pool_size", 10)
	v.SetDefault("redis.min_idle_conns", 2)
	v.SetDefault("redis.dial_timeout", "5s")
	v.SetDefault("redis.read_timeout", "3s")
	v.SetDefault("redis.write_timeout", "3s")

	v.SetDefault("kafka.brokers", []string{"localhost:9092"})
	v.SetDefault("kafka.consumer_group", "rideandgo")
	v.SetDefault("kafka.topics.ride_requested", "rides.requested")
	v.SetDefault("kafka.topics.ride_accepted", "rides.accepted")
	v.SetDefault("kafka.topics.ride_started", "rides.started")
	v.SetDefault("kafka.topics.ride_completed", "rides.completed")
	v.SetDefault("kafka.topics.ride_cancelled", "rides.cancelled")
	v.SetDefault("kafka.topics.ride_rating", "rides.rating")
	v.SetDefault("kafka.topics.driver_location", "drivers.location")
	v.SetDefault("kafka.topics.payment_requested", "payments.requested")
	v.SetDefault("kafka.topics.payment_completed", "payments.completed")
	v.SetDefault("kafka.topics.payment_failed", "payments.failed")
	v.SetDefault("kafka.topics.notification_send", "notifications.send")
	v.SetDefault("kafka.topics.sos_event", "safety.sos")
	v.SetDefault("kafka.topics.analytics_event", "analytics.events")
	v.SetDefault("kafka.topics.wallet_transaction", "wallet.transactions")
	v.SetDefault("kafka.topics.payout_requested", "payouts.requested")
	v.SetDefault("kafka.topics.scheduled_ride_due", "rides.scheduled_due")
	v.SetDefault("kafka.topics.promo_applied", "promos.applied")
	v.SetDefault("kafka.topics.driver_onboarded", "drivers.onboarded")
	v.SetDefault("kafka.topics.vehicle_registered", "vehicles.registered")
	v.SetDefault("kafka.producer.async", true)
	v.SetDefault("kafka.producer.batch_size", 100)
	v.SetDefault("kafka.producer.batch_timeout", "10ms")
	v.SetDefault("kafka.producer.required_acks", 1)
	v.SetDefault("kafka.producer.compression", "snappy")
	v.SetDefault("kafka.producer.max_message_bytes", 1048576)
	v.SetDefault("kafka.consumer.min_bytes", 1)
	v.SetDefault("kafka.consumer.max_bytes", 10485760)
	v.SetDefault("kafka.consumer.max_wait", "500ms")
	v.SetDefault("kafka.consumer.commit_interval", "1s")
	v.SetDefault("kafka.consumer.start_offset", -2)

	v.SetDefault("auth.jwt_secret", "change-me-in-production")
	v.SetDefault("auth.jwt_issuer", "rideandgo")
	v.SetDefault("auth.jwt_audience", "rideandgo-api")
	v.SetDefault("auth.access_token_expiry", "15m")
	v.SetDefault("auth.refresh_token_expiry", "168h")
	v.SetDefault("auth.otp_expiry", "5m")
	v.SetDefault("auth.otp_length", 6)
	v.SetDefault("auth.max_otp_attempts", 3)
	v.SetDefault("auth.password_min_length", 8)
	v.SetDefault("auth.require_email_verify", true)
	v.SetDefault("auth.require_phone_verify", true)
	v.SetDefault("auth.allowed_origins", []string{"http://localhost:3000"})
	v.SetDefault("auth.trusted_proxies", []string{"127.0.0.1"})
	v.SetDefault("auth.internal_secret", "internal-service-secret")

	v.SetDefault("http.read_timeout", "15s")
	v.SetDefault("http.write_timeout", "30s")
	v.SetDefault("http.idle_timeout", "60s")
	v.SetDefault("http.max_header_bytes", 1048576)
	v.SetDefault("http.shutdown_timeout", "30s")
	v.SetDefault("http.body_limit", 10485760)
	v.SetDefault("http.enable_compression", true)
	v.SetDefault("http.trusted_proxies", []string{"127.0.0.1"})

	v.SetDefault("logging.level", "info")
	v.SetDefault("logging.format", "json")
	v.SetDefault("logging.output_paths", []string{"stdout"})
	v.SetDefault("logging.error_paths", []string{"stderr"})
	v.SetDefault("logging.development", false)
	v.SetDefault("logging.sampling.initial", 100)
	v.SetDefault("logging.sampling.thereafter", 100)

	v.SetDefault("metrics.enabled", true)
	v.SetDefault("metrics.path", "/metrics")
	v.SetDefault("metrics.port", 9090)
	v.SetDefault("metrics.service_name", "rideandgo")

	v.SetDefault("tracing.enabled", false)
	v.SetDefault("tracing.endpoint", "http://localhost:4318/v1/traces")
	v.SetDefault("tracing.service_name", "rideandgo")
	v.SetDefault("tracing.sample_rate", 0.1)
	v.SetDefault("tracing.insecure", true)

	v.SetDefault("rate_limit.enabled", true)
	v.SetDefault("rate_limit.requests_per_minute", 100)
	v.SetDefault("rate_limit.burst", 20)

	v.SetDefault("storage.provider", "s3")
	v.SetDefault("storage.bucket", "rideandgo")
	v.SetDefault("storage.region", "us-east-1")
	v.SetDefault("storage.endpoint", "")
	v.SetDefault("storage.use_path_style", false)
	v.SetDefault("storage.public_base_url", "")
	v.SetDefault("storage.max_upload_size", 10485760)
	v.SetDefault("storage.allowed_mime_types", []string{"image/jpeg", "image/png", "application/pdf"})

	v.SetDefault("feature.enable_surge_pricing", true)
	v.SetDefault("feature.enable_pool_rides", true)
	v.SetDefault("feature.enable_scheduled_rides", true)
	v.SetDefault("feature.enable_corporate_accounts", true)
	v.SetDefault("feature.enable_women_only_rides", true)
	v.SetDefault("feature.enable_pet_friendly_rides", true)
	v.SetDefault("feature.enable_accessibility_rides", true)
	v.SetDefault("feature.enable_luggage_handling", true)
	v.SetDefault("feature.enable_real_time_tracking", true)
	v.SetDefault("feature.enable_sos", true)
	v.SetDefault("feature.enable_ratings", true)
	v.SetDefault("feature.enable_promos", true)
	v.SetDefault("feature.enable_referrals", true)
	v.SetDefault("feature.enable_loyalty", true)
	v.SetDefault("feature.enable_wallet", true)
	v.SetDefault("feature.enable_cash_payments", true)
	v.SetDefault("feature.enable_card_payments", true)
	v.SetDefault("feature.enable_upi_payments", true)
	v.SetDefault("feature.enable_stripe", false)
	v.SetDefault("feature.enable_razorpay", true)
	v.SetDefault("feature.enable_webhooks", true)
	v.SetDefault("feature.enable_kafka", true)
	v.SetDefault("feature.enable_metrics", true)
	v.SetDefault("feature.enable_tracing", false)
	v.SetDefault("feature.enable_profiling", false)
	v.SetDefault("feature.maintenance_mode", false)
	v.SetDefault("feature.read_only_mode", false)
}

func (c *Config) Validate() error {
	if c.App.Name == "" {
		return fmt.Errorf("app.name is required")
	}
	if c.Database.Host == "" {
		return fmt.Errorf("database.host is required")
	}
	if c.Database.User == "" {
		return fmt.Errorf("database.user is required")
	}
	if c.Database.Name == "" {
		return fmt.Errorf("database.name is required")
	}
	if c.Redis.Host == "" {
		return fmt.Errorf("redis.host is required")
	}
	if len(c.Kafka.Brokers) == 0 {
		return fmt.Errorf("kafka.brokers is required")
	}
	if c.Auth.JWTSecret == "" || c.Auth.JWTSecret == "change-me-in-production" {
		if c.App.Environment == "production" {
			return fmt.Errorf("auth.jwt_secret must be set in production")
		}
	}
	return nil
}

func GetEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func GetEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		var intValue int
		fmt.Sscanf(value, "%d", &intValue)
		return intValue
	}
	return defaultValue
}

func GetEnvBool(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		return value == "true" || value == "1"
	}
	return defaultValue
}

func GetEnvDuration(key string, defaultValue time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		if d, err := time.ParseDuration(value); err == nil {
			return d
		}
	}
	return defaultValue
}

func GetEnvStringSlice(key string, defaultValue []string) []string {
	if value := os.Getenv(key); value != "" {
		return strings.Split(value, ",")
	}
	return defaultValue
}
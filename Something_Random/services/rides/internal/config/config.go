package config

import (
	"fmt"
	"strings"

	"github.com/spf13/viper"
)

// Config holds all configuration for the rides service.
type Config struct {
	Port                  int    `mapstructure:"PORT"`
	Env                   string `mapstructure:"NODE_ENV"`
	DatabaseURL           string `mapstructure:"DATABASE_URL"`
	RedisURL              string `mapstructure:"REDIS_URL"`
	KafkaBrokers          string `mapstructure:"KAFKA_BROKERS"`
	InternalServiceSecret string `mapstructure:"INTERNAL_SERVICE_SECRET"`
	GoogleMapsAPIKey      string `mapstructure:"GOOGLE_MAPS_API_KEY"`
	WalletServiceURL      string `mapstructure:"WALLET_SERVICE_URL"`
	TrustServiceURL       string `mapstructure:"TRUST_SERVICE_URL"`
	AWSS3DocsBucket       string `mapstructure:"AWS_S3_DOCS_BUCKET"`

	// Payment Gateway (Razorpay)
	RazorpayKeyID     string `mapstructure:"RAZORPAY_KEY_ID"`
	RazorpayKeySecret string `mapstructure:"RAZORPAY_KEY_SECRET"`
	RazorpayWebhookSecret string `mapstructure:"RAZORPAY_WEBHOOK_SECRET"`

	// Weather API
	WeatherAPIKey string `mapstructure:"WEATHER_API_KEY"`
	WeatherAPIURL string `mapstructure:"WEATHER_API_URL"`

	// Notification Service
	NotificationServiceURL string `mapstructure:"NOTIFICATION_SERVICE_URL"`

	// Surge Pricing
	SurgeEnabled       bool    `mapstructure:"SURGE_ENABLED"`
	SurgeMaxMultiplier float64 `mapstructure:"SURGE_MAX_MULTIPLIER"`

	// Rewards
	RewardsEnabled          bool `mapstructure:"REWARDS_ENABLED"`
	RewardsPointsPerRide    int  `mapstructure:"REWARDS_POINTS_PER_RIDE"`
	RewardsReferralBonus    int  `mapstructure:"REWARDS_REFERRAL_BONUS"`
}

// KafkaBrokerList returns the Kafka brokers as a string slice.
func (c *Config) KafkaBrokerList() []string {
	return strings.Split(c.KafkaBrokers, ",")
}

// Load reads configuration from environment variables and .env file.
// Panics on startup if any required variable is absent (fail fast).
func Load() (*Config, error) {
	viper.SetDefault("PORT", 3005)
	viper.SetDefault("NODE_ENV", "development")
	viper.SetDefault("DATABASE_URL", "postgres://nexus:nexus_dev_secret@localhost:5432/nexus_dev?sslmode=disable")
	viper.SetDefault("REDIS_URL", "redis://localhost:6379")
	viper.SetDefault("KAFKA_BROKERS", "localhost:9092")
	viper.SetDefault("INTERNAL_SERVICE_SECRET", "dev-internal-secret-change-in-production")
	viper.SetDefault("WALLET_SERVICE_URL", "http://localhost:3003")
	viper.SetDefault("TRUST_SERVICE_URL", "http://localhost:3009")
	viper.SetDefault("AWS_S3_DOCS_BUCKET", "nexus-dev-docs")
	viper.SetDefault("RAZORPAY_KEY_ID", "")
	viper.SetDefault("RAZORPAY_KEY_SECRET", "")
	viper.SetDefault("RAZORPAY_WEBHOOK_SECRET", "")
	viper.SetDefault("WEATHER_API_KEY", "")
	viper.SetDefault("WEATHER_API_URL", "https://api.openweathermap.org/data/2.5")
	viper.SetDefault("NOTIFICATION_SERVICE_URL", "http://localhost:3010")
	viper.SetDefault("SURGE_ENABLED", true)
	viper.SetDefault("SURGE_MAX_MULTIPLIER", 3.0)
	viper.SetDefault("REWARDS_ENABLED", true)
	viper.SetDefault("REWARDS_POINTS_PER_RIDE", 10)
	viper.SetDefault("REWARDS_REFERRAL_BONUS", 50)

	viper.AutomaticEnv()
	viper.SetConfigFile(".env")
	_ = viper.ReadInConfig() // ignore missing .env

	var cfg Config
	if err := viper.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	// Validate required fields
	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	if cfg.RedisURL == "" {
		return nil, fmt.Errorf("REDIS_URL is required")
	}
	if cfg.KafkaBrokers == "" {
		return nil, fmt.Errorf("KAFKA_BROKERS is required")
	}

	return &cfg, nil
}

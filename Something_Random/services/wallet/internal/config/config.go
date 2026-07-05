// Package config provides Viper-based environment configuration for the wallet service.
package config

import (
	"fmt"
	"strings"

	"github.com/spf13/viper"
)

// Config holds all configuration values for the wallet service.
type Config struct {
	Env                    string `mapstructure:"NODE_ENV"`
	Port                   int    `mapstructure:"WALLET_PORT"`
	DatabaseURL            string `mapstructure:"WALLET_DB_URL"`
	RedisURL               string `mapstructure:"WALLET_REDIS_URL"`
	LogLevel               string `mapstructure:"LOG_LEVEL"`
	KafkaBrokers           string `mapstructure:"KAFKA_BROKERS"`
	RazorpayKeyID          string `mapstructure:"RAZORPAY_KEY_ID"`
	RazorpayKeySecret      string `mapstructure:"RAZORPAY_KEY_SECRET"`
	RazorpayWebhookSecret  string `mapstructure:"RAZORPAY_WEBHOOK_SECRET"`
	InternalSecret         string `mapstructure:"INTERNAL_SERVICE_SECRET"`
}

// Load reads configuration from environment variables and validates required fields.
func Load() (*Config, error) {
	v := viper.New()

	v.SetDefault("NODE_ENV", "development")
	v.SetDefault("WALLET_PORT", 3003)
	v.SetDefault("LOG_LEVEL", "info")
	v.SetDefault("WALLET_DB_URL", "postgres://nexus:nexus_dev_secret@localhost:5432/nexus_dev")
	v.SetDefault("WALLET_REDIS_URL", "redis://localhost:6379")
	v.SetDefault("KAFKA_BROKERS", "localhost:9092")
	v.SetDefault("RAZORPAY_KEY_ID", "")
	v.SetDefault("RAZORPAY_KEY_SECRET", "")
	v.SetDefault("RAZORPAY_WEBHOOK_SECRET", "webhook_secret_dev")
	v.SetDefault("INTERNAL_SERVICE_SECRET", "dev_internal_secret")

	v.AutomaticEnv()
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))

	cfg := &Config{
		Env:                   v.GetString("NODE_ENV"),
		Port:                  v.GetInt("WALLET_PORT"),
		DatabaseURL:           v.GetString("WALLET_DB_URL"),
		RedisURL:              v.GetString("WALLET_REDIS_URL"),
		LogLevel:              v.GetString("LOG_LEVEL"),
		KafkaBrokers:          v.GetString("KAFKA_BROKERS"),
		RazorpayKeyID:         v.GetString("RAZORPAY_KEY_ID"),
		RazorpayKeySecret:     v.GetString("RAZORPAY_KEY_SECRET"),
		RazorpayWebhookSecret: v.GetString("RAZORPAY_WEBHOOK_SECRET"),
		InternalSecret:        v.GetString("INTERNAL_SERVICE_SECRET"),
	}

	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("WALLET_DB_URL is required")
	}
	if cfg.RedisURL == "" {
		return nil, fmt.Errorf("WALLET_REDIS_URL is required")
	}

	return cfg, nil
}

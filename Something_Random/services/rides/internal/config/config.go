package config

import (
	"os"
)

type Config struct {
	DatabaseURL string
	Port        string
}

func Load() (*Config, error) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:postgres@localhost:5432/nexus?sslmode=disable"
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "3005"
	}
	return &Config{
		DatabaseURL: dbURL,
		Port:        port,
	}, nil
}

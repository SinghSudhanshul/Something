package main

import (
	"context"
	"fmt"
	"os"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"nexus/rides/internal/config"
	"nexus/rides/internal/db"
	"nexus/rides/internal/ride"
)

var version = "dev"

func main() {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	logger.Info("Starting rides service", zap.String("version", version))

	cfg, err := config.Load()
	if err != nil {
		logger.Fatal("failed to load configuration", zap.Error(err))
	}

	pool, err := db.Connect(context.Background(), cfg.DatabaseURL)
	if err != nil {
		logger.Fatal("failed to connect to database", zap.Error(err))
	}
	defer pool.Close()

	repo := ride.NewRepository(pool)
	handler := ride.NewHandler(repo, logger)

	router := gin.Default()
	handler.RegisterRoutes(router)

	port := fmt.Sprintf(":%s", cfg.Port)
	logger.Info("Listening", zap.String("port", port))
	if err := router.Run(port); err != nil {
		logger.Fatal("failed to start server", zap.Error(err))
		os.Exit(1)
	}
}

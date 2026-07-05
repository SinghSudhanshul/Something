// Package main is the entry point for the NEXUS Wallet Service.
//
// The wallet service handles all financial operations with STRICT ACID
// compliance: top-ups, withdrawals, P2P transfers, escrow holds/releases,
// and double-entry bookkeeping. Built with Go/Gin for maximum performance.
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"nexus/wallet/internal/config"
	"nexus/wallet/internal/db"
	"nexus/wallet/internal/handler"
	"nexus/wallet/internal/health"
	"nexus/wallet/internal/middleware"
	"nexus/wallet/internal/payment"
	internalRedis "nexus/wallet/internal/redis"
	"nexus/wallet/internal/transfer"
	"nexus/wallet/internal/wallet"
)

func main() {
	// Initialize structured logger
	logger, err := zap.NewProduction()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to initialize logger: %v\n", err)
		os.Exit(1)
	}
	defer func() { _ = logger.Sync() }()

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		logger.Fatal("failed to load configuration", zap.Error(err))
	}

	// Connect to PostgreSQL
	pool, err := db.Connect(context.Background(), cfg.DatabaseURL)
	if err != nil {
		logger.Fatal("failed to connect to database", zap.Error(err))
	}
	defer pool.Close()
	logger.Info("connected to PostgreSQL")

	// Connect to Redis
	rdb, err := internalRedis.Connect(cfg.RedisURL)
	if err != nil {
		logger.Fatal("failed to connect to Redis", zap.Error(err))
	}
	defer func() { _ = rdb.Close() }()
	logger.Info("connected to Redis")

	// Set Gin mode
	if cfg.Env == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	// Initialize services
	walletService := wallet.NewService(pool, logger)
	transferService := transfer.NewService(pool, logger)
	razorpayClient := payment.NewRazorpayClient(
		cfg.RazorpayKeyID,
		cfg.RazorpayKeySecret,
		logger,
	)

	// Initialize handlers
	walletHandler := handler.NewHandler(walletService)
	transferHandler := transfer.NewHandler(transferService)
	topupHandler := payment.NewTopUpHandler(razorpayClient, walletService, logger)
	webhookHandler := payment.NewWebhookHandler(walletService, cfg.RazorpayWebhookSecret, logger)

	// Initialize router
	router := gin.New()
	router.Use(gin.Recovery())
	router.Use(ginZapLogger(logger))
	router.Use(middleware.RequestID())

	// Register routes
	health.RegisterRoutes(router)
	walletHandler.RegisterRoutes(router)

	// Authenticated routes
	authGroup := router.Group("/api/v1/wallet")
	authGroup.Use(middleware.Auth())
	authGroup.POST("/transfer", transferHandler.HandleTransfer)
	authGroup.POST("/topup/initiate", topupHandler.InitiateTopUp)

	// Webhook route (NOT behind auth — Razorpay calls directly)
	router.POST("/api/v1/wallet/topup/webhook", webhookHandler.Handle)

	// Create HTTP server
	srv := &http.Server{
		Addr:         fmt.Sprintf("0.0.0.0:%d", cfg.Port),
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start background jobs
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	walletService.StartDailyLimitReset(ctx)
	walletService.StartEscrowReleaseJob(ctx)

	// Start server
	go func() {
		logger.Info("wallet service started",
			zap.Int("port", cfg.Port),
			zap.String("env", cfg.Env),
			zap.Bool("razorpay_mock", razorpayClient.IsMockMode()),
		)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("server failed to start", zap.Error(err))
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
	sig := <-quit

	logger.Info("received shutdown signal", zap.String("signal", sig.String()))

	cancel() // Stop background jobs

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Fatal("server forced to shutdown", zap.Error(err))
	}

	logger.Info("wallet service shut down gracefully")
}

func ginZapLogger(logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		query := c.Request.URL.RawQuery

		c.Next()

		latency := time.Since(start)

		logger.Info("request",
			zap.Int("status", c.Writer.Status()),
			zap.String("method", c.Request.Method),
			zap.String("path", path),
			zap.String("query", query),
			zap.Duration("latency", latency),
			zap.String("ip", c.ClientIP()),
			zap.Int("body_size", c.Writer.Size()),
		)
	}
}

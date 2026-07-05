package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"

	"nexus/rides/internal/admin"
	"nexus/rides/internal/config"
	"nexus/rides/internal/curator"
	"nexus/rides/internal/db"
	"nexus/rides/internal/driver"
	"nexus/rides/internal/fleet"
	"nexus/rides/internal/health"
	"nexus/rides/internal/incidents"
	internalKafka "nexus/rides/internal/kafka"
	"nexus/rides/internal/middleware"
	"nexus/rides/internal/payment"
	"nexus/rides/internal/places"
	internalRedis "nexus/rides/internal/redis"
	"nexus/rides/internal/rewards"
	"nexus/rides/internal/ride"
	"nexus/rides/internal/sos"
	"nexus/rides/internal/tracking"
	ridesWallet "nexus/rides/internal/wallet"
)

func main() {
	logger, err := zap.NewProduction()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to initialize logger: %v\n", err)
		os.Exit(1)
	}
	defer func() { _ = logger.Sync() }()

	cfg, err := config.Load()
	if err != nil {
		logger.Fatal("failed to load configuration", zap.Error(err))
	}

	// ━━━ Database Connection ━━━
	pool, err := db.Connect(context.Background(), cfg.DatabaseURL)
	if err != nil {
		logger.Fatal("failed to connect to database", zap.Error(err))
	}
	defer pool.Close()
	logger.Info("connected to PostgreSQL (PostGIS)")

	// ━━━ Redis Connection ━━━
	rdb, err := internalRedis.Connect(cfg.RedisURL)
	if err != nil {
		logger.Fatal("failed to connect to Redis", zap.Error(err))
	}
	defer func() { _ = rdb.Close() }()
	logger.Info("connected to Redis")

	// ━━━ Kafka Producer ━━━
	kafkaProducer := internalKafka.NewProducer(cfg.KafkaBrokerList(), logger)
	defer func() { _ = kafkaProducer.Close() }()
	logger.Info("Kafka producer initialized")

	// ━━━ Repositories ━━━
	driverRepo := driver.NewRepository(pool)
	rideRepo := ride.NewRideRepository(pool)
	poolRepo := ride.NewPoolRepository(pool)
	fleetRepo := fleet.NewRepository(pool)
	curatorRepo := curator.NewRepository(pool)
	adminRepo := admin.NewRepository(pool)
	placesRepo := places.NewRepository(pool)
	rewardsRepo := rewards.NewRepository(pool)
	incidentsRepo := incidents.NewRepository(pool)
	paymentRepo := payment.NewRepository(pool)

	// ━━━ Services ━━━
	driverSvc := driver.NewService(driverRepo, rdb, kafkaProducer, logger)
	matchingEngine := ride.NewMatchingEngine(driverRepo, rideRepo, rdb, logger)

	// Wallet client — real HTTP in production, stub when wallet URL is
	// empty (local dev / unit tests). The ride service calls Hold on
	// ride request, Capture on completion, Release on cancel, and
	// credits driver earnings on success.
	var walletClient ridesWallet.Client
	if cfg.WalletServiceURL != "" {
		walletClient = ridesWallet.NewHTTPClient(ridesWallet.Options{
			BaseURL:         cfg.WalletServiceURL,
			InternalSecret:  cfg.InternalServiceSecret,
			RideServiceUser: "service:rides",
			Logger:          logger,
		})
		logger.Info("wallet client wired",
			zap.String("url", cfg.WalletServiceURL),
		)
	} else {
		walletClient = ridesWallet.NewStub()
		logger.Warn("WALLET_SERVICE_URL not set; using in-memory stub")
	}

	rideSvc := ride.NewService(rideRepo, matchingEngine, ride.NewFareCalculator(rideRepo, ride.DefaultFareConfig()), driverRepo, rdb, kafkaProducer, logger, ride.DefaultServiceConfig(), walletClient)
	sosSvc := sos.NewService(pool, rdb, kafkaProducer, logger)
	fleetSvc := fleet.NewService(fleetRepo, pool, kafkaProducer, logger)
	curatorSvc := curator.NewService(curatorRepo, pool, rdb, kafkaProducer, logger)
	adminSvc := admin.NewService(adminRepo, pool, rdb, kafkaProducer, logger)
	placesSvc := places.NewService(placesRepo, rdb, kafkaProducer, logger)
	rewardsSvc := rewards.NewService(rewardsRepo, pool, rdb, kafkaProducer, logger, cfg.RewardsPointsPerRide, cfg.RewardsReferralBonus)
	incidentsSvc := incidents.NewService(incidentsRepo, pool, rdb, kafkaProducer, logger)
	paymentSvc := payment.NewService(paymentRepo, rdb, kafkaProducer, logger)

	// ━━━ Handlers ━━━
	driverHandler := driver.NewHandler(driverSvc)
	rideHandler := ride.NewHandler(rideSvc)
	fleetHandler := fleet.NewHandler(fleetSvc)
	curatorHandler := curator.NewHandler(curatorSvc)
	adminHandler := admin.NewHandler(adminSvc)
	placesHandler := places.NewHandler(placesSvc)
	rewardsHandler := rewards.NewHandler(rewardsSvc)
	incidentsHandler := incidents.NewHandler(incidentsSvc)
	paymentHandler := payment.NewHandler(paymentSvc)

	// ━━━ Tracking Hub (WebSocket) ━━━
	hub := tracking.NewHub(pool, rdb, logger)
	go hub.Run()

	// ━━━ Background Workers ━━━
	bgCtx, bgCancel := context.WithCancel(context.Background())
	defer bgCancel()

	// Scheduled ride poller
	scheduledMgr := ride.NewScheduledRideManager(rideRepo, matchingEngine, kafkaProducer, rdb, logger)
	go scheduledMgr.StartScheduledRidePoller(bgCtx)

	// Expired ride cleaner
	go ride.StartExpiredRideCleaner(bgCtx, pool, logger)

	// ━━━ Kafka Consumers ━━━
	kafkaConsumer := internalKafka.NewConsumer(cfg.KafkaBrokerList(), "rides-service", logger)
	eventHandler := ride.NewEventHandler(rideRepo, pool, rdb, kafkaProducer, logger)
	ride.RegisterConsumers(kafkaConsumer, eventHandler)
	kafkaConsumer.Start(bgCtx)
	logger.Info("Kafka consumers started")

	// ━━━ Gin Router ━━━
	if cfg.Env == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()
	router.Use(gin.Recovery())
	router.Use(ginZapLogger(logger))
	router.Use(middleware.RequestID())
	router.Use(corsMiddleware())

	// Health routes
	health.RegisterRoutes(router)

	// ━━━ Driver Routes ━━━
	drivers := router.Group("/api/v1/rides/drivers")
	{
		drivers.POST("/register", middleware.Auth(), middleware.RequireVerificationLevel(2), driverHandler.Register)
		drivers.GET("/me", middleware.Auth(), driverHandler.GetMe)
		drivers.PATCH("/me/availability", middleware.Auth(), driverHandler.UpdateAvailability)
		drivers.PATCH("/me/location", middleware.Auth(), driverHandler.UpdateLocation)
		drivers.GET("/me/history", middleware.Auth(), driverHandler.GetHistory)
		drivers.GET("/me/earnings", middleware.Auth(), func(c *gin.Context) {
			user := middleware.GetUser(c)
			if user == nil {
				c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
				return
			}
			userID, _ := uuid.Parse(user.ID)
			driverProfile, err := driverSvc.GetProfile(c.Request.Context(), userID)
			if err != nil {
				c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND"})
				return
			}

			// Get earnings summary
			var totalEarnings, weekEarnings, todayEarnings float64
			_ = pool.QueryRow(c.Request.Context(), `
				SELECT 
					COALESCE(SUM(CASE WHEN rr.status = 'completed' THEN rr.estimated_fare::numeric ELSE 0 END), 0),
					COALESCE(SUM(CASE WHEN rr.status = 'completed' AND rr.completed_at >= NOW() - INTERVAL '7 days' 
						THEN rr.estimated_fare::numeric ELSE 0 END), 0),
					COALESCE(SUM(CASE WHEN rr.status = 'completed' AND rr.completed_at >= CURRENT_DATE 
						THEN rr.estimated_fare::numeric ELSE 0 END), 0)
				FROM ride_requests rr
				WHERE rr.driver_id = $1
			`, driverProfile.ID).Scan(&totalEarnings, &weekEarnings, &todayEarnings)

			c.JSON(http.StatusOK, gin.H{
				"data": gin.H{
					"total_earnings":     fmt.Sprintf("%.2f", totalEarnings),
					"week_earnings":      fmt.Sprintf("%.2f", weekEarnings),
					"today_earnings":     fmt.Sprintf("%.2f", todayEarnings),
					"total_rides":        driverProfile.TotalRides,
					"currency":           "INR",
				},
			})
		})
	}

	// ━━━ Ride Routes ━━━
	rides := router.Group("/api/v1/rides")
	{
		rides.POST("", middleware.Auth(), rideHandler.RequestRide)
		rides.GET("/:id", middleware.Auth(), rideHandler.GetRide)
		rides.POST("/:id/accept", middleware.Auth(), rideHandler.AcceptRide)
		rides.POST("/:id/start", middleware.Auth(), rideHandler.StartRide)
		rides.POST("/:id/complete", middleware.Auth(), rideHandler.CompleteRide)
		rides.POST("/:id/cancel", middleware.Auth(), rideHandler.CancelRide)
		rides.POST("/:id/rate", middleware.Auth(), func(c *gin.Context) {
			user := middleware.GetUser(c)
			if user == nil {
				c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
				return
			}
			rideID, err := parseUUID(c.Param("id"))
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": "Invalid ride ID"})
				return
			}
			var body struct {
				Rating  float64 `json:"rating" binding:"required,gte=1,lte=5"`
				Comment string  `json:"comment"`
			}
			if err := c.ShouldBindJSON(&body); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": err.Error()})
				return
			}

			// Verify the ride exists and user is a participant
			rideDetail, err := rideSvc.GetRide(c.Request.Context(), rideID)
			if err != nil {
				c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND"})
				return
			}
			if rideDetail.Status != "completed" {
				c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": "Can only rate completed rides"})
				return
			}

			raterID := user.ID
			var ratedUserID string
			if rideDetail.RequesterID.String() == raterID {
				if rideDetail.DriverID != nil {
					ratedUserID = rideDetail.DriverID.String()
				}
			} else if rideDetail.DriverID != nil && rideDetail.DriverID.String() == raterID {
				ratedUserID = rideDetail.RequesterID.String()
			} else {
				c.JSON(http.StatusForbidden, gin.H{"code": "FORBIDDEN", "message": "Not a participant"})
				return
			}

			_ = kafkaProducer.Publish(c.Request.Context(), "nexus.rides.rating_submitted", rideID.String(), internalKafka.Event{
				Type: "nexus.rides.rating_submitted",
				Payload: map[string]interface{}{
					"ride_id":    rideID,
					"rated_by":   raterID,
					"rated_user": ratedUserID,
					"rating":     body.Rating,
					"comment":    body.Comment,
				},
			})

			c.JSON(http.StatusOK, gin.H{"data": gin.H{"status": "submitted"}})
		})

		// ━━━ Pool Ride Routes ━━━
		rides.POST("/:id/pool/join", middleware.Auth(), func(c *gin.Context) {
			user := middleware.GetUser(c)
			if user == nil {
				c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
				return
			}
			rideID, _ := parseUUID(c.Param("id"))
			userID, _ := parseUUID(user.ID)

			var body struct {
				PickupLat   *float64 `json:"pickup_lat"`
				PickupLng   *float64 `json:"pickup_lng"`
				PickupLabel string   `json:"pickup_label"`
			}
			if err := c.ShouldBindJSON(&body); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": err.Error()})
				return
			}

			participant, err := poolRepo.AddParticipant(c.Request.Context(), ride.AddParticipantInput{
				RideRequestID: rideID,
				UserID:        userID,
				PickupLat:     body.PickupLat,
				PickupLng:     body.PickupLng,
				PickupLabel:   body.PickupLabel,
			})
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"code": "POOL_JOIN_FAILED", "message": err.Error()})
				return
			}
			c.JSON(http.StatusCreated, gin.H{"data": participant})
		})

		rides.GET("/:id/pool/participants", middleware.Auth(), func(c *gin.Context) {
			rideID, _ := parseUUID(c.Param("id"))
			participants, err := poolRepo.GetParticipants(c.Request.Context(), rideID)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR"})
				return
			}
			c.JSON(http.StatusOK, gin.H{"data": participants})
		})

		rides.DELETE("/:id/pool/leave", middleware.Auth(), func(c *gin.Context) {
			user := middleware.GetUser(c)
			if user == nil {
				c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
				return
			}
			rideID, _ := parseUUID(c.Param("id"))
			userID, _ := parseUUID(user.ID)

			participant, err := poolRepo.GetParticipantByUserID(c.Request.Context(), rideID, userID)
			if err != nil {
				c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND"})
				return
			}
			if err := poolRepo.CancelParticipant(c.Request.Context(), participant.ID); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"code": "LEAVE_FAILED", "message": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"data": gin.H{"status": "left"}})
		})

		// ━━━ SOS Routes ━━━
		rides.POST("/:id/sos", middleware.Auth(), func(c *gin.Context) {
			user := middleware.GetUser(c)
			if user == nil {
				c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
				return
			}
			rideID, _ := parseUUID(c.Param("id"))
			userID, _ := parseUUID(user.ID)
			var body struct {
				Lat      float64           `json:"lat" binding:"required"`
				Lng      float64           `json:"lng" binding:"required"`
				Severity sos.AlertSeverity `json:"severity"`
				Reason   string            `json:"reason"`
			}
			if err := c.ShouldBindJSON(&body); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": err.Error()})
				return
			}
			alert, results, err := sosSvc.TriggerSOS(c.Request.Context(), sos.TriggerInput{
				RideID:   rideID,
				UserID:   userID,
				Lat:      body.Lat,
				Lng:      body.Lng,
				Severity: body.Severity,
				Reason:   body.Reason,
			})
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"code": "SOS_FAILED", "message": err.Error()})
				return
			}
			c.JSON(http.StatusCreated, gin.H{
				"data":          alert,
				"notifications": results,
				"message":       "🚨 SOS triggered. Campus security has been notified.",
			})
		})

		rides.POST("/sos/:id/resolve", middleware.Auth(), middleware.RequireRoles("campus_admin", "super_admin"), func(c *gin.Context) {
			user := middleware.GetUser(c)
			alertID, _ := parseUUID(c.Param("id"))
			resolverID, _ := parseUUID(user.ID)
			var body struct {
				Note string `json:"note"`
			}
			_ = c.ShouldBindJSON(&body)
			if err := sosSvc.ResolveSOS(c.Request.Context(), sos.ResolveInput{
				AlertID:        alertID,
				ResolvedBy:     resolverID,
				ResolutionNote: body.Note,
			}); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"code": "RESOLVE_FAILED", "message": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"data": gin.H{"status": "resolved"}})
		})

		rides.GET("/sos", middleware.Auth(), middleware.RequireRoles("campus_admin", "super_admin"), func(c *gin.Context) {
			var campusID *uuid.UUID
			if cid := c.Query("campus_id"); cid != "" {
				parsed, _ := parseUUID(cid)
				campusID = &parsed
			}
			alerts, err := sosSvc.GetActiveAlerts(c.Request.Context(), campusID)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"code": "FETCH_FAILED", "message": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"data": alerts, "count": len(alerts)})
		})

		rides.GET("/sos/:id", middleware.Auth(), func(c *gin.Context) {
			alertID, _ := parseUUID(c.Param("id"))
			alert, err := sosSvc.GetAlertByID(c.Request.Context(), alertID)
			if err != nil {
				c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND"})
				return
			}
			c.JSON(http.StatusOK, gin.H{"data": alert})
		})

		// Passenger ride history
		rides.GET("/me/history", middleware.Auth(), func(c *gin.Context) {
			user := middleware.GetUser(c)
			if user == nil {
				c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
				return
			}
			userID, _ := parseUUID(user.ID)
			limitStr := c.DefaultQuery("limit", "20")
			limit, _ := strconv.Atoi(limitStr)
			if limit <= 0 || limit > 50 {
				limit = 20
			}

			rows, err := pool.Query(c.Request.Context(), `
				SELECT rr.id, rr.pickup_label, rr.dropoff_label, rr.ride_type,
				       COALESCE(rr.estimated_fare::text, '0'), rr.status,
				       rr.started_at, rr.completed_at, rr.created_at
				FROM ride_requests rr
				WHERE rr.requester_id = $1
				ORDER BY rr.created_at DESC
				LIMIT $2
			`, userID, limit)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR"})
				return
			}
			defer rows.Close()

			var rideHistory []gin.H
			for rows.Next() {
				var id uuid.UUID
				var pickupLabel, dropoffLabel, rideType, fare, status string
				var startedAt, completedAt *time.Time
				var createdAt time.Time
				if err := rows.Scan(&id, &pickupLabel, &dropoffLabel, &rideType, &fare, &status, &startedAt, &completedAt, &createdAt); err != nil {
					continue
				}
				rideHistory = append(rideHistory, gin.H{
					"id":            id,
					"pickup_label":  pickupLabel,
					"dropoff_label": dropoffLabel,
					"ride_type":     rideType,
					"fare":          fare,
					"status":        status,
					"started_at":    startedAt,
					"completed_at":  completedAt,
					"created_at":    createdAt,
				})
			}
			c.JSON(http.StatusOK, gin.H{"data": rideHistory, "count": len(rideHistory)})
		})

		// Fare estimate endpoint
		rides.POST("/estimate", middleware.Auth(), func(c *gin.Context) {
			var body struct {
				PickupLat  float64 `json:"pickup_lat" binding:"required"`
				PickupLng  float64 `json:"pickup_lng" binding:"required"`
				DropoffLat float64 `json:"dropoff_lat" binding:"required"`
				DropoffLng float64 `json:"dropoff_lng" binding:"required"`
				RideType   string  `json:"ride_type"`
			}
			if err := c.ShouldBindJSON(&body); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": err.Error()})
				return
			}
			if body.RideType == "" {
				body.RideType = "solo"
			}

			fare := ride.CalculateFromCoords(
				body.PickupLat, body.PickupLng,
				body.DropoffLat, body.DropoffLng,
				body.RideType, time.Now(),
			)

			poolFare := ride.CalculateFromCoords(
				body.PickupLat, body.PickupLng,
				body.DropoffLat, body.DropoffLng,
				"pool", time.Now(),
			)

			c.JSON(http.StatusOK, gin.H{
				"data": gin.H{
					"solo_fare":       fare.StringFixed(2),
					"pool_fare":       poolFare.StringFixed(2),
					"currency":        "INR",
					"is_night":        ride.IsNightTime(time.Now()),
					"estimated_time":  "8-12 min",
				},
			})
		})
	}

	// ━━━ SOS Webhook (Internal) ━━━
	sosGroup := router.Group("/api/v1/rides/sos")
	sos.RegisterRoutes(sosGroup, sosSvc, cfg.InternalServiceSecret)

	// ━━━ WebSocket Endpoint ━━━
	router.GET("/api/v1/rides/ws", hub.HandleWebSocket)

	// ━━━ Admin/Stats Endpoint (Legacy) ━━━
	router.GET("/api/v1/rides/admin/stats", middleware.Auth(), middleware.RequireRoles("campus_admin", "super_admin"), func(c *gin.Context) {
		stats := hub.GetStats()

		var totalRides, activeRides, completedRides int
		_ = pool.QueryRow(c.Request.Context(), `
			SELECT 
				COUNT(*),
				COUNT(*) FILTER (WHERE status IN ('open', 'matching', 'matched', 'in_progress')),
				COUNT(*) FILTER (WHERE status = 'completed')
			FROM ride_requests
			WHERE created_at >= CURRENT_DATE
		`).Scan(&totalRides, &activeRides, &completedRides)

		c.JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"websocket_stats": stats,
				"today": gin.H{
					"total_rides":     totalRides,
					"active_rides":    activeRides,
					"completed_rides": completedRides,
				},
			},
		})
	})

	// ━━━ Fleet Management Routes ━━━
	fleetGroup := router.Group("/api/v1/rides/fleet")
	fleet.RegisterRoutes(fleetGroup, fleetHandler)

	// ━━━ Curator (Driver Enhanced) Routes ━━━
	curatorGroup := router.Group("/api/v1/rides/curator")
	curator.RegisterRoutes(curatorGroup, curatorHandler)

	// ━━━ Admin Dashboard Routes ━━━
	adminGroup := router.Group("/api/v1/rides/admin")
	admin.RegisterRoutes(adminGroup, adminHandler)

	// ━━━ Places, Preferences & Collab Routes ━━━
	placesGroup := router.Group("/api/v1/rides")
	places.RegisterRoutes(placesGroup, placesHandler)

	// ━━━ Rewards & Loyalty Routes ━━━
	rewardsGroup := router.Group("/api/v1/rides/rewards")
	rewards.RegisterRoutes(rewardsGroup, rewardsHandler)

	// ━━━ Incidents & Safety Routes ━━━
	incidentsAdminGroup := router.Group("/api/v1/rides/admin/incidents")
	incidentsPublicGroup := router.Group("/api/v1/rides/safety")
	incidents.RegisterRoutes(incidentsAdminGroup, incidentsPublicGroup, incidentsHandler)

	// ━━━ Payment Routes ━━━
	paymentGroup := router.Group("/api/v1/rides/payments")
	payment.RegisterRoutes(paymentGroup, paymentHandler)

	logger.Info("all modules registered",
		zap.Int("modules", 7),
		zap.Strings("modules_list", []string{"fleet", "curator", "admin", "places", "rewards", "incidents", "payment"}),
	)

	// ━━━ HTTP Server ━━━
	srv := &http.Server{
		Addr:              fmt.Sprintf("0.0.0.0:%d", cfg.Port),
		Handler:           router,
		ReadTimeout:       15 * time.Second,
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20, // 1MB
	}

	go func() {
		logger.Info("rides service started",
			zap.Int("port", cfg.Port),
			zap.String("env", cfg.Env),
			zap.String("version", "1.0.0"),
		)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("server failed to start", zap.Error(err))
		}
	}()

	// ━━━ Graceful Shutdown ━━━
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
	sig := <-quit
	logger.Info("received shutdown signal", zap.String("signal", sig.String()))

	// Cancel background workers first
	bgCancel()

	// Close Kafka consumer
	if err := kafkaConsumer.Close(); err != nil {
		logger.Error("failed to close kafka consumer", zap.Error(err))
	}

	// Shutdown HTTP server with 30s grace period
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		logger.Fatal("server forced to shutdown", zap.Error(err))
	}
	logger.Info("rides service shut down gracefully")
}

// ginZapLogger returns a Gin middleware that logs requests using zap.
func ginZapLogger(logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		latency := time.Since(start)

		fields := []zap.Field{
			zap.Int("status", c.Writer.Status()),
			zap.String("method", c.Request.Method),
			zap.String("path", c.Request.URL.Path),
			zap.Duration("latency", latency),
			zap.String("ip", c.ClientIP()),
			zap.Int("bodySize", c.Writer.Size()),
		}

		if requestID, exists := c.Get("requestId"); exists {
			fields = append(fields, zap.String("requestId", requestID.(string)))
		}

		if latency > 500*time.Millisecond {
			logger.Warn("slow request", fields...)
		} else {
			logger.Info("request", fields...)
		}
	}
}

// corsMiddleware adds CORS headers for development.
func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Accept, Authorization, X-Request-Id, X-Authenticated-Userid, X-User-Campus-Id, X-User-Verification-Level, X-User-Trust-Tier, X-User-Roles, X-Internal-Secret")
		c.Header("Access-Control-Max-Age", "86400")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

func parseUUID(s string) (uuid.UUID, error) {
	return uuid.Parse(s)
}

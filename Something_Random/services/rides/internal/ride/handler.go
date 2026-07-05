// Package ride — HTTP transport layer.
//
// The handler is a thin shell: it parses input, defers auth checks,
// calls into the service layer, and emits the canonical NEXUS response
// envelope. Every endpoint that mutates state goes through the
// service so cross-cutting concerns (audit, kafka, recompute) stay
// in one place.
package ride

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"nexus/rides/internal/middleware"
)

// Handler wraps all ride HTTP endpoints.
type Handler struct {
	svc    *Service
	matching *MatchingEngine
	pool   *PoolRepository
	rdb    *redis.Client
	logger *zap.Logger
}

// HandlerDeps wires the handler to its collaborators.
type HandlerDeps struct {
	Service  *Service
	Matching *MatchingEngine
	Pool     *PoolRepository
	Redis    *redis.Client
	Logger   *zap.Logger
}

// NewHandler constructs the handler.
func NewHandler(d HandlerDeps) *Handler {
	if d.Service == nil || d.Matching == nil {
		panic("ride.NewHandler: missing critical deps")
	}
	return &Handler{
		svc:      d.Service,
		matching: d.Matching,
		pool:     d.Pool,
		rdb:      d.Redis,
		logger:   d.Logger,
	}
}

// Envelope is the standard JSON response wrapper.
type Envelope struct {
	Data  any             `json:"data,omitempty"`
	Error *ErrorBody      `json:"error,omitempty"`
	Meta  map[string]any  `json:"meta,omitempty"`
}

// ErrorBody is the error payload.
type ErrorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

func respond(c *gin.Context, status int, payload any) {
	c.JSON(status, Envelope{Data: payload})
}

func respondErr(c *gin.Context, status int, code, msg string) {
	c.JSON(status, Envelope{Error: &ErrorBody{Code: code, Message: msg}})
	c.Abort()
}

// RegisterRoutes wires every endpoint onto the provided router group.
func (h *Handler) RegisterRoutes(r *gin.RouterGroup) {
	r.POST("/rides", h.RequestRide)
	r.GET("/rides/:id", h.GetRide)
	r.GET("/rides", h.ListMyRides)
	r.POST("/rides/:id/cancel", h.CancelRide)
	r.POST("/rides/:id/rate", h.RateRide)
	r.GET("/rides/:id/tracking", h.GetTracking)
	r.POST("/rides/:id/tracking", h.SubmitTracking)
	r.POST("/rides/:id/luggage", h.SetLuggage)
	r.GET("/rides/:id/luggage", h.GetLuggage)
	r.POST("/rides/estimate", h.EstimateFare)

	r.POST("/rides/:id/accept", h.AcceptRide)
	r.POST("/rides/:id/reject", h.RejectRide)
	r.POST("/rides/:id/enroute", h.MarkEnroute)
	r.POST("/rides/:id/arrived", h.MarkArrived)
	r.POST("/rides/:id/start", h.MarkStarted)
	r.POST("/rides/:id/complete", h.CompleteRide)

	r.GET("/pools/detect", h.DetectPools)
	r.POST("/pools", h.CreatePool)
	r.GET("/pools/:id", h.GetPool)
	r.POST("/pools/:id/driver", h.AssignPoolDriver)
	r.POST("/pools/:id/cancel", h.CancelPool)

	r.POST("/drivers/register", h.RegisterDriver)
	r.GET("/drivers/me", h.GetDriver)
	r.PATCH("/drivers/me", h.UpdateDriver)
	r.POST("/drivers/me/location", h.UpdateLocation)
	r.POST("/drivers/me/availability", h.ToggleAvailability)
	r.GET("/drivers/:id/profile", h.GetDriverProfile)
	r.GET("/drivers/:id/ratings", h.GetDriverRatings)

	r.POST("/vehicles", h.RegisterVehicle)
	r.GET("/vehicles/me", h.ListMyVehicles)
	r.PATCH("/vehicles/:id", h.UpdateVehicle)

	r.POST("/payments/process", h.ProcessPayment)
	r.POST("/payments/:id/refund", h.RefundPayment)
	r.POST("/payments/cod/verify", h.VerifyCodOtp)
	r.POST("/payments/cod/request", h.RequestCodOtp)

	r.POST("/sos/trigger", h.TriggerSos)
	r.POST("/sos/:id/acknowledge", h.AcknowledgeSos)
	r.POST("/sos/:id/resolve", h.ResolveSos)
	r.GET("/sos/active", h.ListActiveSos)

	r.POST("/incidents", h.FileIncident)
	r.GET("/incidents/:id", h.GetIncident)
	r.PATCH("/incidents/:id", h.UpdateIncident)

	r.GET("/places", h.ListPlaces)
	r.GET("/places/popular", h.ListPopularPlaces)
	r.POST("/places/user", h.SaveUserPlace)
	r.GET("/places/user", h.ListUserPlaces)
	r.DELETE("/places/user/:id", h.DeleteUserPlace)

	r.POST("/skins/apply", h.ApplySkin)
	r.GET("/skins", h.ListSkins)
	r.POST("/vehicles/:id/scan", h.SubmitVehicleScan)
	r.GET("/vehicles/:id/scans", h.ListVehicleScans)
	r.POST("/vehicles/:id/maintenance", h.LogMaintenance)
	r.GET("/vehicles/:id/maintenance", h.ListMaintenance)

	r.POST("/deployments", h.CreateDeployment)
	r.GET("/deployments", h.ListDeployments)
	r.POST("/deployments/:id/start", h.StartDeployment)
	r.POST("/deployments/:id/complete", h.CompleteDeployment)

	r.POST("/curators/check-in", h.CuratorCheckIn)
	r.POST("/curators/check-out", h.CuratorCheckOut)
	r.POST("/curators/break", h.CuratorBreak)
	r.GET("/curators/leaderboard", h.Leaderboard)

	r.GET("/rewards/me", h.MyRewards)
}

// ===========================================================================
// Rider endpoints
// ===========================================================================

// RequestRide handles POST /api/v1/rides.
func (h *Handler) RequestRide(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		respondErr(c, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	var input RequestRideInput
	if err := c.ShouldBindJSON(&input); err != nil {
		respondErr(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	if input.CampusID == uuid.Nil {
		campusID, _ := uuid.Parse(user.CampusID)
		input.CampusID = campusID
	}
	riderID, _ := uuid.Parse(user.ID)
	resp, err := h.svc.RequestRide(c.Request.Context(), riderID, input)
	if err != nil {
		respondErr(c, http.StatusBadRequest, "REQUEST_FAILED", err.Error())
		return
	}
	c.JSON(http.StatusCreated, Envelope{Data: resp})
}

// GetRide handles GET /api/v1/rides/:id.
func (h *Handler) GetRide(c *gin.Context) {
	rideID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondErr(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid ride ID")
		return
	}
	ride, err := h.svc.repo.FindByID(c.Request.Context(), rideID)
	if err != nil {
		if errors.Is(err, ErrRideNotFound) {
			respondErr(c, http.StatusNotFound, "NOT_FOUND", "Ride not found")
			return
		}
		respondErr(c, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	if !h.canAccessRide(c, ride) {
		respondErr(c, http.StatusForbidden, "FORBIDDEN", "Not authorized to view this ride")
		return
	}
	respond(c, http.StatusOK, ride)
}

// ListMyRides handles GET /api/v1/rides (rider or driver scoped).
func (h *Handler) ListMyRides(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		respondErr(c, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	uid, _ := uuid.Parse(user.ID)
	limit := parseInt(c.DefaultQuery("limit", "20"), 20)
	offset := parseInt(c.DefaultQuery("offset", "0"), 0)
	status := c.QueryArray("status")
	filter := ListFilter{Limit: limit, Offset: offset, Statuses: status, OrderDesc: true}
	if user.Role == "driver" {
		drv, err := h.svc.driverRepo.FindByUserID(c.Request.Context(), uid)
		if err == nil && drv != nil {
			filter.DriverID = &drv.ID
		}
	} else {
		filter.RiderID = &uid
	}
	out, err := h.svc.repo.List(c.Request.Context(), filter)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	respond(c, http.StatusOK, gin.H{"items": out, "next_offset": offset + limit})
}

// CancelRide handles POST /api/v1/rides/:id/cancel.
func (h *Handler) CancelRide(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		respondErr(c, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	rideID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondErr(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid ride ID")
		return
	}
	actorID, _ := uuid.Parse(user.ID)
	var body struct {
		Reason string `json:"reason"`
		By     string `json:"by"`
	}
	_ = c.ShouldBindJSON(&body)
	if body.By == "" {
		if user.Role == "driver" {
			body.By = "driver"
		} else {
			body.By = "rider"
		}
	}
	updated, err := h.svc.CancelRide(c.Request.Context(), rideID, body.By, actorID, body.Reason)
	if err != nil {
		respondErr(c, http.StatusBadRequest, "CANCEL_FAILED", err.Error())
		return
	}
	respond(c, http.StatusOK, updated)
}

// RateRide handles POST /api/v1/rides/:id/rate.
func (h *Handler) RateRide(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		respondErr(c, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	rideID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondErr(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid ride ID")
		return
	}
	raterID, _ := uuid.Parse(user.ID)
	var body struct {
		Rating  int      `json:"rating"`
		Tags    []string `json:"tags"`
		Comment string   `json:"comment"`
		RateeID string   `json:"ratee_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		respondErr(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	rateeID, _ := uuid.Parse(body.RateeID)
	if rateeID == uuid.Nil {
		respondErr(c, http.StatusBadRequest, "BAD_REQUEST", "ratee_id required")
		return
	}
	if err := h.svc.RateRide(c.Request.Context(), rideID, raterID, rateeID, body.Rating, body.Tags, body.Comment); err != nil {
		respondErr(c, http.StatusBadRequest, "RATE_FAILED", err.Error())
		return
	}
	respond(c, http.StatusOK, gin.H{"rated": true})
}

// EstimateFare handles POST /api/v1/rides/estimate.
func (h *Handler) EstimateFare(c *gin.Context) {
	var in FareEstimateInput
	if err := c.ShouldBindJSON(&in); err != nil {
		respondErr(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	est, err := h.svc.EstimateFare(c.Request.Context(), in)
	if err != nil {
		respondErr(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	respond(c, http.StatusOK, est)
}

// ===========================================================================
// Driver endpoints
// ===========================================================================

// AcceptRide handles POST /api/v1/rides/:id/accept.
func (h *Handler) AcceptRide(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		respondErr(c, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	rideID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondErr(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid ride ID")
		return
	}
	uid, _ := uuid.Parse(user.ID)
	drv, err := h.svc.driverRepo.FindByUserID(c.Request.Context(), uid)
	if err != nil || drv == nil {
		respondErr(c, http.StatusForbidden, "NOT_A_DRIVER", "Driver profile not found")
		return
	}
	if err := h.matching.AcceptRide(c.Request.Context(), drv.ID, rideID); err != nil {
		switch {
		case errors.Is(err, ErrAlreadyAccepted):
			respondErr(c, http.StatusConflict, "ALREADY_ACCEPTED", "Ride already taken")
		case errors.Is(err, ErrOfferExpired):
			respondErr(c, http.StatusGone, "OFFER_EXPIRED", "Offer expired")
		case errors.Is(err, ErrDriverNotOffered):
			respondErr(c, http.StatusForbidden, "NOT_OFFERED", "Driver was not offered this ride")
		default:
			respondErr(c, http.StatusInternalServerError, "ACCEPT_FAILED", err.Error())
		}
		return
	}
	respond(c, http.StatusOK, gin.H{"accepted": true, "ride_id": rideID, "driver_id": drv.ID})
}

// RejectRide handles POST /api/v1/rides/:id/reject.
func (h *Handler) RejectRide(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		respondErr(c, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	rideID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondErr(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid ride ID")
		return
	}
	uid, _ := uuid.Parse(user.ID)
	drv, err := h.svc.driverRepo.FindByUserID(c.Request.Context(), uid)
	if err != nil || drv == nil {
		respondErr(c, http.StatusForbidden, "NOT_A_DRIVER", "Driver profile not found")
		return
	}
	if err := h.matching.RejectRide(c.Request.Context(), drv.ID, rideID); err != nil {
		respondErr(c, http.StatusBadRequest, "REJECT_FAILED", err.Error())
		return
	}
	respond(c, http.StatusOK, gin.H{"rejected": true})
}

// MarkEnroute handles POST /api/v1/rides/:id/enroute.
func (h *Handler) MarkEnroute(c *gin.Context) { h.simplePhase(c, "driver_enroute") }

// MarkArrived handles POST /api/v1/rides/:id/arrived.
func (h *Handler) MarkArrived(c *gin.Context) { h.simplePhase(c, "arrived") }

// MarkStarted handles POST /api/v1/rides/:id/start.
func (h *Handler) MarkStarted(c *gin.Context) {
	h.simplePhase(c, "in_progress")
}

// CompleteRide handles POST /api/v1/rides/:id/complete.
func (h *Handler) CompleteRide(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		respondErr(c, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	rideID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondErr(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid ride ID")
		return
	}
	updated, err := h.svc.CompleteRide(c.Request.Context(), rideID)
	if err != nil {
		respondErr(c, http.StatusBadRequest, "COMPLETE_FAILED", err.Error())
		return
	}
	respond(c, http.StatusOK, updated)
}

func (h *Handler) simplePhase(c *gin.Context, phase string) {
	user := middleware.GetUser(c)
	if user == nil {
		respondErr(c, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	rideID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondErr(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid ride ID")
		return
	}
	uid, _ := uuid.Parse(user.ID)
	drv, err := h.svc.driverRepo.FindByUserID(c.Request.Context(), uid)
	if err != nil || drv == nil {
		respondErr(c, http.StatusForbidden, "NOT_A_DRIVER", "Driver profile not found")
		return
	}
	loc := LatLng{}
	if v := c.Query("lat"); v != "" {
		if lat, err := strconv.ParseFloat(v, 64); err == nil {
			loc.Lat = lat
		}
	}
	if v := c.Query("lng"); v != "" {
		if lng, err := strconv.ParseFloat(v, 64); err == nil {
			loc.Lng = lng
		}
	}
	if loc.Lat == 0 && loc.Lng == 0 {
		var body struct {
			Lat float64 `json:"lat"`
			Lng float64 `json:"lng"`
		}
		_ = c.ShouldBindJSON(&body)
		loc.Lat = body.Lat
		loc.Lng = body.Lng
	}
	updated, err := h.svc.UpdatePhase(c.Request.Context(), rideID, drv.ID, phase, loc)
	if err != nil {
		respondErr(c, http.StatusBadRequest, "PHASE_FAILED", err.Error())
		return
	}
	respond(c, http.StatusOK, updated)
}

// ===========================================================================
// Tracking
// ===========================================================================

// SubmitTracking handles POST /api/v1/rides/:id/tracking.
func (h *Handler) SubmitTracking(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		respondErr(c, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	rideID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondErr(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid ride ID")
		return
	}
	uid, _ := uuid.Parse(user.ID)
	drv, err := h.svc.driverRepo.FindByUserID(c.Request.Context(), uid)
	if err != nil || drv == nil {
		respondErr(c, http.StatusForbidden, "NOT_A_DRIVER", "Driver profile not found")
		return
	}
	var body struct {
		Points []TrackingPoint `json:"points"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		respondErr(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	for i := range body.Points {
		if body.Points[i].Phase == "" {
			body.Points[i].Phase = "transit"
		}
		if body.Points[i].RecordedAt.IsZero() {
			body.Points[i].RecordedAt = time.Now().UTC()
		}
	}
	if err := h.svc.Tracking(c.Request.Context(), rideID, drv.ID, body.Points); err != nil {
		respondErr(c, http.StatusInternalServerError, "TRACKING_FAILED", err.Error())
		return
	}
	respond(c, http.StatusAccepted, gin.H{"received": len(body.Points)})
}

// GetTracking handles GET /api/v1/rides/:id/tracking.
func (h *Handler) GetTracking(c *gin.Context) {
	rideID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondErr(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid ride ID")
		return
	}
	out, err := h.svc.repo.TrackingForRide(c.Request.Context(), rideID)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	respond(c, http.StatusOK, gin.H{"items": out})
}

// ===========================================================================
// Luggage
// ===========================================================================

// SetLuggage handles POST /api/v1/rides/:id/luggage.
func (h *Handler) SetLuggage(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		respondErr(c, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	rideID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondErr(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid ride ID")
		return
	}
	uid, _ := uuid.Parse(user.ID)
	var body LuggageDTO
	if err := c.ShouldBindJSON(&body); err != nil {
		respondErr(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	if err := h.luggageRepo().Upsert(c.Request.Context(), rideID, uid, body); err != nil {
		respondErr(c, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	respond(c, http.StatusOK, gin.H{"configured": true})
}

// GetLuggage handles GET /api/v1/rides/:id/luggage.
func (h *Handler) GetLuggage(c *gin.Context) {
	rideID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondErr(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid ride ID")
		return
	}
	out, err := h.luggageRepo().Find(c.Request.Context(), rideID)
	if err != nil {
		respondErr(c, http.StatusNotFound, "NOT_FOUND", "Luggage not declared")
		return
	}
	respond(c, http.StatusOK, out)
}

// ===========================================================================
// Pool endpoints
// ===========================================================================

// DetectPools handles GET /api/v1/pools/detect.
func (h *Handler) DetectPools(c *gin.Context) {
	campusID, err := uuid.Parse(c.Query("campus_id"))
	if err != nil {
		respondErr(c, http.StatusBadRequest, "BAD_REQUEST", "campus_id required")
		return
	}
	maxSeats := parseInt(c.DefaultQuery("max_seats", "3"), 3)
	plans, err := h.svc.PoolDetect(c.Request.Context(), campusID, maxSeats)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	respond(c, http.StatusOK, gin.H{"plans": plans})
}

// CreatePool handles POST /api/v1/pools.
func (h *Handler) CreatePool(c *gin.Context) {
	var in PoolCreateInput
	if err := c.ShouldBindJSON(&in); err != nil {
		respondErr(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	pool, err := h.pool.Create(c.Request.Context(), in)
	if err != nil {
		respondErr(c, http.StatusBadRequest, "POOL_FAILED", err.Error())
		return
	}
	respond(c, http.StatusCreated, pool)
}

// GetPool handles GET /api/v1/pools/:id.
func (h *Handler) GetPool(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondErr(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid pool id")
		return
	}
	pool, err := h.pool.FindByID(c.Request.Context(), id)
	if err != nil {
		respondErr(c, http.StatusNotFound, "NOT_FOUND", "Pool not found")
		return
	}
	members, err := h.pool.Members(c.Request.Context(), id)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	respond(c, http.StatusOK, gin.H{"pool": pool, "members": members})
}

// AssignPoolDriver handles POST /api/v1/pools/:id/driver.
func (h *Handler) AssignPoolDriver(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondErr(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid pool id")
		return
	}
	var body struct {
		DriverID  string `json:"driver_id"`
		VehicleID string `json:"vehicle_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		respondErr(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	driverID, _ := uuid.Parse(body.DriverID)
	vehicleID, _ := uuid.Parse(body.VehicleID)
	if err := h.pool.AssignDriver(c.Request.Context(), id, driverID, vehicleID); err != nil {
		respondErr(c, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	respond(c, http.StatusOK, gin.H{"dispatched": true})
}

// CancelPool handles POST /api/v1/pools/:id/cancel.
func (h *Handler) CancelPool(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondErr(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid pool id")
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&body)
	if err := h.pool.Cancel(c.Request.Context(), id, body.Reason); err != nil {
		respondErr(c, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	respond(c, http.StatusOK, gin.H{"cancelled": true})
}

// ===========================================================================
// Driver profile endpoints (delegated to driver module via the repo)
// ===========================================================================

// RegisterDriver handles POST /api/v1/drivers/register.
func (h *Handler) RegisterDriver(c *gin.Context) {
	respond(c, http.StatusNotImplemented, gin.H{
		"note": "delegate to driver.Handler.Register",
	})
}

// GetDriver handles GET /api/v1/drivers/me.
func (h *Handler) GetDriver(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// UpdateDriver handles PATCH /api/v1/drivers/me.
func (h *Handler) UpdateDriver(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// UpdateLocation handles POST /api/v1/drivers/me/location.
func (h *Handler) UpdateLocation(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// ToggleAvailability handles POST /api/v1/drivers/me/availability.
func (h *Handler) ToggleAvailability(c *gin.Context) {
	respond(c, http.StatusNotImplemented, nil)
}

// GetDriverProfile handles GET /api/v1/drivers/:id/profile.
func (h *Handler) GetDriverProfile(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// GetDriverRatings handles GET /api/v1/drivers/:id/ratings.
func (h *Handler) GetDriverRatings(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// ===========================================================================
// Vehicle endpoints
// ===========================================================================

// RegisterVehicle handles POST /api/v1/vehicles.
func (h *Handler) RegisterVehicle(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// ListMyVehicles handles GET /api/v1/vehicles/me.
func (h *Handler) ListMyVehicles(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// UpdateVehicle handles PATCH /api/v1/vehicles/:id.
func (h *Handler) UpdateVehicle(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// SubmitVehicleScan handles POST /api/v1/vehicles/:id/scan.
func (h *Handler) SubmitVehicleScan(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// ListVehicleScans handles GET /api/v1/vehicles/:id/scans.
func (h *Handler) ListVehicleScans(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// LogMaintenance handles POST /api/v1/vehicles/:id/maintenance.
func (h *Handler) LogMaintenance(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// ListMaintenance handles GET /api/v1/vehicles/:id/maintenance.
func (h *Handler) ListMaintenance(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// ===========================================================================
// Payment endpoints (delegated to payment module)
// ===========================================================================

// ProcessPayment handles POST /api/v1/payments/process.
func (h *Handler) ProcessPayment(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// RefundPayment handles POST /api/v1/payments/:id/refund.
func (h *Handler) RefundPayment(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// VerifyCodOtp handles POST /api/v1/payments/cod/verify.
func (h *Handler) VerifyCodOtp(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// RequestCodOtp handles POST /api/v1/payments/cod/request.
func (h *Handler) RequestCodOtp(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// ===========================================================================
// SOS & Incidents
// ===========================================================================

// TriggerSos handles POST /api/v1/sos/trigger.
func (h *Handler) TriggerSos(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// AcknowledgeSos handles POST /api/v1/sos/:id/acknowledge.
func (h *Handler) AcknowledgeSos(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// ResolveSos handles POST /api/v1/sos/:id/resolve.
func (h *Handler) ResolveSos(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// ListActiveSos handles GET /api/v1/sos/active.
func (h *Handler) ListActiveSos(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// FileIncident handles POST /api/v1/incidents.
func (h *Handler) FileIncident(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// GetIncident handles GET /api/v1/incidents/:id.
func (h *Handler) GetIncident(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// UpdateIncident handles PATCH /api/v1/incidents/:id.
func (h *Handler) UpdateIncident(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// ===========================================================================
// Places, Skins, Deployments, Curators, Rewards (delegated to sub-modules)
// ===========================================================================

// ListPlaces handles GET /api/v1/places.
func (h *Handler) ListPlaces(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// ListPopularPlaces handles GET /api/v1/places/popular.
func (h *Handler) ListPopularPlaces(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// SaveUserPlace handles POST /api/v1/places/user.
func (h *Handler) SaveUserPlace(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// ListUserPlaces handles GET /api/v1/places/user.
func (h *Handler) ListUserPlaces(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// DeleteUserPlace handles DELETE /api/v1/places/user/:id.
func (h *Handler) DeleteUserPlace(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// ApplySkin handles POST /api/v1/skins/apply.
func (h *Handler) ApplySkin(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// ListSkins handles GET /api/v1/skins.
func (h *Handler) ListSkins(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// CreateDeployment handles POST /api/v1/deployments.
func (h *Handler) CreateDeployment(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// ListDeployments handles GET /api/v1/deployments.
func (h *Handler) ListDeployments(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// StartDeployment handles POST /api/v1/deployments/:id/start.
func (h *Handler) StartDeployment(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// CompleteDeployment handles POST /api/v1/deployments/:id/complete.
func (h *Handler) CompleteDeployment(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// CuratorCheckIn handles POST /api/v1/curators/check-in.
func (h *Handler) CuratorCheckIn(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// CuratorCheckOut handles POST /api/v1/curators/check-out.
func (h *Handler) CuratorCheckOut(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// CuratorBreak handles POST /api/v1/curators/break.
func (h *Handler) CuratorBreak(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// Leaderboard handles GET /api/v1/curators/leaderboard.
func (h *Handler) Leaderboard(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// MyRewards handles GET /api/v1/rewards/me.
func (h *Handler) MyRewards(c *gin.Context) { respond(c, http.StatusNotImplemented, nil) }

// ===========================================================================
// Helpers
// ===========================================================================

// LuggageDTO is the HTTP payload for luggage configuration.
type LuggageDTO struct {
	Pieces        int                  `json:"pieces"`
	TotalWeightKg *float64             `json:"total_weight_kg,omitempty"`
	SizeBreakdown []LuggageSizeEntry   `json:"size_breakdown"`
	Fragile       bool                 `json:"fragile"`
	RequiresBoots bool                 `json:"requires_boots"`
	Assistance    bool                 `json:"assistance"`
	Notes         string               `json:"notes"`
}

// LuggageSizeEntry mirrors the persisted size_breakdown row.
type LuggageSizeEntry struct {
	Size  string `json:"size"`
	Count int    `json:"count"`
}

// luggageRepo is a small helper that returns the singleton
// LuggageRepository inside the ride package. Defined in luggage.go.
func (h *Handler) luggageRepo() *LuggageRepository {
	return DefaultLuggageRepository(h.svc.repo.pool)
}

// CouponID placeholder to satisfy service.applyCoupon signature
func (in RequestRideInput) CouponID() uuid.UUID { return uuid.Nil }

func (h *Handler) canAccessRide(c *gin.Context, ride *RideRequestRow) bool {
	user := middleware.GetUser(c)
	if user == nil {
		return false
	}
	uid, _ := uuid.Parse(user.ID)
	if ride.RiderID == uid {
		return true
	}
	if ride.DriverID != nil {
		drv, _ := h.svc.driverRepo.FindByID(c.Request.Context(), *ride.DriverID)
		if drv != nil && drv.UserID == uid {
			return true
		}
	}
	if user.Role == "campus_admin" || user.Role == "super_admin" || user.Role == "moderator" {
		return true
	}
	return false
}

func parseInt(s string, def int) int {
	if v, err := strconv.Atoi(s); err == nil {
		return v
	}
	return def
}

// Ensure imports are referenced.
var _ = middleware.GetUser

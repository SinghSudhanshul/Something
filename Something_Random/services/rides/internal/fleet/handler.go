package fleet

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"nexus/rides/internal/middleware"
)

// Handler exposes fleet HTTP endpoints.
type Handler struct {
	svc *Service
}

// NewHandler constructs a new fleet Handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// RegisterRoutes mounts all fleet routes on the provided router group.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler) {
	rg.GET("", h.ListVehicles)
	rg.POST("", h.RegisterVehicle)
	rg.GET("/overview", h.GetOverview)
	rg.GET("/skins", h.ListSkins)
	rg.POST("/skins", h.CreateSkin)

	rg.GET("/:id", h.GetVehicle)
	rg.PATCH("/:id", h.UpdateVehicle)
	rg.DELETE("/:id", h.RetireVehicle)
	rg.POST("/:id/assign", h.AssignDriver)
	rg.POST("/:id/service", h.LogService)
	rg.GET("/:id/service-log", h.GetServiceLog)
	rg.GET("/:id/telemetry", h.GetTelemetry)
	rg.POST("/:id/telemetry", h.RecordTelemetry)
	rg.GET("/:id/diagnostics", h.RunDiagnostics)
	rg.POST("/:id/skin", h.ApplySkin)
}

// ---------------------------------------------------------------------------
// Vehicle endpoints
// ---------------------------------------------------------------------------

// ListVehicles handles GET /fleet?campus_id=&status=&vehicle_type=&limit=&cursor=
func (h *Handler) ListVehicles(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "authentication required"})
		return
	}

	filters := VehicleListFilters{}

	if campusStr := c.Query("campus_id"); campusStr != "" {
		parsed, err := uuid.Parse(campusStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_CAMPUS_ID", "message": "invalid campus_id format"})
			return
		}
		filters.CampusID = &parsed
	}

	if status := c.Query("status"); status != "" {
		if !ValidVehicleStatuses[status] {
			c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_STATUS", "message": "invalid status value"})
			return
		}
		filters.Status = &status
	}

	if vType := c.Query("vehicle_type"); vType != "" {
		filters.VehicleType = &vType
	}

	if limitStr := c.Query("limit"); limitStr != "" {
		limit, err := strconv.Atoi(limitStr)
		if err != nil || limit < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_LIMIT", "message": "limit must be a positive integer"})
			return
		}
		filters.Limit = limit
	} else {
		filters.Limit = 25
	}

	if cursorStr := c.Query("cursor"); cursorStr != "" {
		parsed, err := uuid.Parse(cursorStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_CURSOR", "message": "invalid cursor format"})
			return
		}
		filters.Cursor = &parsed
	}

	vehicles, err := h.svc.ListVehicles(c.Request.Context(), filters)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": "failed to list vehicles"})
		return
	}

	responses := make([]VehicleResponse, 0, len(vehicles))
	for i := range vehicles {
		responses = append(responses, vehicles[i].ToResponse())
	}

	var nextCursor *string
	if len(vehicles) == filters.Limit {
		last := vehicles[len(vehicles)-1].ID.String()
		nextCursor = &last
	}

	c.JSON(http.StatusOK, gin.H{
		"data":        responses,
		"next_cursor": nextCursor,
	})
}

// RegisterVehicle handles POST /fleet
func (h *Handler) RegisterVehicle(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "authentication required"})
		return
	}

	var input RegisterVehicleInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_INPUT", "message": err.Error()})
		return
	}

	vehicle, err := h.svc.RegisterVehicle(c.Request.Context(), input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"data": vehicle.ToResponse()})
}

// GetVehicle handles GET /fleet/:id
func (h *Handler) GetVehicle(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "authentication required"})
		return
	}

	vehicleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_ID", "message": "invalid vehicle id"})
		return
	}

	vehicle, err := h.svc.GetVehicle(c.Request.Context(), vehicleID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "vehicle not found"})
		return
	}

	resp := vehicle.ToResponse()

	// Attach latest telemetry if available.
	telemetry, err := h.svc.GetLatestTelemetry(c.Request.Context(), vehicleID)
	if err == nil && telemetry != nil {
		resp.LatestTelemetry = telemetry
	}

	c.JSON(http.StatusOK, gin.H{"data": resp})
}

// UpdateVehicle handles PATCH /fleet/:id
func (h *Handler) UpdateVehicle(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "authentication required"})
		return
	}

	vehicleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_ID", "message": "invalid vehicle id"})
		return
	}

	var input UpdateVehicleInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_INPUT", "message": err.Error()})
		return
	}

	updated, err := h.svc.UpdateVehicle(c.Request.Context(), vehicleID, input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": updated.ToResponse()})
}

// RetireVehicle handles DELETE /fleet/:id
func (h *Handler) RetireVehicle(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "authentication required"})
		return
	}

	vehicleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_ID", "message": "invalid vehicle id"})
		return
	}

	if err := h.svc.RetireVehicle(c.Request.Context(), vehicleID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{"message": "vehicle retired successfully"}})
}

// ---------------------------------------------------------------------------
// Driver assignment
// ---------------------------------------------------------------------------

// AssignDriver handles POST /fleet/:id/assign
func (h *Handler) AssignDriver(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "authentication required"})
		return
	}

	vehicleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_ID", "message": "invalid vehicle id"})
		return
	}

	var body struct {
		DriverID string `json:"driver_id" binding:"required,uuid"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_INPUT", "message": err.Error()})
		return
	}

	driverID, err := uuid.Parse(body.DriverID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_DRIVER_ID", "message": "invalid driver_id format"})
		return
	}

	if err := h.svc.AssignDriverToVehicle(c.Request.Context(), vehicleID, driverID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{"message": "driver assigned successfully"}})
}

// ---------------------------------------------------------------------------
// Service logs
// ---------------------------------------------------------------------------

// LogService handles POST /fleet/:id/service
func (h *Handler) LogService(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "authentication required"})
		return
	}

	vehicleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_ID", "message": "invalid vehicle id"})
		return
	}

	var input CreateServiceLogInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_INPUT", "message": err.Error()})
		return
	}

	if input.Cost < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_COST", "message": "cost must be non-negative"})
		return
	}

	log, err := h.svc.LogService(c.Request.Context(), vehicleID, input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"data": log})
}

// GetServiceLog handles GET /fleet/:id/service-log?limit=&cursor=
func (h *Handler) GetServiceLog(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "authentication required"})
		return
	}

	vehicleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_ID", "message": "invalid vehicle id"})
		return
	}

	limit := 25
	if limitStr := c.Query("limit"); limitStr != "" {
		parsed, err := strconv.Atoi(limitStr)
		if err != nil || parsed < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_LIMIT", "message": "limit must be a positive integer"})
			return
		}
		limit = parsed
	}

	var cursor *uuid.UUID
	if cursorStr := c.Query("cursor"); cursorStr != "" {
		parsed, err := uuid.Parse(cursorStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_CURSOR", "message": "invalid cursor format"})
			return
		}
		cursor = &parsed
	}

	logs, err := h.svc.GetServiceLogs(c.Request.Context(), vehicleID, limit, cursor)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": "failed to retrieve service logs"})
		return
	}

	var nextCursor *string
	if len(logs) == limit {
		last := logs[len(logs)-1].ID.String()
		nextCursor = &last
	}

	c.JSON(http.StatusOK, gin.H{
		"data":        logs,
		"next_cursor": nextCursor,
	})
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

// GetTelemetry handles GET /fleet/:id/telemetry?from=&to=&limit=
func (h *Handler) GetTelemetry(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "authentication required"})
		return
	}

	vehicleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_ID", "message": "invalid vehicle id"})
		return
	}

	ist, _ := time.LoadLocation("Asia/Kolkata")
	now := time.Now().In(ist)

	fromStr := c.Query("from")
	toStr := c.Query("to")

	var from, to time.Time
	if fromStr != "" {
		from, err = time.ParseInLocation(time.RFC3339, fromStr, ist)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_FROM", "message": "from must be RFC3339 format"})
			return
		}
	} else {
		from = now.Add(-24 * time.Hour)
	}

	if toStr != "" {
		to, err = time.ParseInLocation(time.RFC3339, toStr, ist)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_TO", "message": "to must be RFC3339 format"})
			return
		}
	} else {
		to = now
	}

	if to.Before(from) {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_RANGE", "message": "to must be after from"})
		return
	}

	limit := 100
	if limitStr := c.Query("limit"); limitStr != "" {
		parsed, err := strconv.Atoi(limitStr)
		if err != nil || parsed < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_LIMIT", "message": "limit must be a positive integer"})
			return
		}
		limit = parsed
	}

	records, err := h.svc.GetTelemetryHistory(c.Request.Context(), vehicleID, from, to, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": "failed to retrieve telemetry"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": records})
}

// RecordTelemetry handles POST /fleet/:id/telemetry
func (h *Handler) RecordTelemetry(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "authentication required"})
		return
	}

	vehicleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_ID", "message": "invalid vehicle id"})
		return
	}

	var input RecordTelemetryInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_INPUT", "message": err.Error()})
		return
	}

	// Validate coordinate ranges if provided.
	if input.Lat != nil && (*input.Lat < -90 || *input.Lat > 90) {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_LAT", "message": "latitude must be between -90 and 90"})
		return
	}
	if input.Lng != nil && (*input.Lng < -180 || *input.Lng > 180) {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_LNG", "message": "longitude must be between -180 and 180"})
		return
	}

	telemetry, err := h.svc.RecordTelemetry(c.Request.Context(), vehicleID, input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"data": telemetry})
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

// RunDiagnostics handles GET /fleet/:id/diagnostics
func (h *Handler) RunDiagnostics(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "authentication required"})
		return
	}

	vehicleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_ID", "message": "invalid vehicle id"})
		return
	}

	report, err := h.svc.RunDiagnostics(c.Request.Context(), vehicleID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": report})
}

// ---------------------------------------------------------------------------
// Skins
// ---------------------------------------------------------------------------

// ListSkins handles GET /fleet/skins?campus_id=
func (h *Handler) ListSkins(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "authentication required"})
		return
	}

	var campusID *uuid.UUID
	if campusStr := c.Query("campus_id"); campusStr != "" {
		parsed, err := uuid.Parse(campusStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_CAMPUS_ID", "message": "invalid campus_id format"})
			return
		}
		campusID = &parsed
	}

	skins, err := h.svc.ListSkins(c.Request.Context(), campusID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": "failed to list skins"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": skins})
}

// CreateSkin handles POST /fleet/skins
func (h *Handler) CreateSkin(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "authentication required"})
		return
	}

	var input CreateSkinInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_INPUT", "message": err.Error()})
		return
	}

	skin, err := h.svc.CreateSkin(c.Request.Context(), input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"data": skin})
}

// ApplySkin handles POST /fleet/:id/skin
func (h *Handler) ApplySkin(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "authentication required"})
		return
	}

	vehicleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_ID", "message": "invalid vehicle id"})
		return
	}

	var body struct {
		SkinID string `json:"skin_id" binding:"required,uuid"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_INPUT", "message": err.Error()})
		return
	}

	skinID, err := uuid.Parse(body.SkinID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_SKIN_ID", "message": "invalid skin_id format"})
		return
	}

	if err := h.svc.ApplySkinToVehicle(c.Request.Context(), vehicleID, skinID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{"message": "skin applied successfully"}})
}

// ---------------------------------------------------------------------------
// Fleet overview
// ---------------------------------------------------------------------------

// GetOverview handles GET /fleet/overview?campus_id=
func (h *Handler) GetOverview(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "authentication required"})
		return
	}

	campusStr := c.Query("campus_id")
	if campusStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "MISSING_CAMPUS_ID", "message": "campus_id query parameter is required"})
		return
	}

	campusID, err := uuid.Parse(campusStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_CAMPUS_ID", "message": "invalid campus_id format"})
		return
	}

	overview, err := h.svc.GetFleetOverview(c.Request.Context(), campusID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": "failed to generate fleet overview"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": overview})
}

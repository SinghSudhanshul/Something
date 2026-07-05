package curator

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"nexus/rides/internal/middleware"
)

// Handler wraps curator HTTP endpoints.
type Handler struct {
	svc *Service
}

// NewHandler creates a new curator handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// RegisterRoutes registers all curator routes on the given router group.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler) {
	rg.POST("/shifts/start", middleware.Auth(), h.StartShift)
	rg.POST("/shifts/end", middleware.Auth(), h.EndShift)
	rg.GET("/shifts/active", middleware.Auth(), h.GetActiveShift)
	rg.GET("/shifts/history", middleware.Auth(), h.GetShiftHistory)
	rg.GET("/shifts/:id/summary", middleware.Auth(), h.GetShiftSummary)
	rg.GET("/analytics", middleware.Auth(), h.GetAnalytics)
	rg.GET("/leaderboard", middleware.Auth(), h.GetLeaderboard)
	rg.GET("/badges", middleware.Auth(), h.GetBadges)
	rg.GET("/earnings/projection", middleware.Auth(), h.GetEarningsProjection)
	rg.GET("/tribe", middleware.Auth(), h.GetTribe)
	rg.GET("/settings", middleware.Auth(), h.GetSettings)
	rg.PATCH("/settings", middleware.Auth(), h.UpdateSettings)
}

func (h *Handler) StartShift(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
		return
	}
	var body struct {
		Lat *float64 `json:"lat"`
		Lng *float64 `json:"lng"`
	}
	_ = c.ShouldBindJSON(&body)
	driverID, _ := uuid.Parse(user.ID)
	campusID, _ := uuid.Parse(user.CampusID)

	shift, err := h.svc.StartShift(c.Request.Context(), driverID, campusID, body.Lat, body.Lng)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "SHIFT_START_FAILED", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": shift})
}

func (h *Handler) EndShift(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
		return
	}
	var body struct {
		Lat   *float64 `json:"lat"`
		Lng   *float64 `json:"lng"`
		Notes *string  `json:"notes"`
	}
	_ = c.ShouldBindJSON(&body)
	driverID, _ := uuid.Parse(user.ID)

	shift, err := h.svc.EndShift(c.Request.Context(), driverID, body.Lat, body.Lng, body.Notes)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "SHIFT_END_FAILED", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": shift})
}

func (h *Handler) GetActiveShift(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
		return
	}
	driverID, _ := uuid.Parse(user.ID)
	shift, err := h.svc.GetActiveShift(c.Request.Context(), driverID)
	if err != nil || shift == nil {
		c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "No active shift"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": shift})
}

func (h *Handler) GetShiftHistory(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
		return
	}
	driverID, _ := uuid.Parse(user.ID)
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	var cursor *string
	if cur := c.Query("cursor"); cur != "" {
		cursor = &cur
	}

	shifts, err := h.svc.GetShiftHistory(c.Request.Context(), driverID, limit, cursor)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": shifts, "count": len(shifts)})
}

func (h *Handler) GetShiftSummary(c *gin.Context) {
	shiftID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": "Invalid shift ID"})
		return
	}
	shift, err := h.svc.GetShiftSummary(c.Request.Context(), shiftID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "Shift not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": shift})
}

func (h *Handler) GetAnalytics(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
		return
	}
	driverID, _ := uuid.Parse(user.ID)
	period := c.DefaultQuery("period", "weekly")

	analytics, err := h.svc.GetAnalytics(c.Request.Context(), driverID, period)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": analytics})
}

func (h *Handler) GetLeaderboard(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
		return
	}
	campusID, _ := uuid.Parse(user.CampusID)
	metric := c.DefaultQuery("metric", "rides")
	period := c.DefaultQuery("period", "weekly")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "10"))

	entries, err := h.svc.GetLeaderboard(c.Request.Context(), campusID, metric, period, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": entries, "count": len(entries)})
}

func (h *Handler) GetBadges(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
		return
	}
	driverID, _ := uuid.Parse(user.ID)
	badges, err := h.svc.GetBadges(c.Request.Context(), driverID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": badges, "count": len(badges)})
}

func (h *Handler) GetEarningsProjection(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
		return
	}
	driverID, _ := uuid.Parse(user.ID)
	projection, err := h.svc.GetEarningsProjection(c.Request.Context(), driverID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": projection})
}

func (h *Handler) GetTribe(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
		return
	}
	driverID, _ := uuid.Parse(user.ID)
	campusID, _ := uuid.Parse(user.CampusID)
	members, err := h.svc.GetTribeMembers(c.Request.Context(), driverID, campusID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": members, "count": len(members)})
}

func (h *Handler) GetSettings(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
		return
	}
	driverID, _ := uuid.Parse(user.ID)
	settings, err := h.svc.GetSettings(c.Request.Context(), driverID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "Settings not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": settings})
}

func (h *Handler) UpdateSettings(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
		return
	}
	var input UpdateSettingsInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": err.Error()})
		return
	}
	driverID, _ := uuid.Parse(user.ID)
	settings, err := h.svc.UpdateSettings(c.Request.Context(), driverID, input)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "UPDATE_FAILED", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": settings})
}

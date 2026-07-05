package admin

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"nexus/rides/internal/middleware"
)

// Handler wraps admin dashboard HTTP endpoints.
type Handler struct {
	svc *Service
}

// NewHandler creates a new admin handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// RegisterRoutes registers all admin routes on the given router group.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler) {
	rg.GET("/dashboard", middleware.Auth(), middleware.RequireRoles("campus_admin", "super_admin"), h.GetDashboard)
	rg.GET("/revenue", middleware.Auth(), middleware.RequireRoles("campus_admin", "super_admin"), h.GetRevenue)
	rg.GET("/health", middleware.Auth(), middleware.RequireRoles("campus_admin", "super_admin"), h.GetHealth)
	rg.GET("/curators", middleware.Auth(), middleware.RequireRoles("campus_admin", "super_admin"), h.ListCurators)
	rg.GET("/curators/:id", middleware.Auth(), middleware.RequireRoles("campus_admin", "super_admin"), h.GetCuratorDetail)
	rg.POST("/curators/:id/approve", middleware.Auth(), middleware.RequireRoles("super_admin"), h.ApproveCurator)
	rg.POST("/curators/:id/suspend", middleware.Auth(), middleware.RequireRoles("campus_admin", "super_admin"), h.SuspendCurator)
	rg.GET("/audit-logs", middleware.Auth(), middleware.RequireRoles("campus_admin", "super_admin"), h.GetAuditLogs)
	rg.GET("/heatmap", middleware.Auth(), middleware.RequireRoles("campus_admin", "super_admin"), h.GetHeatmap)
	rg.GET("/heatmap/prediction", middleware.Auth(), middleware.RequireRoles("campus_admin", "super_admin"), h.GetPredictedDemand)
	rg.GET("/reports/daily", middleware.Auth(), middleware.RequireRoles("campus_admin", "super_admin"), h.GetDailyReport)
	rg.GET("/reports/campus/:id", middleware.Auth(), middleware.RequireRoles("campus_admin", "super_admin"), h.GetCampusReport)
}

// GetDashboard returns real-time command center stats.
func (h *Handler) GetDashboard(c *gin.Context) {
	stats, err := h.svc.GetCommandCenterStats(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": stats})
}

// GetRevenue returns revenue analytics.
func (h *Handler) GetRevenue(c *gin.Context) {
	period := c.DefaultQuery("period", "daily")
	var campusID *string
	if cid := c.Query("campus_id"); cid != "" {
		campusID = &cid
	}
	pulse, err := h.svc.GetRevenuePulse(c.Request.Context(), period, campusID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": pulse})
}

// GetHealth returns system health metrics.
func (h *Handler) GetHealth(c *gin.Context) {
	health, err := h.svc.GetSystemHealth(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": health})
}

// ListCurators returns paginated curator list.
func (h *Handler) ListCurators(c *gin.Context) {
	var campusID, cursor *string
	if cid := c.Query("campus_id"); cid != "" {
		campusID = &cid
	}
	if cur := c.Query("cursor"); cur != "" {
		cursor = &cur
	}
	var verified, available *bool
	if v := c.Query("verified"); v != "" {
		bv := v == "true"
		verified = &bv
	}
	if a := c.Query("available"); a != "" {
		ba := a == "true"
		available = &ba
	}
	search := c.Query("search")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))

	curators, total, err := h.svc.ListCurators(c.Request.Context(), campusID, verified, available, search, limit, cursor)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": curators, "total": total})
}

// GetCuratorDetail returns detailed curator information.
func (h *Handler) GetCuratorDetail(c *gin.Context) {
	detail, err := h.svc.GetCuratorDetail(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "Curator not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": detail})
}

// ApproveCurator approves a curator application.
func (h *Handler) ApproveCurator(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
		return
	}
	if err := h.svc.ApproveCurator(c.Request.Context(), c.Param("id"), user.ID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "APPROVE_FAILED", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"status": "approved"}})
}

// SuspendCurator suspends a curator.
func (h *Handler) SuspendCurator(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
		return
	}
	var body struct {
		Reason string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": err.Error()})
		return
	}
	if err := h.svc.SuspendCurator(c.Request.Context(), c.Param("id"), body.Reason, user.ID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "SUSPEND_FAILED", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"status": "suspended"}})
}

// GetAuditLogs returns paginated audit logs.
func (h *Handler) GetAuditLogs(c *gin.Context) {
	var action, resourceType, actorID, cursor *string
	if a := c.Query("action"); a != "" {
		action = &a
	}
	if rt := c.Query("resource_type"); rt != "" {
		resourceType = &rt
	}
	if ai := c.Query("actor_id"); ai != "" {
		actorID = &ai
	}
	if cur := c.Query("cursor"); cur != "" {
		cursor = &cur
	}
	var from, to *time.Time
	if f := c.Query("from"); f != "" {
		t, _ := time.Parse(time.RFC3339, f)
		from = &t
	}
	if t := c.Query("to"); t != "" {
		parsed, _ := time.Parse(time.RFC3339, t)
		to = &parsed
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))

	logs, err := h.svc.GetAuditLogs(c.Request.Context(), action, resourceType, actorID, from, to, limit, cursor)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": logs, "count": len(logs)})
}

// GetHeatmap returns demand heatmap data.
func (h *Handler) GetHeatmap(c *gin.Context) {
	campusID := c.Query("campus_id")
	if campusID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": "campus_id required"})
		return
	}
	var from, to *time.Time
	if f := c.Query("from"); f != "" {
		t, _ := time.Parse(time.RFC3339, f)
		from = &t
	}
	if t := c.Query("to"); t != "" {
		parsed, _ := time.Parse(time.RFC3339, t)
		to = &parsed
	}
	cells, err := h.svc.GetDemandHeatmap(c.Request.Context(), campusID, from, to)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": cells, "count": len(cells)})
}

// GetPredictedDemand returns predicted demand heatmap.
func (h *Handler) GetPredictedDemand(c *gin.Context) {
	campusID := c.Query("campus_id")
	if campusID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": "campus_id required"})
		return
	}
	cells, err := h.svc.GetPredictedDemand(c.Request.Context(), campusID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": cells, "count": len(cells)})
}

// GetDailyReport returns daily operations report.
func (h *Handler) GetDailyReport(c *gin.Context) {
	date := c.DefaultQuery("date", time.Now().Format("2006-01-02"))
	report, err := h.svc.GenerateDailyReport(c.Request.Context(), date)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": report})
}

// GetCampusReport returns campus-specific report.
func (h *Handler) GetCampusReport(c *gin.Context) {
	date := c.DefaultQuery("date", time.Now().Format("2006-01-02"))
	report, err := h.svc.GenerateCampusReport(c.Request.Context(), c.Param("id"), date)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": report})
}

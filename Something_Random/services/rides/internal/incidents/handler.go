package incidents

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"nexus/rides/internal/middleware"
)

// Handler wraps incident management HTTP endpoints.
type Handler struct {
	svc *Service
}

// NewHandler creates a new incidents handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Response is the envelope.
type Response struct {
	Data  any       `json:"data,omitempty"`
	Error *ErrorBdy `json:"error,omitempty"`
	Meta  Meta      `json:"meta"`
}

type ErrorBdy struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type Meta struct {
	RequestID string `json:"request_id"`
	Timestamp int64  `json:"timestamp"`
}

func envelope(c *gin.Context, data any) Response {
	return Response{Data: data, Meta: Meta{RequestID: c.GetHeader("X-Request-ID"), Timestamp: time.Now().Unix()}}
}

func errorResp(c *gin.Context, status int, code, msg string) {
	c.JSON(status, Response{Error: &ErrorBdy{Code: code, Message: msg}, Meta: Meta{RequestID: c.GetHeader("X-Request-ID"), Timestamp: time.Now().Unix()}})
}

// RegisterRoutes registers all incident routes.
func RegisterRoutes(adminGroup, publicGroup *gin.RouterGroup, h *Handler) {
	// Admin endpoints
	adminGroup.GET("", middleware.Auth(), middleware.RequireRoles("campus_admin", "super_admin"), h.ListIncidents)
	adminGroup.GET("/:id", middleware.Auth(), middleware.RequireRoles("campus_admin", "super_admin"), h.GetIncident)
	adminGroup.PATCH("/:id", middleware.Auth(), middleware.RequireRoles("campus_admin", "super_admin"), h.UpdateIncident)
	adminGroup.POST("/:id/resolve", middleware.Auth(), middleware.RequireRoles("campus_admin", "super_admin"), h.ResolveIncident)
	adminGroup.POST("/:id/escalate", middleware.Auth(), middleware.RequireRoles("campus_admin", "super_admin"), h.EscalateIncident)
	adminGroup.POST("/:id/dismiss", middleware.Auth(), middleware.RequireRoles("campus_admin", "super_admin"), h.DismissIncident)
	adminGroup.GET("/dashboard", middleware.Auth(), middleware.RequireRoles("campus_admin", "super_admin"), h.GetDashboard)
	adminGroup.GET("/safety-score", middleware.Auth(), middleware.RequireRoles("campus_admin", "super_admin"), h.GetSafetyScore)
	adminGroup.GET("/protocols", middleware.Auth(), h.GetProtocols)
	adminGroup.GET("/sla-overdue", middleware.Auth(), h.SLAOverdue)

	// Public endpoints (require auth only)
	publicGroup.POST("/report", middleware.Auth(), h.ReportIncident)
	publicGroup.GET("/driver/:id", middleware.Auth(), h.DriverSafety)
}

func parseUUID(s string) (uuid.UUID, error) {
	return uuid.Parse(s)
}

func (h *Handler) ListIncidents(c *gin.Context) {
	var status, severity, incType *string
	if s := c.Query("status"); s != "" {
		status = &s
	}
	if s := c.Query("severity"); s != "" {
		severity = &s
	}
	if t := c.Query("type"); t != "" {
		incType = &t
	}
	var campusID *uuid.UUID
	if cid := c.Query("campus_id"); cid != "" {
		id, err := parseUUID(cid)
		if err != nil {
			errorResp(c, http.StatusBadRequest, "BAD_REQUEST", "invalid campus_id")
			return
		}
		campusID = &id
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	rows, err := h.svc.ListIncidents(c.Request.Context(), status, severity, incType, campusID, limit)
	if err != nil {
		errorResp(c, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, gin.H{"items": rows, "count": len(rows)}))
}

func (h *Handler) GetIncident(c *gin.Context) {
	id, err := parseUUID(c.Param("id"))
	if err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", "invalid id")
		return
	}
	inc, err := h.svc.GetIncident(c.Request.Context(), id)
	if err != nil {
		errorResp(c, http.StatusNotFound, "NOT_FOUND", "incident not found")
		return
	}
	c.JSON(http.StatusOK, envelope(c, inc))
}

func (h *Handler) UpdateIncident(c *gin.Context) {
	id, err := parseUUID(c.Param("id"))
	if err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", "invalid id")
		return
	}
	var body UpdateIncidentInput
	if err := c.ShouldBindJSON(&body); err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	inc, err := h.svc.UpdateIncident(c.Request.Context(), id, body)
	if err != nil {
		errorResp(c, http.StatusInternalServerError, "UPDATE_FAILED", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, inc))
}

func (h *Handler) ResolveIncident(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		errorResp(c, http.StatusUnauthorized, "UNAUTHORIZED", "auth required")
		return
	}
	id, err := parseUUID(c.Param("id"))
	if err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", "invalid id")
		return
	}
	var body ResolveInput
	if err := c.ShouldBindJSON(&body); err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	resolvedBy, _ := uuid.Parse(user.ID)
	if err := h.svc.ResolveIncident(c.Request.Context(), id, resolvedBy, body.Note, body.ResolutionType); err != nil {
		errorResp(c, http.StatusBadRequest, "RESOLVE_FAILED", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, gin.H{"status": "resolved"}))
}

func (h *Handler) EscalateIncident(c *gin.Context) {
	id, err := parseUUID(c.Param("id"))
	if err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", "invalid id")
		return
	}
	var body EscalateInput
	if err := c.ShouldBindJSON(&body); err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	if err := h.svc.EscalateIncident(c.Request.Context(), id, body.EscalatedTo, body.Reason); err != nil {
		errorResp(c, http.StatusBadRequest, "ESCALATE_FAILED", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, gin.H{"status": "escalated"}))
}

func (h *Handler) DismissIncident(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		errorResp(c, http.StatusUnauthorized, "UNAUTHORIZED", "auth required")
		return
	}
	id, err := parseUUID(c.Param("id"))
	if err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", "invalid id")
		return
	}
	var body struct {
		Reason string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	dismissedBy, _ := uuid.Parse(user.ID)
	if err := h.svc.DismissIncident(c.Request.Context(), id, body.Reason, dismissedBy); err != nil {
		errorResp(c, http.StatusBadRequest, "DISMISS_FAILED", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, gin.H{"status": "dismissed"}))
}

func (h *Handler) GetDashboard(c *gin.Context) {
	var campusID *uuid.UUID
	if cid := c.Query("campus_id"); cid != "" {
		id, err := parseUUID(cid)
		if err != nil {
			errorResp(c, http.StatusBadRequest, "BAD_REQUEST", "invalid campus_id")
			return
		}
		campusID = &id
	}
	dash, err := h.svc.GetSafetyDashboard(c.Request.Context(), campusID)
	if err != nil {
		errorResp(c, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, dash))
}

func (h *Handler) GetSafetyScore(c *gin.Context) {
	cid := c.Query("campus_id")
	if cid == "" {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", "campus_id required")
		return
	}
	id, err := parseUUID(cid)
	if err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", "invalid campus_id")
		return
	}
	score, err := h.svc.GetSafetyScore(c.Request.Context(), id)
	if err != nil {
		errorResp(c, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, gin.H{"safety_score": score, "campus_id": cid}))
}

func (h *Handler) GetProtocols(c *gin.Context) {
	var campusID *uuid.UUID
	var category *string
	if cid := c.Query("campus_id"); cid != "" {
		id, err := parseUUID(cid)
		if err != nil {
			errorResp(c, http.StatusBadRequest, "BAD_REQUEST", "invalid campus_id")
			return
		}
		campusID = &id
	}
	if cat := c.Query("category"); cat != "" {
		category = &cat
	}
	protocols, err := h.svc.GetProtocols(c.Request.Context(), campusID, category)
	if err != nil {
		errorResp(c, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, gin.H{"items": protocols, "count": len(protocols)}))
}

func (h *Handler) ReportIncident(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		errorResp(c, http.StatusUnauthorized, "UNAUTHORIZED", "auth required")
		return
	}
	var input ReportIncidentInput
	if err := c.ShouldBindJSON(&input); err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	reportedBy, _ := uuid.Parse(user.ID)
	campusID := uuid.Nil
	if user.CampusID != "" {
		campusID, _ = uuid.Parse(user.CampusID)
	}
	role := "rider"
	if user.Role == "driver" {
		role = "driver"
	}
	inc, err := h.svc.ReportIncident(c.Request.Context(), input, reportedBy, campusID, role)
	if err != nil {
		errorResp(c, http.StatusBadRequest, "REPORT_FAILED", err.Error())
		return
	}
	c.JSON(http.StatusCreated, envelope(c, inc))
}

func (h *Handler) DriverSafety(c *gin.Context) {
	id, err := parseUUID(c.Param("id"))
	if err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", "invalid driver id")
		return
	}
	out, err := h.svc.DriverSafety(c.Request.Context(), id)
	if err != nil {
		errorResp(c, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, out))
}

func (h *Handler) SLAOverdue(c *gin.Context) {
	count, err := h.svc.SLAOverdue(c.Request.Context())
	if err != nil {
		errorResp(c, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, gin.H{"overdue_count": count}))
}
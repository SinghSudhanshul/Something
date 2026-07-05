package places

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"nexus/rides/internal/middleware"
)

// Handler exposes places + preferences HTTP endpoints.
type Handler struct {
	svc *Service
}

// NewHandler creates a new handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Response is the standard envelope.
type Response struct {
	Data  any       `json:"data,omitempty"`
	Error *ErrorBdy `json:"error,omitempty"`
}

type ErrorBdy struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func envelope(c *gin.Context, data any) Response {
	return Response{Data: data}
}

func errorResp(c *gin.Context, status int, code, msg string) {
	c.JSON(status, Response{Error: &ErrorBdy{Code: code, Message: msg}})
}

// RegisterRoutes wires endpoints onto the router group.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler) {
	// Saved places
	rg.GET("/places/saved", middleware.Auth(), h.GetSavedPlaces)
	rg.POST("/places/saved", middleware.Auth(), h.CreateSavedPlace)
	rg.PATCH("/places/saved/:id", middleware.Auth(), h.UpdateSavedPlace)
	rg.DELETE("/places/saved/:id", middleware.Auth(), h.DeleteSavedPlace)
	rg.POST("/places/saved/:id/use", middleware.Auth(), h.UsePlace)
	// Recent
	rg.GET("/places/recent", middleware.Auth(), h.GetRecentPlaces)
	// Suggestions / nearby
	rg.GET("/places/suggestions", middleware.Auth(), h.GetCampusSuggestions)
	rg.GET("/places/nearby", middleware.Auth(), h.FindNearby)
	rg.POST("/places/catalog", middleware.Auth(), h.UpsertCatalogEntry)
	// Preferences
	rg.GET("/preferences", middleware.Auth(), h.GetPreferences)
	rg.PUT("/preferences", middleware.Auth(), h.UpdatePreferences)
}

// GetSavedPlaces returns the user's saved places.
func (h *Handler) GetSavedPlaces(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		errorResp(c, http.StatusUnauthorized, "UNAUTHORIZED", "auth required")
		return
	}
	userID, _ := uuid.Parse(user.ID)
	places, err := h.svc.GetSavedPlaces(c.Request.Context(), userID)
	if err != nil {
		errorResp(c, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, gin.H{"items": places, "count": len(places)}))
}

// CreateSavedPlace adds a new saved place.
func (h *Handler) CreateSavedPlace(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		errorResp(c, http.StatusUnauthorized, "UNAUTHORIZED", "auth required")
		return
	}
	var input CreateSavedPlaceInput
	if err := c.ShouldBindJSON(&input); err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	input.UserID, _ = uuid.Parse(user.ID)
	p, err := h.svc.CreateSavedPlace(c.Request.Context(), input)
	if err != nil {
		errorResp(c, http.StatusBadRequest, "CREATE_FAILED", err.Error())
		return
	}
	c.JSON(http.StatusCreated, envelope(c, p))
}

// UpdateSavedPlace patches a saved place.
func (h *Handler) UpdateSavedPlace(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		errorResp(c, http.StatusUnauthorized, "UNAUTHORIZED", "auth required")
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", "invalid id")
		return
	}
	var input UpdateSavedPlaceInput
	if err := c.ShouldBindJSON(&input); err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	userID, _ := uuid.Parse(user.ID)
	p, err := h.svc.UpdateSavedPlace(c.Request.Context(), id, userID, input)
	if err != nil {
		errorResp(c, http.StatusInternalServerError, "UPDATE_FAILED", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, p))
}

// DeleteSavedPlace removes a saved place.
func (h *Handler) DeleteSavedPlace(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		errorResp(c, http.StatusUnauthorized, "UNAUTHORIZED", "auth required")
		return
	}
	id, _ := uuid.Parse(c.Param("id"))
	userID, _ := uuid.Parse(user.ID)
	if err := h.svc.DeleteSavedPlace(c.Request.Context(), id, userID); err != nil {
		errorResp(c, http.StatusNotFound, "NOT_FOUND", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, gin.H{"status": "deleted"}))
}

// UsePlace increments the usage count for a place.
func (h *Handler) UsePlace(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", "invalid id")
		return
	}
	if err := h.svc.UsePlace(c.Request.Context(), id); err != nil {
		errorResp(c, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, gin.H{"status": "recorded"}))
}

// GetRecentPlaces returns the user's recent dropoffs.
func (h *Handler) GetRecentPlaces(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		errorResp(c, http.StatusUnauthorized, "UNAUTHORIZED", "auth required")
		return
	}
	userID, _ := uuid.Parse(user.ID)
	rows, err := h.svc.GetRecentPlaces(c.Request.Context(), userID)
	if err != nil {
		errorResp(c, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, gin.H{"items": rows, "count": len(rows)}))
}

// GetCampusSuggestions returns popular POIs for the campus.
func (h *Handler) GetCampusSuggestions(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		errorResp(c, http.StatusUnauthorized, "UNAUTHORIZED", "auth required")
		return
	}
	campusID, _ := uuid.Parse(user.CampusID)
	if cid := c.Query("campus_id"); cid != "" {
		campusID, _ = uuid.Parse(cid)
	}
	rows, err := h.svc.GetCampusSuggestions(c.Request.Context(), campusID)
	if err != nil {
		errorResp(c, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, gin.H{"items": rows, "count": len(rows)}))
}

// FindNearby returns POIs near a point.
func (h *Handler) FindNearby(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		errorResp(c, http.StatusUnauthorized, "UNAUTHORIZED", "auth required")
		return
	}
	campusID, _ := uuid.Parse(user.CampusID)
	if cid := c.Query("campus_id"); cid != "" {
		campusID, _ = uuid.Parse(cid)
	}
	lat, _ := strconv.ParseFloat(c.Query("lat"), 64)
	lng, _ := strconv.ParseFloat(c.Query("lng"), 64)
	radius, _ := strconv.Atoi(c.DefaultQuery("radius_m", "1500"))
	if lat == 0 || lng == 0 {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", "lat and lng required")
		return
	}
	rows, err := h.svc.FindNearby(c.Request.Context(), campusID, lat, lng, radius)
	if err != nil {
		errorResp(c, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, gin.H{"items": rows, "count": len(rows)}))
}

// UpsertCatalogEntry adds a POI (admin only).
func (h *Handler) UpsertCatalogEntry(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		errorResp(c, http.StatusUnauthorized, "UNAUTHORIZED", "auth required")
		return
	}
	if !user.HasRole("campus_admin") && !user.HasRole("super_admin") {
		errorResp(c, http.StatusForbidden, "FORBIDDEN", "admin role required")
		return
	}
	var input CreateCampusPlaceInput
	if err := c.ShouldBindJSON(&input); err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	campusID, _ := uuid.Parse(user.CampusID)
	p, err := h.svc.UpsertCampusPlace(c.Request.Context(), input, campusID)
	if err != nil {
		errorResp(c, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	c.JSON(http.StatusCreated, envelope(c, p))
}

// GetPreferences returns ride preferences.
func (h *Handler) GetPreferences(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		errorResp(c, http.StatusUnauthorized, "UNAUTHORIZED", "auth required")
		return
	}
	userID, _ := uuid.Parse(user.ID)
	pref, err := h.svc.GetPreferences(c.Request.Context(), userID)
	if err != nil {
		errorResp(c, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, pref))
}

// UpdatePreferences upserts ride preferences.
func (h *Handler) UpdatePreferences(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		errorResp(c, http.StatusUnauthorized, "UNAUTHORIZED", "auth required")
		return
	}
	var input UpdatePreferencesInput
	if err := c.ShouldBindJSON(&input); err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	userID, _ := uuid.Parse(user.ID)
	pref, err := h.svc.UpdatePreferences(c.Request.Context(), userID, input)
	if err != nil {
		errorResp(c, http.StatusBadRequest, "UPDATE_FAILED", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, pref))
}
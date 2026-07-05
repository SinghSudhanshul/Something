package driver

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"nexus/rides/internal/middleware"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Register(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "Authentication required"})
		return
	}
	var input RegisterInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": err.Error()})
		return
	}
	userID, _ := uuid.Parse(user.ID)
	if input.CampusID == uuid.Nil {
		campusID, _ := uuid.Parse(user.CampusID)
		input.CampusID = campusID
	}
	driver, err := h.svc.RegisterAsDriver(c.Request.Context(), userID, user.VerificationLevel, input)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "REGISTRATION_FAILED", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": driver})
}

func (h *Handler) GetMe(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "Authentication required"})
		return
	}
	userID, _ := uuid.Parse(user.ID)
	driver, err := h.svc.GetProfile(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "Driver profile not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": driver})
}

func (h *Handler) UpdateAvailability(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "Authentication required"})
		return
	}
	var body struct {
		Available bool `json:"available"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": err.Error()})
		return
	}
	userID, _ := uuid.Parse(user.ID)
	driver, err := h.svc.GetProfile(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "Driver profile not found"})
		return
	}
	if err := h.svc.ToggleAvailability(c.Request.Context(), driver.ID, body.Available); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "AVAILABILITY_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"available": body.Available}})
}

func (h *Handler) UpdateLocation(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "Authentication required"})
		return
	}
	var body struct {
		Lat float64 `json:"lat"`
		Lng float64 `json:"lng"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": err.Error()})
		return
	}
	userID, _ := uuid.Parse(user.ID)
	driver, err := h.svc.GetProfile(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "Driver profile not found"})
		return
	}
	if err := h.svc.UpdateLocation(c.Request.Context(), driver.ID, body.Lat, body.Lng); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "LOCATION_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"lat": body.Lat, "lng": body.Lng}})
}

func (h *Handler) GetHistory(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "Authentication required"})
		return
	}
	userID, _ := uuid.Parse(user.ID)
	driver, err := h.svc.GetProfile(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "Driver profile not found"})
		return
	}
	rides, err := h.svc.GetHistory(c.Request.Context(), driver.ID, 20, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": "Failed to get history"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rides})
}

package ride

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

type Handler struct {
	repo   *Repository
	logger *zap.Logger
}

func NewHandler(repo *Repository, logger *zap.Logger) *Handler {
	return &Handler{repo: repo, logger: logger}
}

func (h *Handler) RequestRide(c *gin.Context) {
	var input struct {
		RiderID        string  `json:"rider_id"`
		PickupAddress  string  `json:"pickup_address"`
		DropoffAddress string  `json:"dropoff_address"`
		PickupLat      float64 `json:"pickup_lat"`
		PickupLng      float64 `json:"pickup_lng"`
		DropoffLat     float64 `json:"dropoff_lat"`
		DropoffLng     float64 `json:"dropoff_lng"`
	}

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	riderID, err := uuid.Parse(input.RiderID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid rider_id"})
		return
	}

	session := &RideSession{
		ID:             uuid.New(),
		RiderID:        riderID,
		Status:         "REQUESTED",
		PickupAddress:  input.PickupAddress,
		DropoffAddress: input.DropoffAddress,
		PickupLat:      input.PickupLat,
		PickupLng:      input.PickupLng,
		DropoffLat:     input.DropoffLat,
		DropoffLng:     input.DropoffLng,
	}

	if err := h.repo.CreateRide(c.Request.Context(), session); err != nil {
		h.logger.Error("failed to create ride", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create ride"})
		return
	}

	c.JSON(http.StatusCreated, session)
}

func (h *Handler) GetRide(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ride ID"})
		return
	}

	session, err := h.repo.GetRide(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ride not found"})
		return
	}

	c.JSON(http.StatusOK, session)
}

func (h *Handler) RegisterRoutes(router *gin.Engine) {
	api := router.Group("/api/v1/rides")
	{
		api.POST("/request", h.RequestRide)
		api.GET("/:id", h.GetRide)
	}
}

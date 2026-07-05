package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"nexus/wallet/internal/middleware"
	walletSvc "nexus/wallet/internal/wallet"
)

// Handler holds wallet HTTP handlers.
type Handler struct {
	service *walletSvc.Service
}

// NewHandler creates wallet handlers.
func NewHandler(service *walletSvc.Service) *Handler {
	return &Handler{service: service}
}

// RegisterRoutes registers all wallet HTTP routes.
func (h *Handler) RegisterRoutes(r *gin.Engine) {
	api := r.Group("/api/v1/wallet")
	api.Use(middleware.Auth())

	api.GET("/me", h.GetMyWallet)
	api.GET("/me/ledger", h.GetMyLedger)
}

// GetMyWallet returns the authenticated user's wallet.
func (h *Handler) GetMyWallet(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	userID, err := uuid.Parse(user.ID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	wallet, err := h.service.GetWallet(c.Request.Context(), userID)
	if err != nil {
		if err == walletSvc.ErrWalletNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "wallet not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": wallet.ToResponse()})
}

// GetMyLedger returns paginated ledger entries for the authenticated user.
func (h *Handler) GetMyLedger(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	userID, err := uuid.Parse(user.ID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if limit < 1 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	entries, err := h.service.GetLedger(c.Request.Context(), userID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data":   entries,
		"limit":  limit,
		"offset": offset,
	})
}

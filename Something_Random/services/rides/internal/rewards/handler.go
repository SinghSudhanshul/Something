package rewards

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"nexus/rides/internal/middleware"
)

// Handler wraps rewards HTTP endpoints.
type Handler struct {
	svc *Service
}

// NewHandler creates a new rewards handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// RegisterRoutes registers all reward routes.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler) {
	rg.GET("/balance", middleware.Auth(), h.GetBalance)
	rg.GET("/history", middleware.Auth(), h.GetHistory)
	rg.POST("/redeem", middleware.Auth(), h.RedeemPoints)
	rg.GET("/tiers", middleware.Auth(), h.GetTiers)
	rg.GET("/streaks", middleware.Auth(), h.GetStreaks)
	rg.GET("/challenges", middleware.Auth(), h.GetChallenges)
	rg.POST("/challenges/:id/claim", middleware.Auth(), h.ClaimChallenge)
	rg.GET("/referral", middleware.Auth(), h.GetReferral)
}

func (h *Handler) GetBalance(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
		return
	}
	userID, _ := uuid.Parse(user.ID)
	balance, err := h.svc.GetBalance(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": balance})
}

func (h *Handler) GetHistory(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
		return
	}
	userID, _ := uuid.Parse(user.ID)
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	var txType *string
	if t := c.Query("type"); t != "" {
		txType = &t
	}
	txns, err := h.svc.GetTransactionHistory(c.Request.Context(), userID, txType, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": txns, "count": len(txns)})
}

func (h *Handler) RedeemPoints(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
		return
	}
	var input RedeemInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": err.Error()})
		return
	}
	userID, _ := uuid.Parse(user.ID)
	discount, err := h.svc.RedeemPoints(c.Request.Context(), userID, input)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "REDEEM_FAILED", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"discount": discount, "currency": "INR", "points_used": input.Points}})
}

func (h *Handler) GetTiers(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
		return
	}
	userID, _ := uuid.Parse(user.ID)
	info, err := h.svc.GetTierInfo(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": info})
}

func (h *Handler) GetStreaks(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
		return
	}
	userID, _ := uuid.Parse(user.ID)
	info, err := h.svc.GetStreakInfo(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": info})
}

func (h *Handler) GetChallenges(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
		return
	}
	userID, _ := uuid.Parse(user.ID)
	challenges, err := h.svc.GetActiveChallenges(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}
	progress, _ := h.svc.GetChallengeProgress(c.Request.Context(), userID)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"challenges": challenges, "progress": progress}})
}

func (h *Handler) ClaimChallenge(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
		return
	}
	challengeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": "Invalid challenge ID"})
		return
	}
	userID, _ := uuid.Parse(user.ID)
	points, err := h.svc.ClaimChallengeReward(c.Request.Context(), userID, challengeID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "CLAIM_FAILED", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"points_awarded": points, "status": "claimed"}})
}

func (h *Handler) GetReferral(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED"})
		return
	}
	userID, _ := uuid.Parse(user.ID)
	info, err := h.svc.GetReferralInfo(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": info})
}

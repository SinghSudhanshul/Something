package payment

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"nexus/rides/internal/middleware"
)

// Handler exposes payment endpoints over HTTP.
type Handler struct {
	svc *Service
}

// NewHandler constructs a handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Response is the standard envelope.
type Response struct {
	Data  any       `json:"data,omitempty"`
	Error *ErrorBdy `json:"error,omitempty"`
	Meta  Meta      `json:"meta"`
}

// ErrorBdy contains error fields.
type ErrorBdy struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

// Meta carries non-error metadata.
type Meta struct {
	RequestID string `json:"request_id"`
	Timestamp int64  `json:"timestamp"`
}

// envelope builds a successful response.
func envelope(c *gin.Context, data any) Response {
	return Response{
		Data: data,
		Meta: Meta{
			RequestID: c.GetHeader("X-Request-ID"),
			Timestamp: time.Now().Unix(),
		},
	}
}

// errorResp builds an error response.
func errorResp(c *gin.Context, status int, code, msg string) {
	c.JSON(status, Response{
		Error: &ErrorBdy{Code: code, Message: msg},
		Meta: Meta{
			RequestID: c.GetHeader("X-Request-ID"),
			Timestamp: time.Now().Unix(),
		},
	})
}

// RegisterRoutes wires endpoints onto a router group.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler) {
	rg.GET("/methods", h.ListMethods)
	rg.POST("/authorize", middleware.Auth(), h.Authorize)
	rg.POST("/:id/capture", middleware.Auth(), h.Capture)
	rg.POST("/:id/refund", middleware.Auth(), h.Refund)
	rg.POST("/:id/fail", middleware.Auth(), h.Fail)
	rg.POST("/webhook", h.GatewayWebhook)
	rg.POST("/cod/request", middleware.Auth(), h.RequestCodOtp)
	rg.POST("/cod/verify", middleware.Auth(), h.VerifyCodOtp)
	rg.GET("/ride/:ride_id", middleware.Auth(), h.GetForRide)
	rg.GET("/history", middleware.Auth(), h.History)
	rg.GET("/stats", middleware.Auth(), h.Stats)
	rg.GET("/:id", middleware.Auth(), h.GetByID)
}

// ListMethods returns the catalogue of supported payment methods.
func (h *Handler) ListMethods(c *gin.Context) {
	methods := []map[string]any{}
	for _, m := range []struct {
		ID    string
		Label string
		Icon  string
	}{
		{"upi", "UPI", "UPI"},
		{"card", "Credit / Debit Card", "card"},
		{"wallet", "NEXUS Wallet", "wallet"},
		{"cod", "Cash on Delivery", "cash"},
		{"campus_card", "Campus Smart Card", "card"},
		{"net_banking", "Net Banking", "bank"},
	} {
		methods = append(methods, map[string]any{
			"id":         m.ID,
			"label":      m.Label,
			"icon":       m.Icon,
			"is_online":  m.ID != "cod",
			"is_default": false,
		})
	}
	c.JSON(http.StatusOK, envelope(c, methods))
}

// AuthorizeRequest is the body to authorize a payment.
type AuthorizeRequest struct {
	RideID           uuid.UUID `json:"ride_id"`
	RiderID          uuid.UUID `json:"rider_id"`
	DriverID         *uuid.UUID `json:"driver_id,omitempty"`
	Amount           decimal.Decimal `json:"amount"`
	Tax              decimal.Decimal `json:"tax"`
	Tip              decimal.Decimal `json:"tip"`
	PlatformFee      decimal.Decimal `json:"platform_fee"`
	Total            decimal.Decimal `json:"total"`
	Method           string    `json:"method"`
	GatewayOrderID   string    `json:"gateway_order_id"`
	GatewayPaymentID string    `json:"gateway_payment_id"`
}

// Authorize creates and authorizes a payment.
func (h *Handler) Authorize(c *gin.Context) {
	var req AuthorizeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	row, err := h.svc.Authorize(c.Request.Context(), CreatePaymentInput{
		RideID:         req.RideID,
		RiderID:        req.RiderID,
		DriverID:       req.DriverID,
		Amount:         req.Amount,
		Tax:            req.Tax,
		Tip:            req.Tip,
		PlatformFee:    req.PlatformFee,
		Total:          req.Total,
		Method:         req.Method,
		GatewayOrderID: req.GatewayOrderID,
	}, req.GatewayPaymentID)
	if err != nil {
		errorResp(c, http.StatusBadRequest, "AUTHORIZE_FAILED", err.Error())
		return
	}
	c.JSON(http.StatusCreated, envelope(c, row))
}

// Capture finalises a payment.
func (h *Handler) Capture(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", "invalid id")
		return
	}
	row, err := h.svc.Capture(c.Request.Context(), id)
	if err != nil {
		errorResp(c, http.StatusBadRequest, "CAPTURE_FAILED", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, row))
}

// RefundRequest is the body to refund.
type RefundRequest struct {
	Amount decimal.Decimal `json:"amount"`
	Reason string          `json:"reason"`
}

// Refund issues a refund.
func (h *Handler) Refund(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", "invalid id")
		return
	}
	var req RefundRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	row, err := h.svc.Refund(c.Request.Context(), id, req.Amount, req.Reason)
	if err != nil {
		errorResp(c, http.StatusBadRequest, "REFUND_FAILED", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, row))
}

// FailRequest is the body to mark failed.
type FailRequest struct {
	Reason string `json:"reason"`
}

// Fail marks a payment as failed.
func (h *Handler) Fail(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", "invalid id")
		return
	}
	var req FailRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	if err := h.svc.MarkFailed(c.Request.Context(), id, req.Reason); err != nil {
		errorResp(c, http.StatusInternalServerError, "FAIL_FAILED", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, gin.H{"status": "failed"}))
}

// GatewayWebhook handles inbound gateway notifications.
func (h *Handler) GatewayWebhook(c *gin.Context) {
	var gw GatewayWebhook
	if err := c.ShouldBindJSON(&gw); err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	if err := h.svc.HandleGatewayWebhook(c.Request.Context(), gw); err != nil {
		errorResp(c, http.StatusInternalServerError, "WEBHOOK_FAILED", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, gin.H{"status": "ok"}))
}

// RequestCodOtpRequest is the body for COD OTP generation.
type RequestCodOtpRequest struct {
	RideID   uuid.UUID `json:"ride_id"`
	RiderID  uuid.UUID `json:"rider_id"`
	DriverID uuid.UUID `json:"driver_id"`
}

// RequestCodOtp creates and returns the OTP for COD.
func (h *Handler) RequestCodOtp(c *gin.Context) {
	var req RequestCodOtpRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	otp, v, err := h.svc.RequestCodOtp(c.Request.Context(), req.RideID, req.RiderID, req.DriverID)
	if err != nil {
		errorResp(c, http.StatusInternalServerError, "OTP_FAILED", err.Error())
		return
	}
	// In production the OTP is sent over SMS / push; we return it for
	// local development.
	c.JSON(http.StatusOK, envelope(c, gin.H{
		"verification": v,
		"otp":          otp,
	}))
}

// VerifyCodOtpRequest is the body for COD OTP verification.
type VerifyCodOtpRequest struct {
	RideID uuid.UUID `json:"ride_id"`
	OTP    string    `json:"otp"`
}

// VerifyCodOtp verifies the COD OTP.
func (h *Handler) VerifyCodOtp(c *gin.Context) {
	var req VerifyCodOtpRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	v, err := h.svc.VerifyCodOtp(c.Request.Context(), req.RideID, req.OTP)
	if err != nil {
		errorResp(c, http.StatusBadRequest, "OTP_INVALID", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, v))
}

// GetForRide returns the payment for a ride.
func (h *Handler) GetForRide(c *gin.Context) {
	rideID, err := uuid.Parse(c.Param("ride_id"))
	if err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", "invalid ride_id")
		return
	}
	row, err := h.svc.repo.FindByRide(c.Request.Context(), rideID)
	if err != nil {
		errorResp(c, http.StatusNotFound, "NOT_FOUND", "payment not found")
		return
	}
	c.JSON(http.StatusOK, envelope(c, row))
}

// History returns the rider's payment history.
func (h *Handler) History(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		errorResp(c, http.StatusUnauthorized, "UNAUTHORIZED", "auth required")
		return
	}
	riderID, _ := uuid.Parse(user.ID)
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	rows, err := h.svc.HistoryByRider(c.Request.Context(), riderID, limit)
	if err != nil {
		errorResp(c, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, gin.H{
		"items": rows,
		"count": len(rows),
	}))
}

// Stats returns aggregate payment stats.
func (h *Handler) Stats(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		errorResp(c, http.StatusUnauthorized, "UNAUTHORIZED", "auth required")
		return
	}
	riderID, _ := uuid.Parse(user.ID)
	sinceStr := c.DefaultQuery("since", time.Now().AddDate(0, -1, 0).Format(time.RFC3339))
	since, err := time.Parse(time.RFC3339, sinceStr)
	if err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", "invalid since")
		return
	}
	total, count, err := h.svc.StatsByRider(c.Request.Context(), riderID, since)
	if err != nil {
		errorResp(c, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	c.JSON(http.StatusOK, envelope(c, gin.H{
		"total_spend":   total.String(),
		"ride_count":    count,
		"average_ride":  averageOrZero(total, count).String(),
		"window_start":  since.UTC().Format(time.RFC3339),
	}))
}

// GetByID returns a single payment.
func (h *Handler) GetByID(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		errorResp(c, http.StatusBadRequest, "BAD_REQUEST", "invalid id")
		return
	}
	row, err := h.svc.repo.FindByID(c.Request.Context(), id)
	if err != nil {
		errorResp(c, http.StatusNotFound, "NOT_FOUND", "payment not found")
		return
	}
	c.JSON(http.StatusOK, envelope(c, row))
}

func averageOrZero(total decimal.Decimal, count int) decimal.Decimal {
	if count <= 0 {
		return decimal.Zero
	}
	return total.Div(decimal.NewFromInt(int64(count)))
}
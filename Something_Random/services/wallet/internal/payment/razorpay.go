package payment

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// RazorpayClient interacts with Razorpay API using raw net/http.
// No SDK — full control over HTTP calls for a financial service.
type RazorpayClient struct {
	keyID      string
	keySecret  string
	httpClient *http.Client
	baseURL    string
	mockMode   bool
	logger     *zap.Logger
}

// RazorpayOrder is the response from Razorpay order creation.
type RazorpayOrder struct {
	ID       string `json:"id"`
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
	Receipt  string `json:"receipt"`
	Status   string `json:"status"`
}

// NewRazorpayClient creates a Razorpay client.
// If keyID is empty, runs in mock mode.
func NewRazorpayClient(keyID, keySecret string, logger *zap.Logger) *RazorpayClient {
	return &RazorpayClient{
		keyID:     keyID,
		keySecret: keySecret,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		baseURL:  "https://api.razorpay.com/v1",
		mockMode: keyID == "",
		logger:   logger,
	}
}

// CreateOrder creates a Razorpay order.
// Amount is in rupees — converted to paise using decimal math.
func (c *RazorpayClient) CreateOrder(ctx context.Context, amount decimal.Decimal, receipt string) (*RazorpayOrder, error) {
	// Convert rupees to paise using decimal (not float)
	paise := amount.Mul(decimal.NewFromInt(100)).IntPart()

	if c.mockMode {
		c.logger.Info("mock Razorpay order created",
			zap.Int64("amount_paise", paise),
			zap.String("receipt", receipt))
		return &RazorpayOrder{
			ID:       fmt.Sprintf("mock_order_%s_%d", receipt, time.Now().UnixMilli()),
			Amount:   paise,
			Currency: "INR",
			Receipt:  receipt,
			Status:   "created",
		}, nil
	}

	body := map[string]interface{}{
		"amount":   paise,
		"currency": "INR",
		"receipt":  receipt,
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/orders", bytes.NewReader(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	req.SetBasicAuth(c.keyID, c.keySecret)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("razorpay request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("razorpay error (status %d): %s", resp.StatusCode, string(respBody))
	}

	var order RazorpayOrder
	if err := json.Unmarshal(respBody, &order); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w", err)
	}

	return &order, nil
}

// FetchPayment retrieves payment details from Razorpay.
func (c *RazorpayClient) FetchPayment(ctx context.Context, paymentID string) (map[string]interface{}, error) {
	if c.mockMode {
		return map[string]interface{}{
			"id":     paymentID,
			"status": "captured",
		}, nil
	}

	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/payments/"+paymentID, nil)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(c.keyID, c.keySecret)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return result, nil
}

// IsMockMode returns whether the client is in mock mode.
func (c *RazorpayClient) IsMockMode() bool {
	return c.mockMode
}

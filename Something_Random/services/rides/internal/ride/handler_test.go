package ride

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

func TestRequestRide_InvalidInput(t *testing.T) {
	gin.SetMode(gin.TestMode)
	logger := zap.NewNop()
	// Pass nil for repo since it shouldn't be reached on bad input
	handler := NewHandler(nil, logger)

	router := gin.New()
	handler.RegisterRoutes(router)

	body := []byte(`{"rider_id": "not-a-uuid"}`)
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/rides/request", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status code %d, got %d", http.StatusBadRequest, w.Code)
	}
}

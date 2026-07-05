// Package health provides the health check endpoint for the wallet service.
package health

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

var startTime = time.Now()

// Response represents the health check response.
type Response struct {
	Status    string `json:"status"`
	Service   string `json:"service"`
	Version   string `json:"version"`
	Timestamp string `json:"timestamp"`
	Uptime    int64  `json:"uptime"`
}

// RegisterRoutes registers the health check endpoints on the given router.
func RegisterRoutes(router *gin.Engine) {
	router.GET("/health", handleHealth)
}

func handleHealth(c *gin.Context) {
	c.JSON(http.StatusOK, Response{
		Status:    "ok",
		Service:   "wallet",
		Version:   "0.1.0",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Uptime:    int64(time.Since(startTime).Seconds()),
	})
}

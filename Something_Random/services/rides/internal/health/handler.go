package health

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

var startTime = time.Now()

// RegisterRoutes registers the health check endpoint.
func RegisterRoutes(r *gin.Engine) {
	r.GET("/health", handler)
	r.GET("/api/v1/rides/health", handler)
}

func handler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "ok",
		"service":   "rides",
		"version":   "0.1.0",
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		"uptime":    int(time.Since(startTime).Seconds()),
	})
}

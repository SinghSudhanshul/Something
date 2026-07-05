package middleware

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// RequestUser represents the authenticated user from Kong headers.
type RequestUser struct {
	ID                string   `json:"id"`
	CampusID          string   `json:"campus_id"`
	VerificationLevel int      `json:"verification_level"`
	TrustTier         string   `json:"trust_tier"`
	Roles             []string `json:"roles"`
}

// Auth middleware reads Kong-forwarded headers and attaches user to context.
func Auth() gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetHeader("X-Authenticated-Userid")
		if userID == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "Authentication required"})
			c.Abort()
			return
		}

		campusID := c.GetHeader("X-User-Campus-Id")
		vlStr := c.GetHeader("X-User-Verification-Level")
		vl, err := strconv.Atoi(vlStr)
		if err != nil || vl < 1 || vl > 4 {
			vl = 1
		}

		trustTier := c.GetHeader("X-User-Trust-Tier")
		if trustTier == "" {
			trustTier = "new"
		}

		var roles []string
		rolesStr := c.GetHeader("X-User-Roles")
		if rolesStr != "" {
			roles = strings.Split(rolesStr, ",")
			for i := range roles {
				roles[i] = strings.TrimSpace(roles[i])
			}
		} else {
			roles = []string{"student"}
		}

		user := &RequestUser{
			ID:                userID,
			CampusID:          campusID,
			VerificationLevel: vl,
			TrustTier:         trustTier,
			Roles:             roles,
		}

		c.Set("user", user)
		c.Next()
	}
}

// InternalAuth validates X-Internal-Secret header for service-to-service calls.
func InternalAuth(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		provided := c.GetHeader("X-Internal-Secret")
		if provided == "" || provided != secret {
			c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "Invalid internal secret"})
			c.Abort()
			return
		}
		c.Next()
	}
}

// GetUser extracts the RequestUser from gin context.
func GetUser(c *gin.Context) *RequestUser {
	val, exists := c.Get("user")
	if !exists {
		return nil
	}
	user, ok := val.(*RequestUser)
	if !ok {
		return nil
	}
	return user
}

// RequestID middleware adds a unique request ID to each request.
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		reqID := c.GetHeader("X-Request-Id")
		if reqID == "" {
			reqID = c.GetHeader("X-Correlation-Id")
		}
		c.Set("request_id", reqID)
		c.Header("X-Request-Id", reqID)
		c.Next()
	}
}

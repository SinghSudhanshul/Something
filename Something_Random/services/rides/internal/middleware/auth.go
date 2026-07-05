package middleware

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// RequestUser represents the authenticated user extracted from Kong headers.
type RequestUser struct {
	ID                string
	CampusID          string
	VerificationLevel int
	TrustTier         string
	Roles             []string
}

// HasRole checks if the user has a specific role.
func (u *RequestUser) HasRole(role string) bool {
	for _, r := range u.Roles {
		if r == role {
			return true
		}
	}
	return false
}

// ErrorResponse is the standard error response format.
type ErrorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Auth extracts the authenticated user from Kong JWT headers.
func Auth() gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetHeader("X-Authenticated-Userid")
		if userID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, ErrorResponse{
				Code:    "UNAUTHORIZED",
				Message: "Authentication required",
			})
			return
		}

		campusID := c.GetHeader("X-User-Campus-Id")
		if campusID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, ErrorResponse{
				Code:    "UNAUTHORIZED",
				Message: "Campus ID is required",
			})
			return
		}

		vlStr := c.GetHeader("X-User-Verification-Level")
		vl, err := strconv.Atoi(vlStr)
		if err != nil || vl < 1 || vl > 4 {
			vl = 1
		}

		trustTier := c.GetHeader("X-User-Trust-Tier")
		if trustTier == "" {
			trustTier = "new"
		}

		rolesStr := c.GetHeader("X-User-Roles")
		var roles []string
		if rolesStr != "" {
			for _, r := range strings.Split(rolesStr, ",") {
				roles = append(roles, strings.TrimSpace(r))
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

// RequireVerificationLevel creates a middleware that requires a minimum verification level.
func RequireVerificationLevel(level int) gin.HandlerFunc {
	return func(c *gin.Context) {
		userVal, exists := c.Get("user")
		if !exists {
			c.AbortWithStatusJSON(http.StatusUnauthorized, ErrorResponse{
				Code:    "UNAUTHORIZED",
				Message: "Authentication required",
			})
			return
		}

		user := userVal.(*RequestUser)
		if user.VerificationLevel < level {
			c.AbortWithStatusJSON(http.StatusForbidden, ErrorResponse{
				Code:    "VERIFICATION_REQUIRED",
				Message: "Complete identity verification to access this feature",
			})
			return
		}
		c.Next()
	}
}

// RequireRoles creates a middleware that requires one of the specified roles.
func RequireRoles(allowedRoles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		userVal, exists := c.Get("user")
		if !exists {
			c.AbortWithStatusJSON(http.StatusUnauthorized, ErrorResponse{
				Code:    "UNAUTHORIZED",
				Message: "Authentication required",
			})
			return
		}

		user := userVal.(*RequestUser)
		for _, allowed := range allowedRoles {
			if user.HasRole(allowed) {
				c.Next()
				return
			}
		}

		c.AbortWithStatusJSON(http.StatusForbidden, ErrorResponse{
			Code:    "FORBIDDEN",
			Message: "Insufficient permissions",
		})
	}
}

// GetUser extracts the authenticated user from the Gin context.
func GetUser(c *gin.Context) *RequestUser {
	userVal, exists := c.Get("user")
	if !exists {
		return nil
	}
	return userVal.(*RequestUser)
}

// InternalAuth validates the X-Internal-Secret header for service-to-service calls.
func InternalAuth(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		provided := c.GetHeader("X-Internal-Secret")
		if provided == "" || provided != secret {
			c.AbortWithStatusJSON(http.StatusUnauthorized, ErrorResponse{
				Code:    "UNAUTHORIZED",
				Message: "Invalid internal service secret",
			})
			return
		}
		c.Next()
	}
}

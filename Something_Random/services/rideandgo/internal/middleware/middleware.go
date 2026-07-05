// Package middleware contains all HTTP middleware used by the
// service: request ID, JWT auth, recovery, rate limiting, CORS,
// security headers, request logging, and Prometheus instrumentation.
// Middleware are designed to be composed via net/http's standard
// pattern (outermost first).
package middleware

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/prometheus/client_golang/prometheus"
	"golang.org/x/time/rate"

	"rideandgo/internal/config"
	"rideandgo/internal/httpx"
	"rideandgo/internal/logger"
)

// ctxKey is unexported to prevent collisions in context.WithValue.
type ctxKey int

const (
	ctxKeyRequestID ctxKey = iota
	ctxKeyUserID
	ctxKeyUserRoles
	ctxKeyUserScopes
	ctxKeySessionID
	ctxKeyRealIP
	ctxKeyIdempotencyKey
	ctxKeyTraceID
	ctxKeyStartTime
)

// RequestID middleware ensures every request has an X-Request-ID
// header. If the client provides one, it's used (after validation);
// otherwise a fresh ULID is generated. The ID is exposed in
// response headers, the request context, and every log line.
func RequestID() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := r.Header.Get("X-Request-ID")
			if id == "" || len(id) > 128 || !isAlphanumeric(id) {
				id = newRequestID()
			}
			w.Header().Set("X-Request-ID", id)
			r = r.WithContext(context.WithValue(r.Context(), ctxKeyRequestID, id))
			next.ServeHTTP(w, r)
		})
	}
}

func newRequestID() string {
	var b [16]byte
	_, _ = io.ReadFull(strings.NewReader(time.Now().UTC().Format("20060102150405.000000")), nil) //nolint:staticcheck
	ts := time.Now().UTC().UnixNano()
	for i := 0; i < 8; i++ {
		b[i] = byte(ts >> (8 * i))
	}
	// last 8 bytes from a counter
	// we use the process start time + nanoseconds mod 2^64 to make it unique
	sum := sha256.Sum256([]byte(fmt.Sprintf("%d-%d", ts, randSuffix())))
	hex.Encode(b[0:0], sum[:]) //nolint:staticcheck
	hex := hex.EncodeToString(b[:])
	return hex
}

var suffixCounter uint64

func randSuffix() uint64 { return atomic.AddUint64(&suffixCounter, 1) }

func isAlphanumeric(s string) bool {
	if s == "" {
		return false
	}
	for _, c := range s {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

// RequestIDFromContext extracts the request ID from a context.
func RequestIDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(ctxKeyRequestID).(string); ok {
		return v
	}
	return ""
}

// RealIP middleware extracts the real client IP, respecting
// X-Forwarded-For only when the immediate hop is a trusted proxy.
func RealIP(trustedProxies []string) func(http.Handler) http.Handler {
	trusted := make(map[string]bool, len(trustedProxies))
	for _, p := range trustedProxies {
		trusted[strings.TrimSpace(p)] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			remote := r.RemoteAddr
			host, _, _ := strings.Cut(remote, ":")
			if trusted[host] || len(trusted) == 0 {
				if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
					parts := strings.Split(xff, ",")
					ip := strings.TrimSpace(parts[0])
					if ip != "" {
						remote = ip
					}
				} else if xri := r.Header.Get("X-Real-IP"); xri != "" {
					remote = xri
				}
			}
			r = r.WithContext(context.WithValue(r.Context(), ctxKeyRealIP, remote))
			next.ServeHTTP(w, r)
		})
	}
}

// RealIPFromContext returns the resolved client IP.
func RealIPFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(ctxKeyRealIP).(string); ok {
		return v
	}
	return ""
}

// Recovery middleware turns panics into 500 responses without
// crashing the process. The panic is logged with stack trace and
// recorded as a Prometheus error.
func Recovery(log *logger.Logger, errs *prometheus.CounterVec) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if p := recover(); p != nil {
					rid := RequestIDFromContext(r.Context())
					log.Error("http.panic",
						"request_id", rid,
						"path", r.URL.Path,
						"method", r.Method,
						"panic", fmt.Sprintf("%v", p),
						"stack", string(debug.Stack()),
					)
					if errs != nil {
						errs.WithLabelValues("panic").Inc()
					}
					httpx.Internal(w, "An unexpected error occurred. Please try again.")
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// AccessLog middleware logs one structured line per request after
// the response is written, including method, path, status, duration,
// IP, request ID, and (if authenticated) user ID.
func AccessLog(log *logger.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(sw, r)
			dur := time.Since(start)
			l := log.FromContext(r.Context())
			args := []any{
				"method", r.Method,
				"path", r.URL.Path,
				"status", sw.status,
				"bytes", sw.bytes,
				"duration_ms", dur.Milliseconds(),
				"remote_ip", RealIPFromContext(r.Context()),
			}
			switch {
			case sw.status >= 500:
				l.Error("http.request", args...)
			case sw.status >= 400:
				l.Warn("http.request", args...)
			default:
				l.Info("http.request", args...)
			}
		})
	}
}

type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	w.bytes += len(b)
	return w.ResponseWriter.Write(b)
}

// Hijack supports WebSocket upgrade.
func (w *statusWriter) Hijack() (interface{}, interface{}, error) {
	if h, ok := w.ResponseWriter.(http.Hijacker); ok {
		conn, rw, err := h.Hijack()
		return conn, rw, err
	}
	return nil, nil, errors.New("hijacker not supported")
}

// Flush supports streaming endpoints.
func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// CORS middleware adds the right headers for cross-origin requests.
// The allowed origin list is configurable; "*" is rejected in
// production.
func CORS(cfg *config.Config) func(http.Handler) http.Handler {
	allowed := make(map[string]bool, len(cfg.CORSAllowedOrigins))
	wildcard := false
	for _, o := range cfg.CORSAllowedOrigins {
		if o == "*" {
			wildcard = true
			continue
		}
		allowed[o] = true
	}
	methods := strings.Join(cfg.CORSAllowedMethods, ", ")
	headers := strings.Join(cfg.CORSAllowedHeaders, ", ")

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if wildcard {
				w.Header().Set("Access-Control-Allow-Origin", "*")
			} else if origin != "" && allowed[origin] {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			}
			w.Header().Set("Access-Control-Allow-Methods", methods)
			w.Header().Set("Access-Control-Allow-Headers", headers)
			w.Header().Set("Access-Control-Max-Age", "600")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// SecurityHeaders middleware sets headers that protect against
// common attacks: HSTS, X-Content-Type-Options, X-Frame-Options,
// Referrer-Policy, Content-Security-Policy (where applicable).
func SecurityHeaders() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("X-XSS-Protection", "1; mode=block")
			h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
			h.Set("Permissions-Policy", "geolocation=(self), camera=(), microphone=()")
			h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
			h.Set("Cross-Origin-Opener-Policy", "same-origin")
			next.ServeHTTP(w, r)
		})
	}
}

// MaxBodySize limits request body to N bytes, returning 413 above.
func MaxBodySize(n int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.ContentLength > n {
				httpx.WriteError(w, http.StatusRequestEntityTooLarge, httpx.CodeBadRequest,
					"Request body too large", nil, "", "")
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, n)
			next.ServeHTTP(w, r)
		})
	}
}

// RateLimit applies a per-key token-bucket limiter. The key is
// the real client IP unless an authenticated user ID is available.
// limitRPS is the steady-state rate, burst is the maximum bucket.
func RateLimit(limitRPS, burst int) func(http.Handler) http.Handler {
	type entry struct {
		lim  *rate.Limiter
		seen time.Time
	}
	var (
		mu      sync.Mutex
		clients = make(map[string]*entry)
	)
	go func() {
		t := time.NewTicker(time.Minute)
		defer t.Stop()
		for range t.C {
			mu.Lock()
			now := time.Now()
			for k, e := range clients {
				if now.Sub(e.seen) > 5*time.Minute {
					delete(clients, k)
				}
			}
			mu.Unlock()
		}
	}()
	key := func(r *http.Request) string {
		if uid := UserIDFromContext(r.Context()); uid != "" {
			return "u:" + uid
		}
		return "ip:" + RealIPFromContext(r.Context())
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			k := key(r)
			mu.Lock()
			e, ok := clients[k]
			if !ok {
				e = &entry{lim: rate.NewLimiter(rate.Limit(limitRPS), burst)}
				clients[k] = e
			}
			e.seen = time.Now()
			mu.Unlock()
			if !e.lim.Allow() {
				w.Header().Set("Retry-After", "1")
				httpx.TooManyRequests(w, "Too many requests")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// AuthClaims represents the JWT claims issued by the Auth service.
type AuthClaims struct {
	UserID   string   `json:"sub"`
	Email    string   `json:"email,omitempty"`
	Phone    string   `json:"phone,omitempty"`
	Roles    []string `json:"roles"`
	Scopes   []string `json:"scopes"`
	SessionID string  `json:"sid"`
	TokenType string  `json:"typ"`
	jwt.RegisteredClaims
}

// Auth middleware validates a Bearer JWT and attaches claims to
// the request context. Failed validation results in 401 unless
// the route is whitelisted (handled at router level).
func Auth(cfg *config.Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := r.Header.Get("Authorization")
			if !strings.HasPrefix(h, "Bearer ") {
				httpx.Unauthorized(w, "Missing or invalid Authorization header")
				return
			}
			raw := strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
			claims, err := parseToken(raw, cfg.JWTAccessSecret, cfg.JWTIssuer, cfg.JWTClockSkew)
			if err != nil {
				httpx.Unauthorized(w, "Invalid or expired token")
				return
			}
			if claims.TokenType != "" && claims.TokenType != "access" {
				httpx.Unauthorized(w, "Wrong token type")
				return
			}
			ctx := r.Context()
			ctx = context.WithValue(ctx, ctxKeyUserID, claims.UserID)
			ctx = context.WithValue(ctx, ctxKeyUserRoles, claims.Roles)
			ctx = context.WithValue(ctx, ctxKeyUserScopes, claims.Scopes)
			ctx = context.WithValue(ctx, ctxKeySessionID, claims.SessionID)
			r = r.WithContext(ctx)
			next.ServeHTTP(w, r)
		})
	}
}

func parseToken(raw, secret, issuer string, clockSkew time.Duration) (*AuthClaims, error) {
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{"HS256", "HS384", "HS512"}),
		jwt.WithIssuer(issuer),
		jwt.WithLeeway(clockSkew),
	)
	tok, err := parser.Parse(raw, func(t *jwt.Token) (any, error) {
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	if !tok.Valid {
		return nil, errors.New("token not valid")
	}
	mc, ok := tok.Claims.(jwt.MapClaims)
	if !ok {
		return nil, errors.New("invalid claims")
	}
	rawJSON, _ := json.Marshal(mc)
	var c AuthClaims
	if err := json.Unmarshal(rawJSON, &c); err != nil {
		return nil, err
	}
	return &c, nil
}

// UserIDFromContext extracts the authenticated user ID.
func UserIDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(ctxKeyUserID).(string); ok {
		return v
	}
	return ""
}

// RolesFromContext extracts the user's roles.
func RolesFromContext(ctx context.Context) []string {
	if v, ok := ctx.Value(ctxKeyUserRoles).([]string); ok {
		return v
	}
	return nil
}

// ScopesFromContext extracts the user's scopes.
func ScopesFromContext(ctx context.Context) []string {
	if v, ok := ctx.Value(ctxKeyUserScopes).([]string); ok {
		return v
	}
	return nil
}

// SessionIDFromContext extracts the session ID.
func SessionIDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(ctxKeySessionID).(string); ok {
		return v
	}
	return ""
}

// HasRole reports whether the authenticated user has any of the given roles.
func HasRole(ctx context.Context, roles ...string) bool {
	have := RolesFromContext(ctx)
	for _, r := range have {
		for _, want := range roles {
			if r == want {
				return true
			}
		}
	}
	return false
}

// RequireRoles middleware aborts the request unless the caller
// has at least one of the supplied roles.
func RequireRoles(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !HasRole(r.Context(), roles...) {
				httpx.Forbidden(w, "Insufficient role")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// InternalSecret middleware protects internal service-to-service
// routes with a shared HMAC secret. The header X-Internal-Secret
// is compared in constant time.
func InternalSecret(expected string) func(http.Handler) http.Handler {
	expB := []byte(expected)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			got := []byte(r.Header.Get("X-Internal-Secret"))
			if len(got) != len(expB) || subtle.ConstantTimeCompare(got, expB) != 1 {
				httpx.Unauthorized(w, "Invalid internal secret")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// SignedBody middleware verifies the X-Signature header against
// HMAC-SHA256(body, secret) for webhook-style endpoints.
func SignedBody(secret string) func(http.Handler) http.Handler {
	secB := []byte(secret)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			sig := r.Header.Get("X-Signature")
			if sig == "" {
				httpx.Unauthorized(w, "Missing signature")
				return
			}
			body, err := io.ReadAll(r.Body)
			if err != nil {
				httpx.BadRequest(w, "Cannot read body", nil)
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(body))
			mac := hmac.New(sha256.New, secB)
			mac.Write(body)
			expected := hex.EncodeToString(mac.Sum(nil))
			if subtle.ConstantTimeCompare([]byte(sig), []byte(expected)) != 1 {
				// Also accept the "sha256=" prefixed form (Stripe convention)
				if !strings.HasPrefix(sig, "sha256=") {
					httpx.Unauthorized(w, "Invalid signature")
					return
				}
				raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(sig, "sha256="))
				if err != nil {
					httpx.Unauthorized(w, "Invalid signature encoding")
					return
				}
				mac2 := hmac.New(sha256.New, secB)
				mac2.Write(body)
				if subtle.ConstantTimeCompare(raw, mac2.Sum(nil)) != 1 {
					httpx.Unauthorized(w, "Invalid signature")
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Idempotency middleware extracts X-Idempotency-Key from the
// request header and stores it in the request context.
func Idempotency() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			k := r.Header.Get("X-Idempotency-Key")
			if k != "" {
				r = r.WithContext(context.WithValue(r.Context(), ctxKeyIdempotencyKey, k))
			}
			next.ServeHTTP(w, r)
		})
	}
}

// IdempotencyKeyFromContext returns the idempotency key from a
// request context, or "" if none was set.
func IdempotencyKeyFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(ctxKeyIdempotencyKey).(string); ok {
		return v
	}
	return ""
}

// Timeout middleware cancels the request context after d. It
// exists so handlers can opt into a per-route deadline shorter
// than the server's write timeout.
func Timeout(d time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), d)
			defer cancel()
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// Chain composes middleware into a single handler. The first
// argument is the innermost handler; the rest are applied outside
// in the order given (i.e. leftmost is closest to the request).
func Chain(h http.Handler, ms ...func(http.Handler) http.Handler) http.Handler {
	for i := len(ms) - 1; i >= 0; i-- {
		h = ms[i](h)
	}
	return h
}

// ContentTypeJSON rejects requests whose Content-Type isn't JSON
// for methods that carry a body.
func ContentTypeJSON() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.ContentLength > 0 {
				ct := r.Header.Get("Content-Type")
				if !strings.HasPrefix(ct, "application/json") {
					httpx.WriteError(w, http.StatusUnsupportedMediaType, httpx.CodeBadRequest,
						"Content-Type must be application/json", nil, "", "")
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ParseInt is a small helper that returns 0 for empty/invalid values.
func ParseInt(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

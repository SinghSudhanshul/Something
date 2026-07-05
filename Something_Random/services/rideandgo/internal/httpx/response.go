// Package httpx provides a typed envelope for JSON HTTP responses
// and a small set of helpers that standardize error reporting
// across handlers. Every API response from this service follows
// the same shape so client code can be written once.
package httpx

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"
)

// Envelope is the canonical response wrapper for all API endpoints.
// On success, Data holds the payload and Meta is null/omitted.
// On error, Error is populated and Data is null.
type Envelope struct {
	Data   any    `json:"data,omitempty"`
	Error  *Error `json:"error,omitempty"`
	Meta   *Meta  `json:"meta,omitempty"`
}

// Error is the canonical error payload.
type Error struct {
	Code      string         `json:"code"`
	Message   string         `json:"message"`
	Details   map[string]any `json:"details,omitempty"`
	RequestID string         `json:"request_id,omitempty"`
	TraceID   string         `json:"trace_id,omitempty"`
}

// Meta carries optional pagination or context metadata.
type Meta struct {
	RequestID  string    `json:"request_id,omitempty"`
	Page       int       `json:"page,omitempty"`
	PerPage    int       `json:"per_page,omitempty"`
	Total      int64     `json:"total,omitempty"`
	TotalPages int       `json:"total_pages,omitempty"`
	ServerTime time.Time `json:"server_time"`
	Version    string    `json:"version,omitempty"`
}

// Common error codes. Treat these as stable contracts.
const (
	CodeBadRequest          = "bad_request"
	CodeUnauthorized        = "unauthorized"
	CodeForbidden           = "forbidden"
	CodeNotFound            = "not_found"
	CodeConflict            = "conflict"
	CodeValidation          = "validation_failed"
	CodeRateLimited         = "rate_limited"
	CodeInternal            = "internal_error"
	CodeServiceUnavailable  = "service_unavailable"
	CodeUpstreamUnavailable = "upstream_unavailable"
	CodePaymentRequired     = "payment_required"
	CodeInsufficientFunds   = "insufficient_funds"
	CodeTripNotCancellable  = "trip_not_cancellable"
	CodeDriverUnavailable   = "driver_unavailable"
	CodeKYCRequired         = "kyc_required"
	CodeSOSActive           = "sos_active"
	CodeMaintenanceMode     = "maintenance_mode"
	CodeIdempotencyConflict = "idempotency_conflict"
)

// WriteJSON writes a JSON envelope with the given status code.
func WriteJSON(w http.ResponseWriter, status int, payload any, meta *Meta) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if meta != nil && meta.ServerTime.IsZero() {
		meta.ServerTime = time.Now().UTC()
	}
	if meta == nil {
		meta = &Meta{ServerTime: time.Now().UTC()}
	}
	env := Envelope{Data: payload, Meta: meta}
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	w.WriteHeader(status)
	_ = enc.Encode(env)
}

// WriteError writes a typed error response. Pass requestID/traceID
// from the request context where available.
func WriteError(w http.ResponseWriter, status int, code, message string, details map[string]any, requestID, traceID string) {
	WriteJSON(w, status, nil, &Meta{ServerTime: time.Now().UTC(), RequestID: requestID})
	// Re-marshal with error envelope.
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	env := Envelope{Error: &Error{
		Code:      code,
		Message:   message,
		Details:   details,
		RequestID: requestID,
		TraceID:   traceID,
	}, Meta: &Meta{ServerTime: time.Now().UTC(), RequestID: requestID}}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(env)
}

// ErrorResponse is a helper for writing error responses.
func ErrorResponse(w http.ResponseWriter, status int, code, message string) {
	WriteError(w, status, code, message, nil, "", "")
}

// BadRequest writes a 400.
func BadRequest(w http.ResponseWriter, message string, details map[string]any) {
	WriteError(w, http.StatusBadRequest, CodeBadRequest, message, details, "", "")
}

// Validation writes a 422.
func Validation(w http.ResponseWriter, message string, details map[string]any) {
	WriteError(w, http.StatusUnprocessableEntity, CodeValidation, message, details, "", "")
}

// Unauthorized writes a 401.
func Unauthorized(w http.ResponseWriter, message string) {
	WriteError(w, http.StatusUnauthorized, CodeUnauthorized, message, nil, "", "")
}

// Forbidden writes a 403.
func Forbidden(w http.ResponseWriter, message string) {
	WriteError(w, http.StatusForbidden, CodeForbidden, message, nil, "", "")
}

// NotFound writes a 404.
func NotFound(w http.ResponseWriter, message string) {
	WriteError(w, http.StatusNotFound, CodeNotFound, message, nil, "", "")
}

// Conflict writes a 409.
func Conflict(w http.ResponseWriter, message string, details map[string]any) {
	WriteError(w, http.StatusConflict, CodeConflict, message, details, "", "")
}

// Internal writes a 500. The original error is NOT exposed.
func Internal(w http.ResponseWriter, message string) {
	if message == "" {
		message = "An unexpected error occurred. Please try again."
	}
	WriteError(w, http.StatusInternalServerError, CodeInternal, message, nil, "", "")
}

// ServiceUnavailable writes a 503.
func ServiceUnavailable(w http.ResponseWriter, message string) {
	WriteError(w, http.StatusServiceUnavailable, CodeServiceUnavailable, message, nil, "", "")
}

// TooManyRequests writes a 429.
func TooManyRequests(w http.ResponseWriter, message string) {
	WriteError(w, http.StatusTooManyRequests, CodeRateLimited, message, nil, "", "")
}

// Paginated writes a paginated list response.
func Paginated(w http.ResponseWriter, data any, page, perPage int, total int64) {
	totalPages := 0
	if total > 0 && perPage > 0 {
		totalPages = int((total + int64(perPage) - 1) / int64(perPage))
	}
	WriteJSON(w, http.StatusOK, data, &Meta{
		ServerTime:  time.Now().UTC(),
		Page:        page,
		PerPage:     perPage,
		Total:       total,
		TotalPages:  totalPages,
	})
}

// Created writes a 201 with the resource payload.
func Created(w http.ResponseWriter, payload any) {
	WriteJSON(w, http.StatusCreated, payload, nil)
}

// OK writes a 200 with the payload.
func OK(w http.ResponseWriter, payload any) {
	WriteJSON(w, http.StatusOK, payload, nil)
}

// NoContent writes a 204.
func NoContent(w http.ResponseWriter) {
	w.WriteHeader(http.StatusNoContent)
}

// ParsePagination extracts page/per_page from query with sensible defaults.
func ParsePagination(r *http.Request, defaultPerPage, maxPerPage int) (page, perPage int) {
	page, _ = strconv.Atoi(r.URL.Query().Get("page"))
	if page <= 0 {
		page = 1
	}
	perPage, _ = strconv.Atoi(r.URL.Query().Get("per_page"))
	if perPage <= 0 {
		perPage = defaultPerPage
	}
	if perPage > maxPerPage {
		perPage = maxPerPage
	}
	return page, perPage
}

// AppError is a typed error that can be returned from a handler
// or service. The HTTP middleware converts it to the right response.
type AppError struct {
	Status  int
	Code    string
	Message string
	Details map[string]any
	Cause   error
}

func (e *AppError) Error() string {
	if e.Cause != nil {
		return e.Message + ": " + e.Cause.Error()
	}
	return e.Message
}

func (e *AppError) Unwrap() error { return e.Cause }

// NewAppError creates an AppError with the given status, code, and message.
func NewAppError(status int, code, message string) *AppError {
	return &AppError{Status: status, Code: code, Message: message}
}

// WithCause attaches a cause error.
func (e *AppError) WithCause(err error) *AppError {
	e.Cause = err
	return e
}

// WithDetails attaches validation/business details.
func (e *AppError) WithDetails(d map[string]any) *AppError {
	e.Details = d
	return e
}

// AsAppError attempts to type-assert an error to *AppError.
func AsAppError(err error) (*AppError, bool) {
	var ae *AppError
	if errors.As(err, &ae) {
		return ae, true
	}
	return nil, false
}

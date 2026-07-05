package incidents

import (
	"time"

	"github.com/google/uuid"
)

// Incident represents a safety incident report.
type Incident struct {
	ID             uuid.UUID              `json:"id"`
	RideID         *uuid.UUID             `json:"ride_id,omitempty"`
	CampusID       uuid.UUID              `json:"campus_id"`
	ReportedBy     uuid.UUID              `json:"reported_by"`
	ReportedRole   string                 `json:"reported_role"`
	Type           string                 `json:"type"`
	Severity       string                 `json:"severity"`
	Title          string                 `json:"title"`
	Description    string                 `json:"description"`
	Status         string                 `json:"status"`
	AssignedTo     *uuid.UUID             `json:"assigned_to,omitempty"`
	Lat            *float64               `json:"lat,omitempty"`
	Lng            *float64               `json:"lng,omitempty"`
	EvidenceURLs   []string               `json:"evidence_urls,omitempty"`
	ResolutionNote *string                `json:"resolution_note,omitempty"`
	ResolutionType *string                `json:"resolution_type,omitempty"`
	ResolvedAt     *time.Time             `json:"resolved_at,omitempty"`
	ResolvedBy     *uuid.UUID             `json:"resolved_by,omitempty"`
	EscalatedAt    *time.Time             `json:"escalated_at,omitempty"`
	EscalatedTo    *uuid.UUID             `json:"escalated_to,omitempty"`
	SLADeadline    *time.Time             `json:"sla_deadline,omitempty"`
	Tags           []string               `json:"tags,omitempty"`
	Metadata       map[string]interface{} `json:"metadata,omitempty"`
	CreatedAt      time.Time              `json:"created_at"`
	UpdatedAt      time.Time              `json:"updated_at"`
}

// SafetyProtocol represents a safety protocol/policy.
type SafetyProtocol struct {
	ID             uuid.UUID  `json:"id"`
	CampusID       *uuid.UUID `json:"campus_id,omitempty"`
	Title          string     `json:"title"`
	Description    string     `json:"description"`
	Category       string     `json:"category"`
	Priority       int        `json:"priority"`
	IsActive       bool       `json:"is_active"`
	EffectiveFrom  time.Time  `json:"effective_from"`
	EffectiveUntil *time.Time `json:"effective_until,omitempty"`
	Version        int        `json:"version"`
	ApprovedBy     *uuid.UUID `json:"approved_by,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// SafetyDashboard holds safety metrics.
type SafetyDashboard struct {
	TotalIncidents     int            `json:"total_incidents"`
	OpenIncidents      int            `json:"open_incidents"`
	InvestigatingCount int            `json:"investigating_count"`
	ResolvedCount      int            `json:"resolved_count"`
	AvgResolutionHours float64        `json:"avg_resolution_hours"`
	ByType             map[string]int `json:"by_type"`
	BySeverity         map[string]int `json:"by_severity"`
	OverdueSLA         int            `json:"overdue_sla"`
	SafetyScore        float64        `json:"safety_score"`
	TrendData          []TrendPoint   `json:"trend_data"`
	RecentIncidents    []Incident     `json:"recent_incidents"`
}

// TrendPoint holds a date/count pair.
type TrendPoint struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

// ReportIncidentInput holds input for creating an incident.
type ReportIncidentInput struct {
	RideID       *uuid.UUID `json:"ride_id"`
	Type         string     `json:"type" binding:"required"`
	Severity     string     `json:"severity"`
	Title        string     `json:"title" binding:"required"`
	Description  string     `json:"description" binding:"required"`
	Lat          *float64   `json:"lat"`
	Lng          *float64   `json:"lng"`
	EvidenceURLs []string   `json:"evidence_urls"`
}

// UpdateIncidentInput holds input for updating an incident.
type UpdateIncidentInput struct {
	Status         *string    `json:"status,omitempty"`
	AssignedTo     *uuid.UUID `json:"assigned_to,omitempty"`
	ResolutionNote *string    `json:"resolution_note,omitempty"`
	ResolutionType *string    `json:"resolution_type,omitempty"`
	Tags           []string   `json:"tags,omitempty"`
}

// ResolveInput holds input for resolving an incident.
type ResolveInput struct {
	Note           string `json:"note" binding:"required"`
	ResolutionType string `json:"resolution_type" binding:"required"`
}

// EscalateInput holds input for escalating an incident.
type EscalateInput struct {
	EscalatedTo uuid.UUID `json:"escalated_to" binding:"required"`
	Reason      string    `json:"reason" binding:"required"`
}

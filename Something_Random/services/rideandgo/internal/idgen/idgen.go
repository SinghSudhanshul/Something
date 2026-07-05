// Package idgen centralizes ID generation. All IDs are ULIDs (or
// UUIDs for entities that need to be RFC 4122 compliant). ULIDs
// are sortable by creation time, which gives us monotonic
// ordering for events without leaning on a database sequence.
package idgen

import (
	"crypto/rand"
	"encoding/base32"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/oklog/ulid/v2"
)

var (
	crockford = base32.NewEncoding("0123456789ABCDEFGHJKMNPQRSTVWXYZ").WithPadding(base32.NoPadding)
	entropyMu sync.Mutex
	entropy   = ulid.Monotonic(rand.Reader, 0)
)

// New returns a fresh ULID string.
func New() string {
	return ulid.MustNew(ulid.Timestamp(time.Now()), entropy).String()
}

// NewPrefixed returns a prefixed ID like "trp_01HGZ...". Prefixes
// are useful for log filtering and human readability.
func NewPrefixed(prefix string) string {
	return prefix + "_" + New()
}

// NewUUID returns a fresh UUIDv4.
func NewUUID() uuid.UUID {
	return uuid.New()
}

// NewUUIDString returns a UUID as a string.
func NewUUIDString() string {
	return uuid.NewString()
}

// ParseUUID parses a string into a UUID; returns an error if invalid.
func ParseUUID(s string) (uuid.UUID, error) {
	return uuid.Parse(s)
}

// MustUUID panics on invalid input. Use only in tests.
func MustUUID(s string) uuid.UUID {
	u, err := uuid.Parse(s)
	if err != nil {
		panic(err)
	}
	return u
}

// NewShortCode returns a 6-char Crockford base32 code, suitable
// for short reference codes (trip codes, dispute codes).
func NewShortCode() string {
	var b [6]byte
	_, _ = rand.Read(b[:])
	// Crockford encode the first 5 bytes to 8 chars; take 6.
	return strings.ToUpper(crockford.EncodeToString(b[:]))[:6]
}

// NewOTP returns a 6-digit numeric OTP.
func NewOTP() string {
	var b [4]byte
	_, _ = rand.Read(b[:])
	n := (uint32(b[0])<<24 | uint32(b[1])<<16 | uint32(b[2])<<8 | uint32(b[3])) % 1000000
	return fmt.Sprintf("%06d", n)
}

// Hex returns a hex-encoded random string of n bytes.
func Hex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// NewIDFor returns a prefixed ID for a given entity type.
func NewIDFor(entity string) string {
	switch entity {
	case "trip":
		return NewPrefixed("trp")
	case "driver":
		return NewPrefixed("drv")
	case "rider":
		return NewPrefixed("rde")
	case "vehicle":
		return NewPrefixed("veh")
	case "payment":
		return NewPrefixed("pay")
	case "wallet":
		return NewPrefixed("wlt")
	case "rating":
		return NewPrefixed("rtg")
	case "dispute":
		return NewPrefixed("dsp")
	case "sos":
		return NewPrefixed("sos")
	case "audit":
		return NewPrefixed("aud")
	case "fare":
		return NewPrefixed("far")
	case "session":
		return NewPrefixed("ses")
	case "device":
		return NewPrefixed("dev")
	default:
		return NewPrefixed(entity)
	}
}

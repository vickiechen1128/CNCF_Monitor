package domain

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/foundation/apierror"
)

// RegistrationStatus is the M09 onboarding state (contract §8.1).
//
//	created → (monitor) → monitored → (unmonitor) → created
//	any → (domain deleted) → retired (terminal, audit only)
type RegistrationStatus string

// Registration status constants.
const (
	RegistrationStatusCreated   RegistrationStatus = "created"
	RegistrationStatusMonitored RegistrationStatus = "monitored"
	RegistrationStatusRetired   RegistrationStatus = "retired"
)

// MonitorableStatusEnabled / MonitorableDomainTypeEdge are the M06 preconditions
// for onboarding: only enabled edge domains may be monitored.
const (
	MonitorableStatusEnabled  = "enabled"
	MonitorableDomainTypeEdge = "edge"
)

const (
	// tokenPrefix marks M09 v1 edge tokens; the suffix is 32 random bytes hex.
	tokenPrefix = "mctok_v1_"
	// tokenRandomBytes is the entropy of the random portion (256 bits).
	tokenRandomBytes = 32
)

// Access is the onboarding runtime state of a network domain, backed 1:1 by
// network_domain_access. It carries no administrative fields (those stay in
// M06) and never stores the plaintext token.
type Access struct {
	DomainID           string
	TokenHash          string
	TokenMasked        string
	TokenCreatedAt     *time.Time
	RemoteWriteURL     string
	CenterEndpoint     string
	MaxDiskUsagePerURL string
	RegistrationStatus RegistrationStatus
	MonitoredAt        *time.Time
	LastHeartbeatAt    *time.Time
	LastConfigVersion  string
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

// Token is a freshly issued onboarding token. Plain is returned to the caller
// exactly once; only Hash and Masked are persisted.
type Token struct {
	Plain  string
	Hash   string
	Masked string
}

// IsMonitored reports whether the domain is currently onboarded.
func (a *Access) IsMonitored() bool {
	return a != nil && a.RegistrationStatus == RegistrationStatusMonitored
}

// Monitor transitions created → monitored and issues a new token. Monitoring an
// already-monitored or retired domain is a conflict.
func (a *Access) Monitor(now time.Time) (Token, error) {
	switch a.RegistrationStatus {
	case RegistrationStatusMonitored:
		return Token{}, &ConflictError{Message: fmt.Sprintf(
			"network domain %q is already monitored; reset its token or unmonitor it first", a.DomainID)}
	case RegistrationStatusRetired:
		return Token{}, &ConflictError{Message: fmt.Sprintf(
			"network domain %q is retired and cannot be monitored again", a.DomainID)}
	}
	token, err := GenerateToken()
	if err != nil {
		return Token{}, err
	}
	a.RegistrationStatus = RegistrationStatusMonitored
	a.TokenHash = token.Hash
	a.TokenMasked = token.Masked
	a.TokenCreatedAt = timePtr(now)
	a.MonitoredAt = timePtr(now)
	return token, nil
}

// Unmonitor transitions monitored → created and revokes the token. It is
// idempotent for an already-unmonitored (created) domain; a retired domain is
// terminal and rejects the transition.
func (a *Access) Unmonitor() error {
	if a.RegistrationStatus == RegistrationStatusRetired {
		return &ConflictError{Message: fmt.Sprintf(
			"network domain %q is retired and cannot be unmonitored", a.DomainID)}
	}
	a.RegistrationStatus = RegistrationStatusCreated
	a.revokeToken()
	a.MonitoredAt = nil
	return nil
}

// ResetToken replaces the token of a monitored domain; the old token stops
// working immediately (token_hash is overwritten). Resetting a non-monitored
// domain is a conflict.
func (a *Access) ResetToken(now time.Time) (Token, error) {
	if a.RegistrationStatus != RegistrationStatusMonitored {
		return Token{}, &ConflictError{Message: fmt.Sprintf(
			"network domain %q is not monitored; monitor it before resetting the token", a.DomainID)}
	}
	token, err := GenerateToken()
	if err != nil {
		return Token{}, err
	}
	a.TokenHash = token.Hash
	a.TokenMasked = token.Masked
	a.TokenCreatedAt = timePtr(now)
	return token, nil
}

// Retire moves the domain to the terminal retired state and revokes the token.
// It is idempotent and used by the M06 delete cascade (MonitoringRetirer).
func (a *Access) Retire() {
	a.RegistrationStatus = RegistrationStatusRetired
	a.revokeToken()
	a.MonitoredAt = nil
}

func (a *Access) revokeToken() {
	a.TokenHash = ""
	a.TokenMasked = ""
	a.TokenCreatedAt = nil
}

// GenerateToken creates a new high-entropy onboarding token and its stored
// hash/mask. The plaintext is never persisted.
func GenerateToken() (Token, error) {
	buf := make([]byte, tokenRandomBytes)
	if _, err := rand.Read(buf); err != nil {
		return Token{}, fmt.Errorf("generate edge token: %w", err)
	}
	secret := hex.EncodeToString(buf)
	plain := tokenPrefix + secret
	return Token{Plain: plain, Hash: HashToken(plain), Masked: maskSecret(secret)}, nil
}

// HashToken returns the lowercase hex sha256 of a plaintext token.
func HashToken(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}

// TokenMatches reports whether plaintext hashes to storedHash in constant time.
func TokenMatches(plain, storedHash string) bool {
	if strings.TrimSpace(plain) == "" || storedHash == "" {
		return false
	}
	got := HashToken(plain)
	return subtle.ConstantTimeCompare([]byte(got), []byte(storedHash)) == 1
}

// maskSecret keeps the first and last two characters of the random portion.
func maskSecret(secret string) string {
	if len(secret) <= 4 {
		return "****"
	}
	return secret[:2] + "****" + secret[len(secret)-2:]
}

// ValidateMonitorable enforces the M06 preconditions before onboarding: the
// domain must be enabled and of type edge.
func ValidateMonitorable(domainID, status, domainType string) error {
	if strings.TrimSpace(status) != MonitorableStatusEnabled {
		return &ValidationError{Field: "status", Message: fmt.Sprintf(
			"network domain %q must be enabled before it can be monitored", domainID)}
	}
	if strings.TrimSpace(domainType) != MonitorableDomainTypeEdge {
		return &ValidationError{Field: "domain_type", Message: fmt.Sprintf(
			"network domain %q must be an edge domain to be monitored", domainID)}
	}
	return nil
}

// ValidationError marks a client-side input violation (HTTP 400).
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string {
	if e.Field == "" {
		return e.Message
	}
	return fmt.Sprintf("%s: %s", e.Field, e.Message)
}

// ErrorKind returns the contract kind.
func (e *ValidationError) ErrorKind() apierror.Kind { return apierror.BadRequest }

// NotFoundError marks a missing network domain or access row (HTTP 404).
type NotFoundError struct {
	DomainID string
}

func (e *NotFoundError) Error() string {
	return fmt.Sprintf("network domain %q not found", e.DomainID)
}

// ErrorKind returns the contract kind.
func (e *NotFoundError) ErrorKind() apierror.Kind { return apierror.NotFound }

// AgentNotFoundError marks a missing edge agent (HTTP 404).
type AgentNotFoundError struct {
	AgentID int64
}

func (e *AgentNotFoundError) Error() string {
	return fmt.Sprintf("edge agent %d not found", e.AgentID)
}

// ErrorKind returns the contract kind.
func (e *AgentNotFoundError) ErrorKind() apierror.Kind { return apierror.NotFound }

// ConflictError marks a state-machine / uniqueness violation (HTTP 409).
type ConflictError struct {
	Message string
}

func (e *ConflictError) Error() string { return e.Message }

// ErrorKind returns the contract kind.
func (e *ConflictError) ErrorKind() apierror.Kind { return apierror.Conflict }

func timePtr(t time.Time) *time.Time { return &t }

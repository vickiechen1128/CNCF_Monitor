package domain

import "strings"

// Status is the resource running status.
type Status string

// Resource running statuses.
const (
	StatusOnline      Status = "online"
	StatusOffline     Status = "offline"
	StatusMaintenance Status = "maintenance"
)

// Valid reports whether s is a known status.
func (s Status) Valid() bool {
	switch s {
	case StatusOnline, StatusOffline, StatusMaintenance:
		return true
	default:
		return false
	}
}

// SourceType is the resource data source.
type SourceType string

// Resource source types.
const (
	SourceManual SourceType = "manual"
	SourceImport SourceType = "import"
	SourceCMDB   SourceType = "cmdb"
)

// Valid reports whether s is a known source type.
func (s SourceType) Valid() bool {
	switch s {
	case SourceManual, SourceImport, SourceCMDB:
		return true
	default:
		return false
	}
}

// Environment is the deployment environment.
type Environment string

// Deployment environments (MVP enum).
const (
	EnvOPS Environment = "OPS"
	EnvPRD Environment = "PRD"
	EnvUAT Environment = "UAT"
)

// Valid reports whether e is a known environment.
func (e Environment) Valid() bool {
	switch e {
	case EnvOPS, EnvPRD, EnvUAT:
		return true
	default:
		return false
	}
}

// NormalizeStatus parses a status string.
func NormalizeStatus(raw string) (Status, error) {
	s := Status(strings.TrimSpace(raw))
	if !s.Valid() {
		return "", newValidationError("status", "must be online/offline/maintenance")
	}
	return s, nil
}

// NormalizeSourceType parses a source type string.
func NormalizeSourceType(raw string) (SourceType, error) {
	s := SourceType(strings.TrimSpace(raw))
	if !s.Valid() {
		return "", newValidationError("source_type", "must be manual/import/cmdb")
	}
	return s, nil
}

// NormalizeEnvironment parses an environment string.
func NormalizeEnvironment(raw string) (Environment, error) {
	e := Environment(strings.TrimSpace(raw))
	if !e.Valid() {
		return "", newValidationError("env", "must be OPS/PRD/UAT")
	}
	return e, nil
}

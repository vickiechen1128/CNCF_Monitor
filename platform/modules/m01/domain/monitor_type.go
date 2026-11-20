package domain

import "strings"

// Monitor object type helpers.
//
// Before v1.3 these functions answered from a hard-coded Go enum. They now read
// the process-wide monitor type registry (SRS Module_01 v1.3 §3.1 / §5.6), which
// starts from the built-in snapshot and is replaced with the database-backed
// snapshot once the M01 module boots. Adding a type therefore requires no code
// change (NFR-11).

// ValidMonitorType reports whether monitorType exists and is enabled.
func ValidMonitorType(monitorType string) bool {
	return ActiveMonitorTypeRegistry().Valid(strings.TrimSpace(monitorType))
}

// ExporterSupportsMonitorType reports whether an exporter can collect a monitor
// type. An empty supported list means "no restriction".
func ExporterSupportsMonitorType(monitorType string, supported []string) bool {
	if len(supported) == 0 {
		return true
	}
	for _, candidate := range supported {
		if strings.TrimSpace(candidate) == monitorType {
			return true
		}
	}
	return false
}

// MonitorTypesForCategory returns the monitor types that belong to a coarse M07
// resource category, derived from the registry so both directions stay in sync.
func MonitorTypesForCategory(category ResourceCategory) []string {
	if category == "" {
		return nil
	}
	entries := ActiveMonitorTypeRegistry().ForCategory(category)
	if len(entries) == 0 {
		return nil
	}
	out := make([]string, 0, len(entries))
	for _, entry := range entries {
		out = append(out, entry.Definition.Code)
	}
	return out
}

// CategoryForMonitorType maps a monitor type back to its M07 resource category.
func CategoryForMonitorType(monitorType string) (ResourceCategory, bool) {
	return ActiveMonitorTypeRegistry().CategoryOf(strings.TrimSpace(monitorType))
}

// MonitorTypeScopeFor resolves the candidate scope of a monitor type.
func MonitorTypeScopeFor(monitorType string) (MonitorTypeScope, bool) {
	return ActiveMonitorTypeRegistry().Scope(strings.TrimSpace(monitorType))
}

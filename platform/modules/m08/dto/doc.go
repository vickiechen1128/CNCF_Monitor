// Package dto defines the M08 v3 request/response transport shapes. The shapes
// are frozen by api-contract-snapshot-v3.md; alert-event fields in particular
// must stay backward compatible for M05 (D-M08-03).
package dto

// MaskURL masks the sensitive tail of an outbound webhook URL while keeping
// enough context for an operator to recognise the target.
func MaskURL(raw string) string {
	u, err := parseURL(raw)
	if err != nil {
		return "***"
	}
	base := u.Scheme + "://" + u.Host
	if u.Path == "" || u.Path == "/" {
		return base + "/***"
	}
	return base + firstSegment(u.Path) + "/***"
}

package domain

// Actor is the authenticated caller's authorization scope.
type Actor struct {
	Username        string
	TenantID        string
	IsPlatformAdmin bool
}

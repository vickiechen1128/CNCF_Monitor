package service

import (
	"context"
	"log"

	"github.com/metriccenter/metriccenter/platform/modules/m09/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
)

// TokenValidator resolves an edge bearer token to its monitored network domain
// by comparing the sha256 hash (the plaintext is never stored).
type TokenValidator struct {
	repo repository.EdgeRepository
}

// NewTokenValidator constructs the validator.
func NewTokenValidator(repo repository.EdgeRepository) *TokenValidator {
	return &TokenValidator{repo: repo}
}

// Validate implements handler.TokenValidator. A database error is treated as
// "invalid" (401) and logged; the edge protocol never leaks internal state.
func (v *TokenValidator) Validate(ctx context.Context, token string) (string, bool) {
	hash := domain.HashToken(token)
	domainID, err := v.repo.FindMonitoredDomainByTokenHash(ctx, hash)
	if err != nil {
		log.Printf("m09: resolve edge token: %v", err)
		return "", false
	}
	if domainID == "" {
		return "", false
	}
	return domainID, true
}

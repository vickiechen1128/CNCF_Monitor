package domain

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"regexp"
	"strings"
)

const defaultDeployCode = "mc"

// DefaultDomainID is the historical center-direct domain id. It is reserved in
// v3 so a newly registered domain can never collide with a migrated row.
const DefaultDomainID = "default"

var (
	domainCodeRe = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`)
	deployCodeRe = regexp.MustCompile(`^[a-z0-9]+$`)
)

// ReadDeployCode returns METRIC_CENTER_DEPLOY_CODE or "mc".
func ReadDeployCode() string {
	if code := strings.TrimSpace(os.Getenv("METRIC_CENTER_DEPLOY_CODE")); code != "" {
		return code
	}
	return defaultDeployCode
}

// GenerateDomainID builds `<deploy_code>-<domain_code>`.
func GenerateDomainID(deployCode, domainCode string) (string, error) {
	domainCode = strings.TrimSpace(domainCode)
	if domainCode == "" {
		return "", &ValidationError{Field: "domain_code", Message: "is required"}
	}
	if domainCode == DefaultDomainID {
		return "", &ValidationError{Field: "domain_code", Message: fmt.Sprintf("%q is reserved", DefaultDomainID)}
	}
	if !domainCodeRe.MatchString(domainCode) {
		return "", &ValidationError{
			Field:   "domain_code",
			Message: "only lowercase letters, digits and hyphens are allowed",
		}
	}
	deployCode = strings.TrimSpace(deployCode)
	if !deployCodeRe.MatchString(deployCode) {
		return "", &ValidationError{
			Field:   "deploy_code",
			Message: "only lowercase letters and digits are allowed",
		}
	}
	return deployCode + "-" + domainCode, nil
}

// RandomDomainCode returns a short random lowercase-hex code.
func RandomDomainCode() (string, error) {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate random domain code: %w", err)
	}
	return hex.EncodeToString(b), nil
}

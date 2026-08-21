// Package networkdomain implements the Module 06 Phase 1 network-domain
// administrative backend: id generation, the zone-type dictionary, the
// network-domain CRUD/status/delete REST endpoints and their shared helpers.
package networkdomain

import (
	"fmt"
	"os"
	"regexp"

	"github.com/metriccenter/metriccenter/platform/models"
)

const defaultDeployCode = "mc"

// domainCodeRe matches lowercase letters, digits and hyphens, not starting or
// ending with a hyphen.
var domainCodeRe = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`)

// deployCodeRe matches lowercase letters and digits only.
var deployCodeRe = regexp.MustCompile(`^[a-z0-9]+$`)

// ReadDeployCode returns the deployment code from METRIC_CENTER_DEPLOY_CODE,
// defaulting to "mc" when unset.
func ReadDeployCode() string {
	if c := os.Getenv("METRIC_CENTER_DEPLOY_CODE"); c != "" {
		return c
	}
	return defaultDeployCode
}

// GenerateDomainID builds a network domain id as `<deployCode>-<domainCode>`.
// The historical pre-provisioned management domain "default" is returned as-is
// (no prefix, preserving the preset). It returns a descriptive error when a
// supplied code is empty or malformed.
func GenerateDomainID(deployCode, domainCode string) (string, error) {
	if domainCode == models.DefaultDomainID {
		return models.DefaultDomainID, nil
	}
	if !domainCodeRe.MatchString(domainCode) {
		return "", fmt.Errorf("invalid domain code %q: only lowercase letters, digits and hyphens are allowed", domainCode)
	}
	if !deployCodeRe.MatchString(deployCode) {
		return "", fmt.Errorf("invalid deploy code %q: only lowercase letters and digits are allowed", deployCode)
	}
	return deployCode + "-" + domainCode, nil
}

package domain

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/metriccenter/metriccenter/platform/foundation/apierror"
)

// CloudDict is a deployment-level cloud dictionary entry (M06 FR-09 / D37).
//
// The cloud code is the immutable composite `{cloud_type}-{carrier}` and is the
// only value resources and the `cloud` label may reference; Type and Carrier are
// descriptive attributes only (never independent label dimensions).
type CloudDict struct {
	Code        string
	Name        string
	Type        string
	Carrier     string
	Description string
	Enabled     bool
}

// CreateCloudDictInput is the validated service input for registration.
type CreateCloudDictInput struct {
	Code        string
	Name        string
	Type        string
	Carrier     string
	Description string
}

var (
	// cloudCodePattern enforces the composite code shape `{type}-{carrier}`.
	cloudCodePattern  = regexp.MustCompile(`^(PUB|GM|IND|PRI)-(TX|CU|CM)$`)
	validCloudTypes   = map[string]struct{}{"PUB": {}, "GM": {}, "IND": {}, "PRI": {}}
	validCloudCarrier = map[string]struct{}{"TX": {}, "CU": {}, "CM": {}}
)

// Normalize trims and validates a create request (D37): the composite code must
// match the described cloud type and carrier, and the display name is required.
func (i *CreateCloudDictInput) Normalize() error {
	i.Code = strings.TrimSpace(i.Code)
	i.Name = strings.TrimSpace(i.Name)
	i.Type = strings.TrimSpace(i.Type)
	i.Carrier = strings.TrimSpace(i.Carrier)
	i.Description = strings.TrimSpace(i.Description)

	if _, ok := validCloudTypes[i.Type]; !ok {
		return &ValidationError{Field: "cloud_type", Message: "must be one of PUB/GM/IND/PRI"}
	}
	if _, ok := validCloudCarrier[i.Carrier]; !ok {
		return &ValidationError{Field: "carrier", Message: "must be one of TX/CU/CM"}
	}
	if !cloudCodePattern.MatchString(i.Code) {
		return &ValidationError{Field: "cloud_code", Message: "must be a composite code like PUB-TX"}
	}
	if want := i.Type + "-" + i.Carrier; i.Code != want {
		return &ValidationError{
			Field:   "cloud_code",
			Message: fmt.Sprintf("does not match cloud_type/carrier (expected %s)", want),
		}
	}
	if i.Name == "" {
		return &ValidationError{Field: "cloud_name", Message: "is required"}
	}
	if len([]rune(i.Name)) > 100 {
		return &ValidationError{Field: "cloud_name", Message: "must be at most 100 characters"}
	}
	if len([]rune(i.Description)) > 500 {
		return &ValidationError{Field: "description", Message: "must be at most 500 characters"}
	}
	return nil
}

// CloudDictNotFoundError marks a missing cloud code (HTTP 404).
type CloudDictNotFoundError struct {
	Code string
}

func (e *CloudDictNotFoundError) Error() string {
	return fmt.Sprintf("cloud code %q not found", e.Code)
}

// ErrorKind returns the contract kind.
func (e *CloudDictNotFoundError) ErrorKind() apierror.Kind { return apierror.NotFound }

// CloudDictExistsError marks a duplicate cloud code (HTTP 409). Codes are
// immutable, so an existing entry can never be re-created.
type CloudDictExistsError struct {
	Code string
}

func (e *CloudDictExistsError) Error() string {
	return fmt.Sprintf("cloud code %q already exists", e.Code)
}

// ErrorKind returns the contract kind.
func (e *CloudDictExistsError) ErrorKind() apierror.Kind { return apierror.Conflict }

// CloudDictInUseError marks a disable rejected by existing references (HTTP 409):
// registered network domains must keep a resolvable cloud code.
type CloudDictInUseError struct {
	Code           string
	ReferenceCount int64
}

func (e *CloudDictInUseError) Error() string {
	return fmt.Sprintf("cloud code %q is referenced by %d network domain(s); migrate them before disabling", e.Code, e.ReferenceCount)
}

// ErrorKind returns the contract kind.
func (e *CloudDictInUseError) ErrorKind() apierror.Kind { return apierror.Conflict }

package domain

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/foundation/apierror"
)

// LoginLog is the read-only administrative view of one login attempt. The
// diagnostic message column is intentionally not exposed by the v3 contract.
type LoginLog struct {
	ID        string
	Username  string
	Success   bool
	IP        string
	CreatedAt time.Time
}

// InvalidTimeRangeError marks a start_time later than end_time (HTTP 400).
type InvalidTimeRangeError struct {
	Message string
}

func (e *InvalidTimeRangeError) Error() string { return e.Message }

// ErrorKind returns the contract kind.
func (e *InvalidTimeRangeError) ErrorKind() apierror.Kind { return apierror.BadRequest }

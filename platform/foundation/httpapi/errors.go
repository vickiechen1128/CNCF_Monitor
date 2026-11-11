// Package httpapi adapts foundation errors to the unified v3 HTTP envelope.
package httpapi

import (
	"fmt"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/foundation/apierror"
)

// WriteError maps err to the unified response envelope and writes it.
//
// 4xx kinds keep their user-facing messages; 5xx kinds are logged and replaced
// with the generic "internal error" / "service unavailable" text so internal
// details never reach clients.
func WriteError(c *gin.Context, err error) {
	if err == nil {
		response.InternalServerError(c, fmt.Errorf("httpapi: nil error"))
		return
	}
	switch apierror.KindOf(err) {
	case apierror.BadRequest:
		response.BadRequest(c, err)
	case apierror.Unauthorized:
		response.Unauthorized(c, err.Error())
	case apierror.Forbidden:
		response.Forbidden(c, err.Error())
	case apierror.NotFound:
		response.NotFound(c, err.Error())
	case apierror.Conflict:
		response.Conflict(c, err)
	case apierror.Unavailable:
		response.ServiceUnavailable(c, err)
	default:
		response.InternalServerError(c, err)
	}
}

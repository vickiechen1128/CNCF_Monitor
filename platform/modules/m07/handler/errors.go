package handler

import (
	"errors"
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
)

func respondError(c *gin.Context, err error) {
	var validation *domain.ValidationError
	var notFound *domain.NotFoundError
	var conflict *domain.ConflictError
	var forbidden *domain.ForbiddenError
	var unsupported *domain.UnsupportedCategoryError

	switch {
	case errors.As(err, &validation):
		response.BadRequest(c, validation)
	case errors.As(err, &notFound):
		response.NotFound(c, notFound.Error())
	case errors.As(err, &conflict):
		response.Conflict(c, conflict)
	case errors.As(err, &forbidden):
		response.Forbidden(c, forbidden.Error())
	case errors.As(err, &unsupported):
		response.BadRequest(c, unsupported)
	default:
		response.InternalServerError(c, fmt.Errorf("m07 handler: %w", err))
	}
}

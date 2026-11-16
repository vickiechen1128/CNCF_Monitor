package handler

import (
	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/foundation/httpapi"
)

// respondError maps M01 domain errors to the shared v3 envelope.
func respondError(c *gin.Context, err error) {
	httpapi.WriteError(c, err)
}

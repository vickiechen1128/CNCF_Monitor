package handler

import (
	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/foundation/httpapi"
)

// respondError maps M09 errors to the shared v3 envelope. The mapping lives in
// platform/foundation/httpapi so every v3 module behaves identically.
func respondError(c *gin.Context, err error) {
	httpapi.WriteError(c, err)
}

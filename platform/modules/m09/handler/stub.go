package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
)

// notImplemented is the B2 placeholder for routes whose handlers land in later
// batches (B3–B7). It returns a 501 with the unified envelope. Each stub is
// replaced individually as the corresponding feature batch lands.
func notImplemented(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, response.Response{
		Status:    response.StatusError,
		ErrorType: "not_implemented",
		Error:     "m09 handler not implemented yet",
	})
}

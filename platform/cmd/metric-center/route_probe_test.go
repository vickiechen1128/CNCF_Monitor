package main

import (
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRouteProbeParamNameConflict(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/api/v2/platform")
	func() {
		defer func() {
			if rec := recover(); rec != nil {
				t.Logf("PANIC on registering :type after :resource_id: %v", rec)
			}
		}()
		g.GET("/resources/:type/template", func(c *gin.Context) {})
		g.GET("/resources/:resource_id/labels", func(c *gin.Context) {})
		t.Log("no panic: gin allows different param names at same position")
	}()
}

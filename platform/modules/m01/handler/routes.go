// Package handler mounts the Module 01 v3 HTTP API.
package handler

import "github.com/gin-gonic/gin"

// RegisterRoutes mounts M01 v3 routes under the given platform group
// (expected prefix: /api/v3/platform).
//
// P1 only establishes the module skeleton; the resource groups land
// incrementally in B2+:
//
//	/exporter-templates        (B2)
//	/ci-exporter-mappings      (B2)
//	/scrape-jobs               (B3/B4)
//	/monitoring-rules          (B5)
//	/metric-library            (B6)
//	/business-metrics          (B6)
//	/blackbox-modules          (B6)
func RegisterRoutes(_ *gin.RouterGroup) {}

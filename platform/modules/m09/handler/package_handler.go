package handler

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/modules/m09/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
)

// PackageHandler exposes the offline edge package endpoints (contract §5).
type PackageHandler struct {
	svc *service.PackageService
}

// NewPackageHandler constructs the package handler.
func NewPackageHandler(svc *service.PackageService) *PackageHandler {
	return &PackageHandler{svc: svc}
}

// List handles GET /edge-packages.
func (h *PackageHandler) List(c *gin.Context) {
	items, err := h.svc.List(c.Request.Context())
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.EdgePackageResponse, 0, len(items))
	for i := range items {
		list = append(list, dto.FromEdgePackage(&items[i]))
	}
	response.OK(c, dto.ListEdgePackagesResponse{List: list, Total: int64(len(list))})
}

// Latest handles GET /edge-packages/latest.
func (h *PackageHandler) Latest(c *gin.Context) {
	item, err := h.svc.Latest(c.Request.Context())
	if err != nil {
		respondError(c, err)
		return
	}
	if item == nil {
		response.NotFound(c, "no edge package published yet; run `make build-edge-package` and retry")
		return
	}
	response.OK(c, dto.FromEdgePackage(item))
}

// Download handles GET /edge-packages/:file and streams the tar.gz.
func (h *PackageHandler) Download(c *gin.Context) {
	item, handle, err := h.svc.Open(c.Request.Context(), c.Param("file"))
	if err != nil {
		respondError(c, err)
		return
	}
	if item == nil || handle == nil {
		response.NotFound(c, "edge package not found")
		return
	}
	defer handle.Close()

	info, err := handle.Stat()
	if err != nil {
		respondError(c, err)
		return
	}
	c.Header("ETag", `"`+item.Sha256+`"`)
	c.Header("X-Checksum-Sha256", item.Sha256)
	c.Header("Content-Type", "application/gzip")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", item.File))
	http.ServeContent(c.Writer, c.Request, item.File, info.ModTime(), handle)
}

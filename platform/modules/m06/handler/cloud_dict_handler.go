package handler

import (
	"fmt"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/foundation/apiresponse"
	"github.com/metriccenter/metriccenter/platform/foundation/httpapi"
	"github.com/metriccenter/metriccenter/platform/modules/m06/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m06/service"
)

// CloudDictHandler exposes the M06 v3 cloud dictionary maintenance API (D37).
type CloudDictHandler struct {
	svc *service.CloudDictService
}

// NewCloudDictHandler constructs a cloud dictionary handler.
func NewCloudDictHandler(svc *service.CloudDictService) *CloudDictHandler {
	return &CloudDictHandler{svc: svc}
}

// Create handles POST /cloud-dict.
func (h *CloudDictHandler) Create(c *gin.Context) {
	var req dto.CreateCloudDictRequest
	if err := decodeStrictJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	item, err := h.svc.Create(c.Request.Context(), req.ToDomain())
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	response.OK(c, dto.FromCloudDict(item))
}

// Update handles PUT /cloud-dict/:cloud_code. Only `{"enabled": false}` is
// accepted: D37 forbids editing codes/attributes and deleting entries.
func (h *CloudDictHandler) Update(c *gin.Context) {
	var req dto.UpdateCloudDictRequest
	if err := decodeStrictJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	if req.Enabled == nil || *req.Enabled {
		response.BadRequest(c, fmt.Errorf("cloud dictionary only supports disabling (enabled=false)"))
		return
	}
	item, err := h.svc.Disable(c.Request.Context(), c.Param("cloud_code"))
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	response.OK(c, dto.FromCloudDict(item))
}

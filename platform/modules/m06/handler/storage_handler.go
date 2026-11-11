package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/foundation/httpapi"
	"github.com/metriccenter/metriccenter/platform/modules/m06/storage"
)

// StorageHandler exposes the storage & log administration API.
type StorageHandler struct {
	svc *storage.Service
}

// NewStorageHandler constructs a storage handler.
func NewStorageHandler(svc *storage.Service) *StorageHandler {
	return &StorageHandler{svc: svc}
}

// GetOverview handles GET /storage-logs. Prometheus being unavailable is a
// degraded response (runtime_available=false), not a request failure.
func (h *StorageHandler) GetOverview(c *gin.Context) {
	overview, err := h.svc.Overview(c.Request.Context())
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	response.OK(c, overview)
}

// UpdateRetention handles PUT /storage-logs/retention.
func (h *StorageHandler) UpdateRetention(c *gin.Context) {
	var req struct {
		Time string `json:"time"`
		Size string `json:"size"`
	}
	if err := decodeStrictJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	overview, err := h.svc.UpdateRetention(c.Request.Context(), req.Time, req.Size)
	if err != nil {
		if errors.Is(err, storage.ErrEnvFileNotConfigured) {
			// Keep the actionable message instead of the generic 503 text.
			c.JSON(http.StatusServiceUnavailable, response.Fail(response.ErrorTypeUnavailable, err))
			return
		}
		httpapi.WriteError(c, err)
		return
	}
	response.OK(c, overview)
}

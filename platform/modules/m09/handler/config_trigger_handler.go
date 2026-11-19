package handler

import (
	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/foundation/apiresponse"
	"github.com/metriccenter/metriccenter/platform/modules/m09/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
)

// ConfigTriggerHandler exposes the immediate config-sync trigger.
type ConfigTriggerHandler struct {
	svc *service.ConfigTriggerService
}

// NewConfigTriggerHandler constructs the handler.
func NewConfigTriggerHandler(svc *service.ConfigTriggerService) *ConfigTriggerHandler {
	return &ConfigTriggerHandler{svc: svc}
}

// Trigger handles POST /config-sync/trigger. It is mounted under the admin
// group; domain-scoped requests also verify that each domain is an enabled
// edge domain the caller may access.
func (h *ConfigTriggerHandler) Trigger(c *gin.Context) {
	var req dto.ConfigTriggerRequest
	if err := decodeStrictJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	result, err := h.svc.Trigger(c.Request.Context(), actorOf(c), service.TriggerRequest{
		Scope:            service.TriggerScope(req.Scope),
		NetworkDomainIDs: req.NetworkDomainIDs,
		Wait:             req.Wait,
	})
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromTriggerResult(result))
}

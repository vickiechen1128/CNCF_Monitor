package handler

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/modules/m09/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
)

// AgentHandler exposes the edge-agent read and command API.
type AgentHandler struct {
	svc *service.EdgeService
}

// NewAgentHandler constructs the edge-agent handler.
func NewAgentHandler(svc *service.EdgeService) *AgentHandler {
	return &AgentHandler{svc: svc}
}

// List handles GET /edge-agents.
func (h *AgentHandler) List(c *gin.Context) {
	page, pageSize := parsePagination(c)
	items, total, err := h.svc.ListAgents(c.Request.Context(), actorOf(c), repository.EdgeAgentFilter{
		NetworkDomainID: strings.TrimSpace(c.Query("network_domain_id")),
		Status:          strings.TrimSpace(c.Query("status")),
		Keyword:         strings.TrimSpace(c.Query("keyword")),
		Page:            page,
		PageSize:        pageSize,
	})
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.EdgeAgentResponse, 0, len(items))
	for i := range items {
		list = append(list, dto.FromEdgeAgent(&items[i]))
	}
	response.OK(c, dto.ListEdgeAgentsResponse{List: list, Total: total, Page: page, PageSize: pageSize})
}

// Get handles GET /edge-agents/:id.
func (h *AgentHandler) Get(c *gin.Context) {
	id, ok := parseAgentID(c)
	if !ok {
		return
	}
	agent, err := h.svc.GetAgent(c.Request.Context(), actorOf(c), id)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromEdgeAgent(agent))
}

// Restart handles PUT /edge-agents/:id/restart (admin).
func (h *AgentHandler) Restart(c *gin.Context) {
	id, ok := parseAgentID(c)
	if !ok {
		return
	}
	agent, err := h.svc.RestartAgent(c.Request.Context(), actorOf(c), id, auth.CurrentUsername(c))
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.EdgeAgentCommandResponse{ID: agent.ID, VMAgentRestartSeq: agent.VMAgentRestartSeq})
}

// FlushBacklog handles PUT /edge-agents/:id/flush-backlog (admin).
func (h *AgentHandler) FlushBacklog(c *gin.Context) {
	id, ok := parseAgentID(c)
	if !ok {
		return
	}
	agent, err := h.svc.FlushBacklogAgent(c.Request.Context(), actorOf(c), id, auth.CurrentUsername(c))
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.EdgeAgentCommandResponse{ID: agent.ID, FlushBacklogSeq: agent.FlushBacklogSeq})
}

func parseAgentID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		response.BadRequest(c, fmt.Errorf("id: must be a positive integer"))
		return 0, false
	}
	return id, true
}

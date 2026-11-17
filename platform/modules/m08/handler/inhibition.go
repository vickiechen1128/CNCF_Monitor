package handler

import (
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/modules/m08/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m08/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m08/service"
)

// InhibitionHandler exposes the inhibit-rule API (FR-18..20, D49).
type InhibitionHandler struct{ svc *service.InhibitionService }

// NewInhibitionHandler constructs the handler.
func NewInhibitionHandler(svc *service.InhibitionService) *InhibitionHandler {
	return &InhibitionHandler{svc: svc}
}

// List handles GET /alertmanager/inhibitions (searchable).
func (h *InhibitionHandler) List(c *gin.Context) {
	page, pageSize := parsePagination(c)
	filter := repository.InhibitionFilter{
		Keyword: strings.TrimSpace(c.Query("keyword")), Enabled: boolQuery(c, "enabled"),
		Page: page, PageSize: pageSize,
	}
	rules, total, err := h.svc.List(c.Request.Context(), filter)
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.InhibitionResponse, 0, len(rules))
	for _, rule := range rules {
		list = append(list, dto.FromInhibition(rule))
	}
	response.OK(c, gin.H{"list": list, "total": total, "page": page, "page_size": pageSize})
}

// Create handles POST /alertmanager/inhibitions.
func (h *InhibitionHandler) Create(c *gin.Context) {
	var req dto.InhibitionRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	rule, outcome, err := h.svc.Create(c.Request.Context(), req.ToDomain(), baseChecksumOf(c), operatorOf(c))
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, gin.H{"rule": dto.FromInhibition(rule), "save": saveResult(outcome)})
}

// Update handles PUT /alertmanager/inhibitions/{id}.
func (h *InhibitionHandler) Update(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, errRequired("id"))
		return
	}
	var req dto.InhibitionRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	rule, outcome, err := h.svc.Update(c.Request.Context(), id, req.ToDomain(), baseChecksumOf(c), operatorOf(c))
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, gin.H{"rule": dto.FromInhibition(rule), "save": saveResult(outcome)})
}

// SetStatus handles PATCH /alertmanager/inhibitions/{id}/status.
func (h *InhibitionHandler) SetStatus(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, errRequired("id"))
		return
	}
	var req struct {
		Enabled      *bool  `json:"enabled"`
		BaseChecksum string `json:"base_checksum"`
	}
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	if req.Enabled == nil {
		response.BadRequest(c, errRequired("enabled"))
		return
	}
	rule, outcome, err := h.svc.SetEnabled(c.Request.Context(), id, *req.Enabled, req.BaseChecksum, operatorOf(c))
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, gin.H{"rule": dto.FromInhibition(rule), "save": saveResult(outcome)})
}

// Delete handles DELETE /alertmanager/inhibitions/{id}.
func (h *InhibitionHandler) Delete(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, errRequired("id"))
		return
	}
	outcome, err := h.svc.Delete(c.Request.Context(), id, baseChecksumOf(c), operatorOf(c))
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, gin.H{"deleted": true, "save": saveResult(outcome)})
}

func baseChecksumOf(c *gin.Context) string { return strings.TrimSpace(c.Query("base_checksum")) }

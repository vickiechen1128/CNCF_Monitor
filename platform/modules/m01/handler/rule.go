package handler

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m01/service"
)

// RuleHandler exposes the monitoring rule API (FR-14 ~ FR-16).
type RuleHandler struct {
	svc *service.RuleService
}

// NewRuleHandler constructs the handler.
func NewRuleHandler(svc *service.RuleService) *RuleHandler {
	return &RuleHandler{svc: svc}
}

// List handles GET /monitoring-rules.
func (h *RuleHandler) List(c *gin.Context) {
	page, pageSize := parsePagination(c)
	filter := repository.RuleFilter{
		Enabled:     boolQuery(c, "enabled"),
		DraftStatus: domain.DraftStatus(strings.TrimSpace(c.Query("draft_status"))),
		MonitorType: strings.TrimSpace(c.Query("monitor_type")),
		Keyword:     strings.TrimSpace(c.Query("keyword")),
		Page:        page,
		PageSize:    pageSize,
	}
	rules, total, err := h.svc.List(c.Request.Context(), filter)
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.RuleResponse, 0, len(rules))
	for _, rule := range rules {
		list = append(list, dto.FromRule(rule))
	}
	response.OK(c, gin.H{"list": list, "total": total, "page": page, "page_size": pageSize})
}

// Create handles POST /monitoring-rules.
func (h *RuleHandler) Create(c *gin.Context) {
	var req dto.RuleRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	rule, err := h.svc.Create(c.Request.Context(), req.ToDomain(), req.AckJobRefErrors, req.AckReason)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromRule(rule))
}

// Get handles GET /monitoring-rules/{id}.
func (h *RuleHandler) Get(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, fmt.Errorf("id is required"))
		return
	}
	rule, err := h.svc.Get(c.Request.Context(), id)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromRule(rule))
}

// Update handles PUT /monitoring-rules/{id}.
func (h *RuleHandler) Update(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, fmt.Errorf("id is required"))
		return
	}
	var req dto.RuleRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	rule, err := h.svc.Update(c.Request.Context(), id, req.ToDomain(), req.AckJobRefErrors, req.AckReason)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromRule(rule))
}

// Delete handles DELETE /monitoring-rules/{id}.
func (h *RuleHandler) Delete(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, fmt.Errorf("id is required"))
		return
	}
	if err := h.svc.Delete(c.Request.Context(), id); err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, gin.H{"rule_id": id})
}

// Validate handles POST /monitoring-rules/validate.
func (h *RuleHandler) Validate(c *gin.Context) {
	var req dto.RuleValidateRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	result, err := h.svc.Validate(c.Request.Context(), strings.TrimSpace(req.ID), req.RuleContent)
	if err != nil {
		respondError(c, err)
		return
	}
	issues := result.JobRef
	if issues == nil {
		issues = []domain.JobRefIssue{}
	}
	response.OK(c, dto.RuleValidateResponse{
		Valid:  result.Valid,
		Error:  result.Error,
		Groups: result.Groups,
		Rules:  result.Rules,
		JobRef: issues,
		PromQL: dto.RulePromQL{Status: result.PromQLStatus, Error: result.PromQLError},
	})
}

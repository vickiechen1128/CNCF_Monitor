package handler

import (
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/foundation/apiresponse"
	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m08/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m08/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m08/service"
)

// SilenceHandler proxies Alertmanager silences and exposes the audit trail.
type SilenceHandler struct{ svc *service.SilenceService }

// NewSilenceHandler constructs the handler.
func NewSilenceHandler(svc *service.SilenceService) *SilenceHandler { return &SilenceHandler{svc: svc} }

// List handles GET /alertmanager/silences.
func (h *SilenceHandler) List(c *gin.Context) {
	silences, err := h.svc.List(c.Request.Context(), actorOf(c))
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, gin.H{"list": silences, "total": len(silences)})
}

// LabelOptions handles GET /alertmanager/silences/label-options.
func (h *SilenceHandler) LabelOptions(c *gin.Context) {
	options, err := h.svc.LabelOptions(c.Request.Context())
	if err != nil {
		respondError(c, err)
		return
	}
	items := make([]dto.LabelOption, 0, len(options))
	for _, option := range options {
		values := option.Values
		if values == nil {
			values = []string{}
		}
		items = append(items, dto.LabelOption{Name: option.Name, Values: values})
	}
	response.OK(c, gin.H{"items": items})
}

// Create handles POST /alertmanager/silences.
func (h *SilenceHandler) Create(c *gin.Context) {
	var req dto.CreateSilenceRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	if len(req.Matchers) == 0 {
		response.BadRequest(c, fmt.Errorf("matchers 不能为空"))
		return
	}
	if issues := domain.ValidateMatchers("matchers", req.Matchers); len(issues) > 0 {
		response.BadRequest(c, fmt.Errorf("%s: %s", issues[0].Field, issues[0].Message))
		return
	}
	startsAt, err := parseRFC3339(req.StartsAt, "starts_at")
	if err != nil {
		response.BadRequest(c, err)
		return
	}
	endsAt, err := parseRFC3339(req.EndsAt, "ends_at")
	if err != nil {
		response.BadRequest(c, err)
		return
	}
	if !endsAt.After(startsAt) {
		response.BadRequest(c, fmt.Errorf("ends_at 必须晚于 starts_at"))
		return
	}
	silence, err := h.svc.Create(c.Request.Context(), actorOf(c), service.SilenceInput{
		Matchers: req.Matchers, StartsAt: startsAt, EndsAt: endsAt,
		CreatedBy: req.CreatedBy, Comment: req.Comment,
	})
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, silence)
}

// Delete handles DELETE /alertmanager/silences/{silence_id}.
func (h *SilenceHandler) Delete(c *gin.Context) {
	id := strings.TrimSpace(c.Param("silence_id"))
	if id == "" {
		response.BadRequest(c, errRequired("silence_id"))
		return
	}
	if err := h.svc.Delete(c.Request.Context(), actorOf(c), id); err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, gin.H{"silence_id": id})
}

// Audits handles GET /alertmanager/silence-audits (read-only, D50).
func (h *SilenceHandler) Audits(c *gin.Context) {
	page, pageSize := parsePagination(c)
	filter := repository.AuditFilter{
		Operator: strings.TrimSpace(c.Query("operator")),
		Action:   strings.TrimSpace(c.Query("action")),
		SilenceID: strings.TrimSpace(c.Query("silence_id")),
		Page: page, PageSize: pageSize,
	}
	if from, err := parseOptionalTime(c.Query("from")); err == nil {
		filter.From = from
	} else {
		response.BadRequest(c, err)
		return
	}
	if to, err := parseOptionalTime(c.Query("to")); err == nil {
		filter.To = to
	} else {
		response.BadRequest(c, err)
		return
	}
	entries, total, err := h.svc.Audits(c.Request.Context(), filter)
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.AuditResponse, 0, len(entries))
	for _, entry := range entries {
		matchers := entry.Matchers
		if matchers == nil {
			matchers = []domain.Matcher{}
		}
		list = append(list, dto.AuditResponse{
			ID: fmt.Sprintf("%d", entry.ID), Action: string(entry.Action),
			Result: string(entry.Result), Operator: entry.Operator, SilenceID: entry.SilenceID,
			Matchers: matchers, Reason: entry.Reason, FailureReason: entry.FailureReason,
			At: entry.At.UTC().Format(time.RFC3339),
		})
	}
	response.OK(c, gin.H{"list": list, "total": total, "page": page, "page_size": pageSize})
}

func parseRFC3339(value, field string) (time.Time, error) {
	parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(value))
	if err != nil {
		return time.Time{}, fmt.Errorf("%s 必须是 RFC3339 时间（如 2026-11-16T22:00:00+08:00）", field)
	}
	return parsed, nil
}

func parseOptionalTime(value string) (*time.Time, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}
	parsed, err := parseRFC3339(value, "时间参数")
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

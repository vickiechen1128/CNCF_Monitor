package handler

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/foundation/apiresponse"
	"github.com/metriccenter/metriccenter/platform/modules/m08/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m08/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m08/service"
)

// ChannelHandler exposes notification channels (FR-09).
type ChannelHandler struct{ svc *service.ChannelService }

// NewChannelHandler constructs the handler.
func NewChannelHandler(svc *service.ChannelService) *ChannelHandler { return &ChannelHandler{svc: svc} }

// List handles GET /alertmanager/notify-channels.
func (h *ChannelHandler) List(c *gin.Context) {
	page, pageSize := parsePagination(c)
	filter := repository.ChannelFilter{
		Keyword:     strings.TrimSpace(c.Query("keyword")),
		ChannelType: strings.TrimSpace(c.Query("channel_type")),
		Page:        page, PageSize: pageSize,
	}
	channels, total, counts, err := h.svc.List(c.Request.Context(), filter)
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.ChannelResponse, 0, len(channels))
	for _, channel := range channels {
		list = append(list, dto.FromChannel(channel, counts[channel.ID]))
	}
	response.OK(c, gin.H{"list": list, "total": total, "page": page, "page_size": pageSize})
}

// Create handles POST /alertmanager/notify-channels.
func (h *ChannelHandler) Create(c *gin.Context) {
	var req dto.ChannelRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	channel, err := h.svc.Create(c.Request.Context(), req.ToDomain())
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromChannel(channel, 0))
}

// Update handles PUT /alertmanager/notify-channels/{id}.
func (h *ChannelHandler) Update(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, errRequired("id"))
		return
	}
	var req dto.ChannelRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	channel, err := h.svc.Update(c.Request.Context(), id, req.ToDomain())
	if err != nil {
		respondError(c, err)
		return
	}
	count := 0
	if _, current, err := h.svc.Get(c.Request.Context(), id); err == nil {
		count = current
	}
	response.OK(c, dto.FromChannel(channel, count))
}

// Delete handles DELETE /alertmanager/notify-channels/{id}.
func (h *ChannelHandler) Delete(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, errRequired("id"))
		return
	}
	if err := h.svc.Delete(c.Request.Context(), id); err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, gin.H{"channel_id": id})
}

// TemplateHandler exposes notification templates (FR-10).
type TemplateHandler struct{ svc *service.TemplateService }

// NewTemplateHandler constructs the handler.
func NewTemplateHandler(svc *service.TemplateService) *TemplateHandler {
	return &TemplateHandler{svc: svc}
}

// List handles GET /alertmanager/notify-templates.
func (h *TemplateHandler) List(c *gin.Context) {
	page, pageSize := parsePagination(c)
	filter := repository.TemplateFilter{
		ChannelType: strings.TrimSpace(c.Query("channel_type")),
		Keyword:     strings.TrimSpace(c.Query("keyword")),
		Builtin:     boolQuery(c, "builtin"),
		Page:        page, PageSize: pageSize,
	}
	templates, total, counts, err := h.svc.List(c.Request.Context(), filter)
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.TemplateResponse, 0, len(templates))
	for _, template := range templates {
		list = append(list, dto.FromTemplate(template, counts[template.ID]))
	}
	response.OK(c, gin.H{"list": list, "total": total, "page": page, "page_size": pageSize})
}

// Get handles GET /alertmanager/notify-templates/{id}.
func (h *TemplateHandler) Get(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, errRequired("id"))
		return
	}
	template, count, err := h.svc.Get(c.Request.Context(), id)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromTemplate(template, count))
}

// Create handles POST /alertmanager/notify-templates.
func (h *TemplateHandler) Create(c *gin.Context) {
	var req dto.TemplateRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	template, err := h.svc.Create(c.Request.Context(), req.ToDomain())
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromTemplate(template, 0))
}

// Update handles PUT /alertmanager/notify-templates/{id}.
func (h *TemplateHandler) Update(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, errRequired("id"))
		return
	}
	var req dto.TemplateRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	template, err := h.svc.Update(c.Request.Context(), id, req.ToDomain())
	if err != nil {
		respondError(c, err)
		return
	}
	count := int64(0)
	if _, current, err := h.svc.Get(c.Request.Context(), id); err == nil {
		count = current
	}
	response.OK(c, dto.FromTemplate(template, count))
}

// Delete handles DELETE /alertmanager/notify-templates/{id}.
func (h *TemplateHandler) Delete(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, errRequired("id"))
		return
	}
	if err := h.svc.Delete(c.Request.Context(), id); err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, gin.H{"template_id": id})
}

func errRequired(field string) error { return fmt.Errorf("%s 不能为空", field) }

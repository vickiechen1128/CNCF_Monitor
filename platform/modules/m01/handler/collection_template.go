package handler

import (
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/foundation/apiresponse"
	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m01/references"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m01/service"
)

// CollectionTemplateHandler serves the collection template API (FR-21 / FR-24).
type CollectionTemplateHandler struct {
	svc    *service.CollectionTemplateService
	fields references.CustomFieldReader
}

// NewCollectionTemplateHandler constructs the handler. A nil custom-field reader
// means the field dictionary only lists built-in fields.
func NewCollectionTemplateHandler(svc *service.CollectionTemplateService, fields references.CustomFieldReader) *CollectionTemplateHandler {
	return &CollectionTemplateHandler{svc: svc, fields: fields}
}

// List handles GET /collection-templates.
func (h *CollectionTemplateHandler) List(c *gin.Context) {
	page, pageSize := parsePagination(c)
	filter := repository.TemplateFilter{
		ResourceCategory: strings.TrimSpace(c.Query("resource_category")),
		Keyword:          strings.TrimSpace(c.Query("keyword")),
		Page:             page,
		PageSize:         pageSize,
	}
	if raw := strings.TrimSpace(c.Query("enabled")); raw != "" {
		enabled := raw == "true" || raw == "1"
		filter.Enabled = &enabled
	}
	views, total, err := h.svc.List(requestContext(c), filter)
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.CollectionTemplateResponse, 0, len(views))
	for _, view := range views {
		list = append(list, dto.FromCollectionTemplate(view.Template, view.ExporterTemplateName, view.LabelTemplateName, view.JobCount))
	}
	response.OK(c, gin.H{"list": list, "total": total, "page": page, "page_size": pageSize})
}

// Get handles GET /collection-templates/{code}.
func (h *CollectionTemplateHandler) Get(c *gin.Context) {
	view, err := h.svc.Get(requestContext(c), c.Param("code"))
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromCollectionTemplate(view.Template, view.ExporterTemplateName, view.LabelTemplateName, view.JobCount))
}

// Create handles POST /collection-templates.
func (h *CollectionTemplateHandler) Create(c *gin.Context) {
	var req dto.CollectionTemplateRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	template := req.ToDomain("")
	view, err := h.svc.Create(requestContext(c), &template)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromCollectionTemplate(view.Template, view.ExporterTemplateName, view.LabelTemplateName, view.JobCount))
}

// Update handles PUT /collection-templates/{code}.
func (h *CollectionTemplateHandler) Update(c *gin.Context) {
	var req dto.CollectionTemplateRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	template := req.ToDomain(c.Param("code"))
	view, err := h.svc.Update(requestContext(c), c.Param("code"), &template)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromCollectionTemplate(view.Template, view.ExporterTemplateName, view.LabelTemplateName, view.JobCount))
}

// Delete handles DELETE /collection-templates/{code}.
func (h *CollectionTemplateHandler) Delete(c *gin.Context) {
	code := strings.TrimSpace(c.Param("code"))
	if err := h.svc.Delete(requestContext(c), code); err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, gin.H{"code": code})
}

// Impact handles GET /collection-templates/{code}/impact.
func (h *CollectionTemplateHandler) Impact(c *gin.Context) {
	counts, template, err := h.svc.Impact(requestContext(c), c.Param("code"))
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.TemplateImpactResponse{
		Code:          template.Code,
		ReferenceJobs: counts.Jobs,
		MetricAnchors: counts.MetricAnchors,
		UpdatedAt:     formatTemplateTime(template.UpdatedAt),
	})
}

func formatTemplateTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

// CandidateFields handles GET /candidate-fields: the selector field dictionary.
//
// Built-in fields come from the M01 dictionary; custom fields come from M07 and
// require no M01 release to become filterable (NFR-11).
func (h *CollectionTemplateHandler) CandidateFields(c *gin.Context) {
	fields := make([]dto.CandidateFieldResponse, 0, 32)
	for _, spec := range domain.FieldSpecs() {
		fields = append(fields, dto.FromFieldSpec(spec))
	}
	if h.fields != nil {
		custom, err := h.fields.ListCustomFields(requestContext(c))
		if err != nil {
			respondError(c, err)
			return
		}
		for _, field := range custom {
			fields = append(fields, dto.NewCustomFieldResponse(field.Key, field.Label, field.ValueType, field.ResourceCategory))
		}
	}
	response.OK(c, gin.H{"list": fields, "total": len(fields)})
}

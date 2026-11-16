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

// JobHandler exposes the scrape job API (FR-05 ~ FR-11).
type JobHandler struct {
	svc *service.JobService
}

// NewJobHandler constructs the handler.
func NewJobHandler(svc *service.JobService) *JobHandler {
	return &JobHandler{svc: svc}
}

// List handles GET /scrape-jobs.
func (h *JobHandler) List(c *gin.Context) {
	page, pageSize := parsePagination(c)
	filter := repository.JobFilter{
		NetworkDomainID: strings.TrimSpace(c.Query("network_domain_id")),
		MonitorType:     strings.TrimSpace(c.Query("monitor_type")),
		JobType:         domain.JobType(strings.TrimSpace(c.Query("job_type"))),
		Enabled:         boolQuery(c, "enabled"),
		DraftStatus:     domain.DraftStatus(strings.TrimSpace(c.Query("draft_status"))),
		LabelTemplateID: strings.TrimSpace(c.Query("label_template_id")),
		Keyword:         strings.TrimSpace(c.Query("keyword")),
		Page:            page,
		PageSize:        pageSize,
	}
	views, total, err := h.svc.List(c.Request.Context(), filter)
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.JobResponse, 0, len(views))
	for _, view := range views {
		list = append(list, dto.FromJob(view.Job, view.ExporterName, view.DomainName, view.LabelTemplateName))
	}
	response.OK(c, gin.H{"list": list, "total": total, "page": page, "page_size": pageSize})
}

// Create handles POST /scrape-jobs.
func (h *JobHandler) Create(c *gin.Context) {
	var req dto.JobRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	view, err := h.svc.Create(c.Request.Context(), req.ToDomain(), req.Enabled)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromJob(view.Job, view.ExporterName, view.DomainName, view.LabelTemplateName))
}

// Get handles GET /scrape-jobs/{id}.
func (h *JobHandler) Get(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, fmt.Errorf("id is required"))
		return
	}
	view, err := h.svc.Get(c.Request.Context(), id)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromJob(view.Job, view.ExporterName, view.DomainName, view.LabelTemplateName))
}

// Update handles PUT /scrape-jobs/{id}.
func (h *JobHandler) Update(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, fmt.Errorf("id is required"))
		return
	}
	var req dto.JobRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	view, err := h.svc.Update(c.Request.Context(), id, req.ToDomain(), req.Enabled, req.SyncMappingDefaults)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromJob(view.Job, view.ExporterName, view.DomainName, view.LabelTemplateName))
}

// Delete handles DELETE /scrape-jobs/{id}.
func (h *JobHandler) Delete(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, fmt.Errorf("id is required"))
		return
	}
	if err := h.svc.Delete(c.Request.Context(), id); err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, gin.H{"job_id": id})
}

// Candidates handles GET /scrape-jobs/instance-candidates.
func (h *JobHandler) Candidates(c *gin.Context) {
	page, pageSize := parsePagination(c)
	query := domain.CandidateQuery{
		MonitorType:     strings.TrimSpace(c.Query("monitor_type")),
		Category:        domain.ResourceCategory(strings.TrimSpace(c.Query("resource_category"))),
		NetworkDomainID: strings.TrimSpace(c.Query("network_domain_id")),
		Keyword:         strings.TrimSpace(c.Query("keyword")),
		Page:            page,
		PageSize:        pageSize,
	}
	views, total, err := h.svc.ListCandidates(c.Request.Context(), query)
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.CandidateResponse, 0, len(views))
	for _, view := range views {
		list = append(list, dto.FromCandidate(view.Ref, view.MonitorType, view.TargetAddress, view.Selectable, view.DisabledReason))
	}
	response.OK(c, gin.H{"list": list, "total": total, "page": page, "page_size": pageSize})
}

// Instances handles GET /scrape-jobs/{id}/instances.
func (h *JobHandler) Instances(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, fmt.Errorf("id is required"))
		return
	}
	views, err := h.svc.ListInstances(c.Request.Context(), id)
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.JobInstanceResponse, 0, len(views))
	for _, view := range views {
		list = append(list, dto.JobInstanceResponse{
			ResourceID:    view.Ref.ID,
			DisplayName:   view.Ref.DisplayName,
			InstanceIP:    view.Ref.InstanceIP,
			Port:          view.Ref.Port,
			Status:        view.Ref.Status,
			TargetAddress: view.TargetAddress,
			Installation:  dto.FromInstallation(view.Installation),
		})
	}
	response.OK(c, gin.H{"list": list, "total": len(list)})
}

// ConfirmInstallation handles POST /scrape-jobs/{id}/instances/{resource_id}/confirm.
func (h *JobHandler) ConfirmInstallation(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	resourceID := strings.TrimSpace(c.Param("resource_id"))
	if id == "" || resourceID == "" {
		response.BadRequest(c, fmt.Errorf("job id and resource_id are required"))
		return
	}
	var req dto.InstallationRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	note, err := h.svc.ConfirmInstallation(c.Request.Context(), id, resourceID, req.ActualPort, req.ConfirmedBy, req.Notes)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, gin.H{
		"resource_id":  resourceID,
		"job_id":       id,
		"installation": dto.FromInstallation(note),
	})
}

// DeleteInstallation handles DELETE /scrape-jobs/{id}/instances/{resource_id}/confirm.
func (h *JobHandler) DeleteInstallation(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	resourceID := strings.TrimSpace(c.Param("resource_id"))
	if id == "" || resourceID == "" {
		response.BadRequest(c, fmt.Errorf("job id and resource_id are required"))
		return
	}
	if err := h.svc.DeleteInstallation(c.Request.Context(), id, resourceID); err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, gin.H{"resource_id": resourceID, "job_id": id})
}

// Preview handles POST /scrape-jobs/{id}/preview-targets.
func (h *JobHandler) Preview(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, fmt.Errorf("id is required"))
		return
	}
	jobName, targets, skipped, err := h.svc.Preview(c.Request.Context(), id)
	if err != nil {
		respondError(c, err)
		return
	}
	outTargets := make([]dto.PreviewTarget, 0, len(targets))
	for _, target := range targets {
		outTargets = append(outTargets, dto.PreviewTarget{Targets: target.Targets, Labels: target.Labels})
	}
	outSkipped := make([]dto.PreviewSkip, 0, len(skipped))
	for _, skip := range skipped {
		outSkipped = append(outSkipped, dto.PreviewSkip{ResourceID: skip.ResourceID, Reason: skip.Reason})
	}
	response.OK(c, dto.PreviewResponse{JobName: jobName, Targets: outTargets, Skipped: outSkipped})
}

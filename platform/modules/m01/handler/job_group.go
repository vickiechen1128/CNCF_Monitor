package handler

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/foundation/apiresponse"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m01/service"
)

// JobGroupHandler exposes the job-group (monitoring intent) API.
//
// The group is the object-first entry: one submit covers every network domain
// the selected instances belong to. Dispatch stays per-domain (child jobs), so
// M09 is unaffected (SRS JG v1.0 §2.2).
type JobGroupHandler struct {
	svc *service.JobGroupService
}

// NewJobGroupHandler constructs the handler.
func NewJobGroupHandler(svc *service.JobGroupService) *JobGroupHandler {
	return &JobGroupHandler{svc: svc}
}

// List handles GET /job-groups.
func (h *JobGroupHandler) List(c *gin.Context) {
	page, pageSize := parsePagination(c)
	views, total, err := h.svc.List(c.Request.Context(), repository.JobGroupFilter{
		Status:   domain.JobGroupStatus(strings.TrimSpace(c.Query("status"))),
		Keyword:  strings.TrimSpace(c.Query("keyword")),
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.JobGroupResponse, 0, len(views))
	for _, view := range views {
		list = append(list, fromJobGroupView(view))
	}
	response.OK(c, gin.H{"list": list, "total": total, "page": page, "page_size": pageSize})
}

// Create handles POST /job-groups.
func (h *JobGroupHandler) Create(c *gin.Context) {
	var req dto.JobGroupRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	view, err := h.svc.Create(requestContext(c), jobGroupInput(req, auth.CurrentUsername(c)))
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, fromJobGroupView(view))
}

// Adopt handles POST /job-groups/from-job: promote an existing single-domain
// job into a task (multi-domain) by reusing its row as one child (SRS JG v1.3).
func (h *JobGroupHandler) Adopt(c *gin.Context) {
	var req dto.AdoptJobGroupRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	if strings.TrimSpace(req.JobID) == "" {
		response.BadRequest(c, fmt.Errorf("job_id is required"))
		return
	}
	view, err := h.svc.Adopt(
		requestContext(c), req.JobID, jobGroupInput(req.JobGroupRequest, auth.CurrentUsername(c)),
	)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, fromJobGroupView(view))
}

// Get handles GET /job-groups/{id}.
func (h *JobGroupHandler) Get(c *gin.Context) {
	id, ok := jobGroupID(c)
	if !ok {
		return
	}
	view, err := h.svc.Get(c.Request.Context(), id)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, fromJobGroupView(view))
}

// Update handles PUT /job-groups/{id}.
func (h *JobGroupHandler) Update(c *gin.Context) {
	id, ok := jobGroupID(c)
	if !ok {
		return
	}
	var req dto.JobGroupRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	view, err := h.svc.Update(requestContext(c), id, jobGroupInput(req, auth.CurrentUsername(c)))
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, fromJobGroupView(view))
}

// Delete handles DELETE /job-groups/{id}.
func (h *JobGroupHandler) Delete(c *gin.Context) {
	id, ok := jobGroupID(c)
	if !ok {
		return
	}
	if err := h.svc.Delete(c.Request.Context(), id); err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, gin.H{"job_group_id": id})
}

func jobGroupID(c *gin.Context) (string, bool) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, fmt.Errorf("id is required"))
		return "", false
	}
	return id, true
}

// jobGroupInput maps the request to the service input (credentials stay
// plaintext until the service seals them per child job).
func jobGroupInput(req dto.JobGroupRequest, createdBy string) service.JobGroupInput {
	return service.JobGroupInput{
		Name:                req.Name,
		JobName:             req.JobName,
		JobType:             domain.JobType(req.JobType),
		ResourceCategory:    domain.ResourceCategory(req.ResourceCategory),
		MonitorType:         req.MonitorType,
		ExporterTemplateID:  req.ExporterTemplateID,
		ScrapeInterval:      req.ScrapeInterval,
		ScrapeTimeout:       req.ScrapeTimeout,
		MetricsPath:         req.MetricsPath,
		Scheme:              domain.Scheme(req.Scheme),
		AuthType:            domain.AuthType(req.AuthType),
		Username:            req.Username,
		Password:            req.Password,
		Token:               req.Token,
		TLSSkipVerify:       req.TLSSkipVerify,
		CAFile:              req.CAFile,
		LabelTemplateID:     req.LabelTemplateID,
		BlackboxModule:      req.BlackboxModule,
		SelectedInstanceIDs: req.SelectedInstanceIDs,
		Enabled:             req.Enabled,
		Status:              domain.JobGroupStatus(req.Status),
		CreatedBy:           createdBy,
	}
}

// fromJobGroupView builds the response: group params + per-domain children +
// derived sync summary.
func fromJobGroupView(view *service.JobGroupView) dto.JobGroupResponse {
	group := view.Group
	children := make([]dto.JobGroupChildResponse, 0, len(view.Children))
	jobName := ""
	for _, child := range view.Children {
		if jobName == "" {
			jobName = child.Job.JobName
		}
		item := dto.JobGroupChildResponse{
			NetworkDomainID:   child.DomainID,
			NetworkDomainName: child.DomainName,
			JobID:             child.Job.ID,
			JobName:           child.Job.JobName,
			InstanceCount:     len(child.Job.SelectedInstanceIDs),
			Enabled:           child.Job.Enabled,
			SyncStatus:        string(child.Job.Sync.Status),
			SyncVersion:       child.Job.Sync.Version,
			SyncError:         child.Job.Sync.Error,
			SyncedAt:          child.Job.Sync.SyncedAt,
		}
		if child.View != nil {
			job := dto.FromJob(
				child.View.Job, child.View.ExporterName, child.View.DomainName,
				child.View.LabelTemplateName, child.View.GroupName,
			)
			item.Job = &job
		}
		children = append(children, item)
	}
	return dto.JobGroupResponse{
		ID:                 group.ID,
		Name:               group.Name,
		JobName:            jobName,
		JobType:            string(group.JobType),
		ResourceCategory:   string(group.ResourceCategory),
		MonitorType:        group.MonitorType,
		ExporterTemplateID: group.ExporterTemplateID,
		ScrapeInterval:     group.ScrapeInterval,
		ScrapeTimeout:      group.ScrapeTimeout,
		MetricsPath:        group.MetricsPath,
		Scheme:             string(group.Scheme),
		AuthType:           string(group.AuthType),
		Username:           group.Username,
		TLSSkipVerify:      group.TLSSkipVerify,
		CAFile:             group.CAFile,
		LabelTemplateID:    group.LabelTemplateID,
		BlackboxModule:     group.BlackboxModule,
		TargetField:        group.TargetField,
		Status:             string(group.Status),
		CreatedBy:          group.CreatedBy,
		CreatedAt:          group.CreatedAt,
		UpdatedAt:          group.UpdatedAt,
		Domains:            children,
		Sync: dto.JobGroupSyncResponse{
			Status:  view.Sync.Status,
			Total:   view.Sync.Total,
			Synced:  view.Sync.Synced,
			Failed:  view.Sync.Failed,
			Pending: view.Sync.Pending,
			Draft:   view.Sync.Draft,
		},
	}
}

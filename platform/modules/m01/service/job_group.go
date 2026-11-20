package service

import (
	"context"
	"sort"
	"strings"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
)

// JobGroupSyncSummary is the derived group-level sync state (SRS FR-JG-05).
// It is computed from the child jobs on every read and never persisted.
type JobGroupSyncSummary struct {
	Status  string
	Total   int
	Synced  int
	Failed  int
	Pending int
	Draft   int
}

// JobGroupChildView is one child job plus its network-domain display name.
type JobGroupChildView struct {
	DomainID   string
	DomainName string
	Job        *domain.Job
	// View carries the full job projection (exporter/label/template names,
	// instance count) so merged tables reuse the rich job columns.
	View *JobView
}

// JobGroupView is the maintenance view: one intent, its per-domain children and
// the derived group status.
type JobGroupView struct {
	Group    *domain.JobGroup
	Children []JobGroupChildView
	Sync     JobGroupSyncSummary
}

// JobGroupInput is the object-first create/update payload: the common scrape
// parameters plus the instances the user picked. The instances may span several
// network domains; the service groups them and creates one child job per domain.
type JobGroupInput struct {
	Name                string
	JobName             string
	JobType             domain.JobType
	ResourceCategory    domain.ResourceCategory
	TemplateCode        string
	Selector            domain.Selector
	ExporterTemplateID  string
	ScrapeInterval      string
	ScrapeTimeout       string
	MetricsPath         string
	Scheme              domain.Scheme
	AuthType            domain.AuthType
	Username            string
	Password            string
	Token               string
	TLSSkipVerify       bool
	CAFile              string
	LabelTemplateID     string
	BlackboxModule      string
	SelectedInstanceIDs []string
	Enabled             *bool
	Status              domain.JobGroupStatus
	CreatedBy           string
}

// JobGroupService owns job groups (monitoring intents). Multi-domain exists only
// at this layer: every child job stays single-domain so M09 needs no change.
type JobGroupService struct {
	groups    repository.JobGroupRepository
	jobs      *JobService
	resources ResourceReader
	domains   DomainReader
}

// NewJobGroupService constructs the service.
func NewJobGroupService(
	groups repository.JobGroupRepository,
	jobs *JobService,
	resources ResourceReader,
	domains DomainReader,
) *JobGroupService {
	return &JobGroupService{groups: groups, jobs: jobs, resources: resources, domains: domains}
}

// Create validates and persists one group plus one child job per network domain.
func (s *JobGroupService) Create(ctx context.Context, input JobGroupInput) (*JobGroupView, error) {
	group, toCreate, toUpdate, toRemove, err := s.buildPlan(ctx, nil, nil, input)
	if err != nil {
		return nil, err
	}
	if err := s.groups.Apply(ctx, repository.GroupPlan{
		Group:        group,
		CreateGroup:  true,
		JobsToCreate: toCreate,
		JobsToUpdate: toUpdate,
		JobsToDelete: toRemove,
	}); err != nil {
		return nil, err
	}
	return s.view(ctx, group)
}

// Update recomputes the child jobs from the new instance set: existing domains
// are updated, new domains get a child, domains with no instance left are removed.
func (s *JobGroupService) Update(ctx context.Context, id string, input JobGroupInput) (*JobGroupView, error) {
	group, err := s.groups.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	children, err := s.groups.ListJobsByGroup(ctx, id)
	if err != nil {
		return nil, err
	}
	planned, toCreate, toUpdate, toRemove, err := s.buildPlan(ctx, group, children, input)
	if err != nil {
		return nil, err
	}
	if err := s.groups.Apply(ctx, repository.GroupPlan{
		Group:        planned,
		UpdateGroup:  true,
		JobsToCreate: toCreate,
		JobsToUpdate: toUpdate,
		JobsToDelete: toRemove,
	}); err != nil {
		return nil, err
	}
	return s.view(ctx, planned)
}

// SetEnabled toggles the group's enabled state and cascades it to every child
// job in one transaction (SRS JG v1.0 §11: the group owns the enabled state, a
// child may not change it on its own).
//
// Enabling re-checks that each child still has at least one instance that has
// not been deleted (offline instances stay allowed, matching job edit rules) and
// marks children pending so M09 regenerates the per-domain config. Disabling
// keeps the rows so the user can re-enable later; M09 drops them from the next
// package because it only renders enabled + ready jobs.
func (s *JobGroupService) SetEnabled(ctx context.Context, id string, enabled bool) (*JobGroupView, error) {
	group, err := s.groups.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	children, err := s.groups.ListJobsByGroup(ctx, id)
	if err != nil {
		return nil, err
	}
	if len(children) == 0 {
		return nil, &domain.ConflictError{
			Entity:  "job_group",
			Field:   "id",
			Value:   id,
			Message: "job group has no child jobs; edit the group and pick instances first",
		}
	}
	for _, child := range children {
		if enabled {
			if len(child.SelectedInstanceIDs) == 0 {
				return nil, domain.NewValidationErrorf("selected_instance_ids",
					"job %q has no instance; edit the group and pick instances first", child.JobName)
			}
			if s.jobs != nil {
				if err := s.jobs.validateInstances(ctx, child, child); err != nil {
					return nil, err
				}
			}
		}
		child.Enabled = enabled
		if enabled {
			child.Sync = domain.SyncState{Status: domain.SyncPending}
		} else {
			child.Sync = domain.SyncState{Status: domain.SyncDraft}
		}
	}
	if enabled {
		group.Status = domain.JobGroupStatusEnabled
	} else {
		group.Status = domain.JobGroupStatusDisabled
	}
	if err := s.groups.Apply(ctx, repository.GroupPlan{
		Group:        group,
		UpdateGroup:  true,
		JobsToUpdate: children,
	}); err != nil {
		return nil, err
	}
	return s.view(ctx, group)
}

// Delete soft-deletes the group and its child jobs in one transaction.
func (s *JobGroupService) Delete(ctx context.Context, id string) error {
	group, err := s.groups.Get(ctx, id)
	if err != nil {
		return err
	}
	children, err := s.groups.ListJobsByGroup(ctx, id)
	if err != nil {
		return err
	}
	ids := make([]string, 0, len(children))
	for _, child := range children {
		ids = append(ids, child.ID)
	}
	return s.groups.Apply(ctx, repository.GroupPlan{
		Group:        group,
		DeleteGroup:  true,
		JobsToDelete: ids,
	})
}

// List returns a page of group views (children batch-loaded, derived status).
func (s *JobGroupService) List(ctx context.Context, filter repository.JobGroupFilter) ([]*JobGroupView, int64, error) {
	groups, total, err := s.groups.List(ctx, filter)
	if err != nil {
		return nil, 0, err
	}
	ids := make([]string, 0, len(groups))
	for _, group := range groups {
		ids = append(ids, group.ID)
	}
	childrenByGroup, err := s.groups.ListJobsByGroups(ctx, ids)
	if err != nil {
		return nil, 0, err
	}
	domainNames := make(map[string]string, len(ids))
	views := make([]*JobGroupView, 0, len(groups))
	for _, group := range groups {
		children := childrenByGroup[group.ID]
		childViews := make([]JobGroupChildView, 0, len(children))
		for _, child := range children {
			domainName, ok := domainNames[child.NetworkDomainID]
			if !ok {
				domainName = child.NetworkDomainID
				if s.domains != nil {
					if ref, found, err := s.domains.Get(ctx, child.NetworkDomainID); err == nil && found {
						domainName = ref.Name
					}
				}
				domainNames[child.NetworkDomainID] = domainName
			}
			childView := JobGroupChildView{
				DomainID: child.NetworkDomainID, DomainName: domainName, Job: child,
			}
			if s.jobs != nil {
				if view, err := s.jobs.view(ctx, child); err == nil {
					childView.View = view
				}
			}
			childViews = append(childViews, childView)
		}
		views = append(views, &JobGroupView{
			Group: group, Children: childViews, Sync: DeriveGroupSyncSummary(group, children),
		})
	}
	return views, total, nil
}

// Get returns the group view (children + derived status).
func (s *JobGroupService) Get(ctx context.Context, id string) (*JobGroupView, error) {
	group, err := s.groups.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	return s.view(ctx, group)
}

// buildPlan validates the input and derives the group + child-job delta.
func (s *JobGroupService) buildPlan(
	ctx context.Context,
	existing *domain.JobGroup,
	existingChildren []*domain.Job,
	input JobGroupInput,
) (*domain.JobGroup, []*domain.Job, []*domain.Job, []string, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return nil, nil, nil, nil, domain.NewValidationError("name", "is required")
	}
	if existing == nil || existing.Name != name {
		count, err := s.groups.CountByName(ctx, name)
		if err != nil {
			return nil, nil, nil, nil, err
		}
		if count > 0 {
			return nil, nil, nil, nil, &domain.ConflictError{Entity: "job_group", Field: "name", Value: name}
		}
	}

	ids := uniqueStrings(input.SelectedInstanceIDs)
	if len(ids) == 0 {
		return nil, nil, nil, nil, domain.NewValidationError("selected_instance_ids",
			"at least one instance is required for a job group")
	}
	refs, err := s.resources.GetMany(ctx, ids)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	byDomain := make(map[string][]string, len(refs))
	for _, id := range ids {
		ref, ok := refs[id]
		if !ok {
			return nil, nil, nil, nil, domain.NewValidationErrorf("selected_instance_ids",
				"resource %q not found", id)
		}
		byDomain[ref.NetworkDomainID] = append(byDomain[ref.NetworkDomainID], id)
	}
	if len(byDomain) == 0 {
		return nil, nil, nil, nil, domain.NewValidationError("selected_instance_ids",
			"no instance could be resolved to a network domain")
	}

	enabled := true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	status := input.Status
	if status == "" {
		status = domain.JobGroupStatusEnabled
		if !enabled {
			status = domain.JobGroupStatusDisabled
		}
	}
	if !status.Valid() {
		return nil, nil, nil, nil, domain.NewValidationError("status", "must be enabled or disabled")
	}
	if status == domain.JobGroupStatusDisabled {
		enabled = false
	}

	group := &domain.JobGroup{}
	if existing != nil {
		group = existing
	}
	group.Name = name
	if group.ID == "" {
		id, err := domain.NewID()
		if err != nil {
			return nil, nil, nil, nil, err
		}
		group.ID = id
	}
	group.Status = status
	if input.CreatedBy != "" {
		group.CreatedBy = input.CreatedBy
	}

	existingByDomain := make(map[string]*domain.Job, len(existingChildren))
	for _, child := range existingChildren {
		existingByDomain[child.NetworkDomainID] = child
	}
	domainIDs := make([]string, 0, len(byDomain))
	for domainID := range byDomain {
		domainIDs = append(domainIDs, domainID)
	}
	sort.Strings(domainIDs)

	toCreate := make([]*domain.Job, 0, len(domainIDs))
	toUpdate := make([]*domain.Job, 0, len(domainIDs))
	for _, domainID := range domainIDs {
		child := existingByDomain[domainID]
		job := &domain.Job{
			JobName:             strings.TrimSpace(input.JobName),
			JobType:             input.JobType,
			ResourceCategory:    input.ResourceCategory,
			TemplateCode:        input.TemplateCode,
			Selector:            input.Selector,
			ExporterTemplateID:  input.ExporterTemplateID,
			NetworkDomainID:     domainID,
			SelectedInstanceIDs: byDomain[domainID],
			ScrapeInterval:      input.ScrapeInterval,
			ScrapeTimeout:       input.ScrapeTimeout,
			MetricsPath:         input.MetricsPath,
			Scheme:              input.Scheme,
			AuthType:            input.AuthType,
			Username:            input.Username,
			PasswordCipher:      input.Password,
			TokenCipher:         input.Token,
			TLSSkipVerify:       input.TLSSkipVerify,
			CAFile:              input.CAFile,
			LabelTemplateID:     input.LabelTemplateID,
			BlackboxModule:      input.BlackboxModule,
			DraftStatus:         domain.DraftStatusReady,
			Enabled:             enabled,
			JobGroupID:          group.ID,
		}
		if child != nil {
			job.ID = child.ID
			job.CreatedAt = child.CreatedAt
		}
		// 复用 Job 的完整校验（域资格 / 参数解析 / 标签模板 / 实例同域 / 凭据）。
		if err := s.jobs.prepare(ctx, job, child); err != nil {
			return nil, nil, nil, nil, err
		}
		if enabled {
			job.Sync = domain.SyncState{Status: domain.SyncPending}
		} else {
			job.Sync = domain.SyncState{Status: domain.SyncDraft}
		}
		if child == nil {
			toCreate = append(toCreate, job)
		} else {
			toUpdate = append(toUpdate, job)
		}
	}
	if len(toCreate) == 0 && len(toUpdate) == 0 {
		return nil, nil, nil, nil, domain.NewValidationError("selected_instance_ids",
			"no instance could be resolved to a network domain")
	}

	toRemove := make([]string, 0, len(existingByDomain))
	for domainID, child := range existingByDomain {
		if _, ok := byDomain[domainID]; !ok {
			toRemove = append(toRemove, child.ID)
		}
	}

	// 组上的公共参数取第一个子 Job 的解析结果（同一输入 → 同参数），保证组视图
	// 与子 Job 快照一致（含默认值解析与 mapping 覆盖计算）。
	var sample *domain.Job
	if len(toCreate) > 0 {
		sample = toCreate[0]
	} else {
		sample = toUpdate[0]
	}
	group.JobType = sample.JobType
	group.ResourceCategory = sample.ResourceCategory
	group.TemplateCode = sample.TemplateCode
	group.Selector = sample.Selector
	group.ExporterTemplateID = sample.ExporterTemplateID
	group.ScrapeInterval = sample.ScrapeInterval
	group.ScrapeTimeout = sample.ScrapeTimeout
	group.MetricsPath = sample.MetricsPath
	group.Scheme = sample.Scheme
	group.AuthType = sample.AuthType
	group.Username = sample.Username
	group.PasswordCipher = sample.PasswordCipher
	group.TokenCipher = sample.TokenCipher
	group.TLSSkipVerify = sample.TLSSkipVerify
	group.CAFile = sample.CAFile
	group.LabelTemplateID = sample.LabelTemplateID
	group.BlackboxModule = sample.BlackboxModule
	group.TargetField = sample.TargetField
	group.MappingOverrides = sample.MappingOverrides

	return group, toCreate, toUpdate, toRemove, nil
}

// view loads the children and derives the group-level status.
func (s *JobGroupService) view(ctx context.Context, group *domain.JobGroup) (*JobGroupView, error) {
	children, err := s.groups.ListJobsByGroup(ctx, group.ID)
	if err != nil {
		return nil, err
	}
	views := make([]JobGroupChildView, 0, len(children))
	for _, child := range children {
		domainName := child.NetworkDomainID
		if s.domains != nil {
			if ref, ok, err := s.domains.Get(ctx, child.NetworkDomainID); err == nil && ok {
				domainName = ref.Name
			}
		}
		childView := JobGroupChildView{
			DomainID:   child.NetworkDomainID,
			DomainName: domainName,
			Job:        child,
		}
		if s.jobs != nil {
			if view, err := s.jobs.view(ctx, child); err == nil {
				childView.View = view
			}
		}
		views = append(views, childView)
	}
	return &JobGroupView{Group: group, Children: views, Sync: DeriveGroupSyncSummary(group, children)}, nil
}

// DeriveGroupSyncSummary aggregates child sync states (SRS FR-JG-05):
// disabled > draft > partial > failed > pending > synced.
func DeriveGroupSyncSummary(group *domain.JobGroup, children []*domain.Job) JobGroupSyncSummary {
	summary := JobGroupSyncSummary{Total: len(children)}
	for _, child := range children {
		switch child.Sync.Status {
		case domain.SyncSynced:
			summary.Synced++
		case domain.SyncFailed:
			summary.Failed++
		case domain.SyncDraft:
			summary.Draft++
		default:
			summary.Pending++
		}
	}
	switch {
	case group != nil && group.Status == domain.JobGroupStatusDisabled:
		summary.Status = "disabled"
	case summary.Total == 0:
		summary.Status = "empty"
	case summary.Draft == summary.Total:
		summary.Status = "draft"
	case summary.Failed > 0 && summary.Synced > 0:
		summary.Status = "partial"
	case summary.Failed > 0:
		summary.Status = "failed"
	case summary.Pending > 0:
		summary.Status = "pending"
	default:
		summary.Status = "synced"
	}
	return summary
}

// Adopt promotes an existing standalone (single-domain) job into a monitoring
// task: the original job row is reused as the child of its own domain, and one
// child is created per additional domain. The user performs no extra step —
// editing a task from one domain to several is the only trigger (SRS JG v1.3
// FR-JG-04).
func (s *JobGroupService) Adopt(ctx context.Context, jobID string, input JobGroupInput) (*JobGroupView, error) {
	existing, err := s.jobs.jobs.Get(ctx, jobID)
	if err != nil {
		return nil, err
	}
	if existing.JobGroupID != "" {
		return nil, domain.NewValidationError("job_group_id",
			"this job already belongs to a task; update the task instead")
	}
	group, toCreate, toUpdate, toRemove, err := s.buildPlan(ctx, nil, []*domain.Job{existing}, input)
	if err != nil {
		return nil, err
	}
	if err := s.groups.Apply(ctx, repository.GroupPlan{
		Group:        group,
		CreateGroup:  true,
		JobsToCreate: toCreate,
		JobsToUpdate: toUpdate,
		JobsToDelete: toRemove,
	}); err != nil {
		return nil, err
	}
	return s.view(ctx, group)
}

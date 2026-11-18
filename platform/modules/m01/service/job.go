package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/references"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
)

// ResourceReader is the M07 read port used for candidates and validation.
type ResourceReader interface {
	ListCandidates(ctx context.Context, query domain.CandidateQuery) ([]domain.ResourceRef, int64, error)
	QueryCandidates(ctx context.Context, query domain.CandidateQuery) (domain.CandidatePage, error)
	GetMany(ctx context.Context, resourceIDs []string) (map[string]domain.ResourceRef, error)
}

// DomainReader is the M06/M09 read port used for network domain eligibility.
type DomainReader interface {
	Get(ctx context.Context, id string) (domain.DomainRef, bool, error)
}

// JobView is a job plus display names resolved from other modules.
type JobView struct {
	Job               *domain.Job
	ExporterName      string
	DomainName        string
	LabelTemplateName string
	// GroupName is the monitoring-intent name when the job belongs to a group.
	GroupName string
}

// CandidateView is one candidate plus derived selection state.
type CandidateView struct {
	Ref            domain.ResourceRef
	MonitorType    string
	TargetAddress  string
	Selectable     bool
	DisabledReason string
}

// JobInstanceView is one selected instance plus its target estimate.
type JobInstanceView struct {
	Ref           domain.ResourceRef
	TargetAddress string
	// Port / PortSource are the effective scrape port and the layer that
	// produced it (instance > mapping > template > business/default).
	Port         int
	PortSource   string
	Installation *domain.Installation
}

// PreviewTarget is one rendered target group.
type PreviewTarget struct {
	Targets []string
	Labels  map[string]string
}

// PreviewSkip records an instance that could not be rendered.
type PreviewSkip struct {
	ResourceID string
	Reason     string
}

// JobService implements scrape job use cases (FR-05 ~ FR-11).
type JobService struct {
	jobs          repository.JobRepository
	exporters     repository.ExporterTemplateRepository
	mappings      repository.MappingRepository
	probes        repository.ProbeModuleRepository
	installations repository.InstallationRepository
	resources     ResourceReader
	domains       DomainReader
	labels        LabelTemplateResolver
	// groupNames is optional: when wired, job views resolve the group display name.
	groupNames repository.JobGroupRepository
}

// NewJobService constructs the service.
func NewJobService(
	jobs repository.JobRepository,
	exporters repository.ExporterTemplateRepository,
	mappings repository.MappingRepository,
	probes repository.ProbeModuleRepository,
	installations repository.InstallationRepository,
	resources ResourceReader,
	domains DomainReader,
	labels LabelTemplateResolver,
) *JobService {
	if labels == nil {
		labels = NoopLabelTemplateResolver{}
	}
	return &JobService{
		jobs: jobs, exporters: exporters, mappings: mappings, probes: probes,
		installations: installations, resources: resources, domains: domains, labels: labels,
	}
}

// SetJobGroupResolver wires the job-group repository so job views can resolve
// the monitoring-intent name (`job_group_name`). Optional: unset keeps it empty.
func (s *JobService) SetJobGroupResolver(groups repository.JobGroupRepository) {
	s.groupNames = groups
}

// List returns a page of jobs with display names.
func (s *JobService) List(ctx context.Context, filter repository.JobFilter) ([]JobView, int64, error) {
	jobs, total, err := s.jobs.List(ctx, filter)
	if err != nil {
		return nil, 0, err
	}
	views := make([]JobView, 0, len(jobs))
	for _, job := range jobs {
		view, err := s.view(ctx, job)
		if err != nil {
			return nil, 0, err
		}
		views = append(views, *view)
	}
	return views, total, nil
}

// Get returns one job with display names.
func (s *JobService) Get(ctx context.Context, id string) (*JobView, error) {
	job, err := s.jobs.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	return s.view(ctx, job)
}

// Create validates and inserts a job.
func (s *JobService) Create(ctx context.Context, input *domain.Job, enabled *bool) (*JobView, error) {
	if input == nil {
		return nil, domain.NewValidationError("scrape_job", "is required")
	}
	if enabled == nil {
		input.Enabled = true
	} else {
		input.Enabled = *enabled
	}
	if err := s.prepare(ctx, input, nil); err != nil {
		return nil, err
	}
	if input.Enabled && input.DraftStatus == domain.DraftStatusReady {
		input.Sync = domain.SyncState{Status: domain.SyncPending}
	} else {
		input.Sync = domain.SyncState{Status: domain.SyncDraft}
	}
	if err := s.jobs.Create(ctx, input); err != nil {
		return nil, err
	}
	return s.view(ctx, input)
}

// Update validates and replaces an existing job.
func (s *JobService) Update(ctx context.Context, id string, input *domain.Job, enabled *bool, syncMappingDefaults bool) (*JobView, error) {
	if input == nil {
		return nil, domain.NewValidationError("scrape_job", "is required")
	}
	existing, err := s.jobs.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if input.JobType != "" && input.JobType != existing.JobType {
		return nil, domain.NewValidationError("job_type", "is immutable")
	}
	if input.NetworkDomainID != "" && input.NetworkDomainID != existing.NetworkDomainID {
		return nil, domain.NewValidationError("network_domain_id", "is immutable (create a new job instead)")
	}
	if syncMappingDefaults {
		applyMappingDefaults(input, existing)
	}
	input.ID = existing.ID
	input.JobType = existing.JobType
	input.NetworkDomainID = existing.NetworkDomainID
	input.CreatedAt = existing.CreatedAt
	if enabled == nil {
		input.Enabled = existing.Enabled
	} else {
		input.Enabled = *enabled
	}
	// 组内子 Job 的公共参数由组统一维护（SRS JG v1.0 §11）：这里先拦住越权修改，
	// 再到 prepare 里做常规校验。
	if err := enforceGroupChildEditScope(input, existing); err != nil {
		return nil, err
	}
	if err := s.prepare(ctx, input, existing); err != nil {
		return nil, err
	}
	if input.Enabled && input.DraftStatus == domain.DraftStatusReady {
		input.Sync = domain.SyncState{Status: domain.SyncPending}
	} else {
		input.Sync = domain.SyncState{Status: domain.SyncDraft}
	}
	if err := s.jobs.Update(ctx, input); err != nil {
		return nil, err
	}
	return s.view(ctx, input)
}

// Delete soft-deletes a job.
func (s *JobService) Delete(ctx context.Context, id string) error {
	existing, err := s.jobs.Get(ctx, id)
	if err != nil {
		return err
	}
	// 组内子 Job 只能通过组编辑（清空该域实例）或删组来移除，避免组视图与实际
	// 子 Job 失配（SRS JG v1.0 FR-JG-06）。
	if existing.JobGroupID != "" {
		return domain.NewValidationError("job_group_id",
			"this job belongs to a job group; remove the domain in the group or delete the group instead")
	}
	return s.jobs.SoftDelete(ctx, id)
}

// CandidateFilterField describes one filterable field for the condition builder
// (SRS JG v1.1 FR-JG-11). The schema is server-owned: adding a field must not
// require frontend changes.
type CandidateFilterField struct {
	Key     string
	Label   string
	Type    string
	Ops     []string
	Options []CandidateFilterOption
	Source  string
	Default []string
}

// CandidateFilterOption is one static enum choice.
type CandidateFilterOption struct {
	Value string
	Label string
}

// CandidateFilterSchema returns the filterable fields for the candidate builder.
func CandidateFilterSchema() []CandidateFilterField {
	return []CandidateFilterField{
		{Key: "network_domain_id", Label: "网域", Type: "multi_enum", Ops: []string{"in"}, Source: "network_domains"},
		{Key: "status", Label: "运行状态", Type: "multi_enum", Ops: []string{"in"}, Default: []string{"online", "offline"},
			Options: []CandidateFilterOption{
				{Value: "online", Label: "运行中"},
				{Value: "offline", Label: "已停止"},
				{Value: "maintenance", Label: "维护中"},
			}},
		{Key: "app_code", Label: "应用", Type: "multi_enum", Ops: []string{"in"}, Source: "application_dicts"},
		{Key: "biz_code", Label: "业务", Type: "multi_enum", Ops: []string{"in"}, Source: "business_domains"},
		{Key: "platform_code", Label: "平台", Type: "multi_enum", Ops: []string{"in"}, Source: "platform_dicts"},
		{Key: "env", Label: "环境", Type: "multi_enum", Ops: []string{"in"},
			Options: []CandidateFilterOption{
				{Value: "OPS", Label: "OPS"},
				{Value: "PRD", Label: "PRD"},
				{Value: "UAT", Label: "UAT"},
			}},
		{Key: "cluster", Label: "集群", Type: "text", Ops: []string{"eq", "contains"}},
		{Key: "owner", Label: "负责人", Type: "text", Ops: []string{"contains"}},
	}
}

// CandidateQueryResult is the composable-filter response: page views plus the
// per-domain counts (save-time preview) and, for select-all, the matching ids.
type CandidateQueryResult struct {
	Views     []CandidateView
	Total     int64
	Domains   []domain.DomainHit
	IDs       []string
	Truncated bool
}

// QueryCandidates runs the composable-filter candidate query (SRS JG v1.1 §5.3).
func (s *JobService) QueryCandidates(ctx context.Context, query domain.CandidateQuery) (CandidateQueryResult, error) {
	out := CandidateQueryResult{}
	if err := normalizeCandidateFilters(&query); err != nil {
		return out, err
	}
	page, err := s.resources.QueryCandidates(ctx, query)
	if err != nil {
		return out, err
	}
	out.Total = page.Total
	out.IDs = page.IDs
	out.Truncated = page.Truncated
	for _, hit := range page.DomainHits {
		if s.domains != nil {
			if ref, ok, err := s.domains.Get(ctx, hit.NetworkDomainID); err == nil && ok {
				hit.NetworkDomainName = ref.Name
			}
		}
		out.Domains = append(out.Domains, hit)
	}
	if query.IDsOnly {
		return out, nil
	}
	mapping, exporter, err := s.catalogForCandidate(ctx, query.MonitorType)
	if err != nil {
		return out, err
	}
	out.Views = make([]CandidateView, 0, len(page.Refs))
	for _, ref := range page.Refs {
		out.Views = append(out.Views, CandidateView{
			Ref:           ref,
			MonitorType:   query.MonitorType,
			TargetAddress: targetAddress(ref, mapping, exporter),
			Selectable:    ref.Selectable(),
			DisabledReason: func() string {
				if ref.Selectable() {
					return ""
				}
				return "offline"
			}(),
		})
	}
	return out, nil
}

// normalizeCandidateFilters validates and merges the user-supplied conditions:
// unknown fields / operators are rejected, repeated `in` conditions intersect
// (AND semantics), and enum values are checked against the known sets.
func normalizeCandidateFilters(query *domain.CandidateQuery) error {
	if len(query.Filters) == 0 {
		return nil
	}
	merged := make(map[string]*domain.CandidateFilter, len(query.Filters))
	order := make([]string, 0, len(query.Filters))
	for _, filter := range query.Filters {
		if err := references.ValidateCandidateFilter(filter); err != nil {
			return err
		}
		if err := validateCandidateFilterValues(filter); err != nil {
			return err
		}
		key := filter.Field + "|" + string(filter.Op)
		existing, ok := merged[key]
		if !ok {
			copied := domain.CandidateFilter{
				Field: filter.Field, Op: filter.Op,
				Values: append([]string(nil), filter.Values...),
			}
			merged[key] = &copied
			order = append(order, key)
			continue
		}
		// 同字段同操作符按 AND 合并（in 取交集）；交集为空 → 无条件可选。
		existing.Values = intersectStrings(existing.Values, filter.Values)
	}
	query.Filters = make([]domain.CandidateFilter, 0, len(order))
	for _, key := range order {
		query.Filters = append(query.Filters, *merged[key])
	}
	return nil
}

func validateCandidateFilterValues(filter domain.CandidateFilter) error {
	switch filter.Field {
	case "status":
		for _, value := range filter.Values {
			switch value {
			case "online", "offline", "maintenance":
				continue
			default:
				return domain.NewValidationErrorf("filters", "invalid status %q", value)
			}
		}
	case "env":
		for _, value := range filter.Values {
			switch value {
			case "OPS", "PRD", "UAT":
				continue
			default:
				return domain.NewValidationErrorf("filters", "invalid env %q", value)
			}
		}
	}
	return nil
}

func intersectStrings(left, right []string) []string {
	if len(left) == 0 || len(right) == 0 {
		return nil
	}
	set := make(map[string]struct{}, len(right))
	for _, value := range right {
		set[value] = struct{}{}
	}
	out := make([]string, 0, len(left))
	for _, value := range left {
		if _, ok := set[value]; ok {
			out = append(out, value)
		}
	}
	return out
}

// ListCandidates keeps the legacy single-domain entry for the old GET endpoint.
func (s *JobService) ListCandidates(ctx context.Context, query domain.CandidateQuery) ([]CandidateView, int64, error) {
	if strings.TrimSpace(query.NetworkDomainID) == "" {
		return nil, 0, domain.NewValidationError("network_domain_id", "is required")
	}
	if _, err := s.requireDomain(ctx, query.NetworkDomainID); err != nil {
		return nil, 0, err
	}
	mapping, exporter, err := s.catalogForCandidate(ctx, query.MonitorType)
	if err != nil {
		return nil, 0, err
	}
	refs, total, err := s.resources.ListCandidates(ctx, query)
	if err != nil {
		return nil, 0, err
	}
	views := make([]CandidateView, 0, len(refs))
	for _, ref := range refs {
		address := targetAddress(ref, mapping, exporter)
		view := CandidateView{
			Ref:           ref,
			MonitorType:   query.MonitorType,
			TargetAddress: address,
			Selectable:    ref.Selectable(),
		}
		if !view.Selectable {
			view.DisabledReason = "实例已离线"
		}
		views = append(views, view)
	}
	return views, total, nil
}

// ListInstances returns the selected resources of a job plus installation notes.
func (s *JobService) ListInstances(ctx context.Context, jobID string) ([]JobInstanceView, error) {
	job, err := s.jobs.Get(ctx, jobID)
	if err != nil {
		return nil, err
	}
	mapping, exporter, err := s.catalogForJob(ctx, job)
	if err != nil {
		return nil, err
	}
	refs, err := s.resources.GetMany(ctx, job.SelectedInstanceIDs)
	if err != nil {
		return nil, err
	}
	notes, err := s.installations.ListByJob(ctx, jobID)
	if err != nil {
		return nil, err
	}
	noteByResource := make(map[string]*domain.Installation, len(notes))
	for _, note := range notes {
		noteByResource[note.ResourceID] = note
	}
	views := make([]JobInstanceView, 0, len(job.SelectedInstanceIDs))
	for _, id := range job.SelectedInstanceIDs {
		ref, ok := refs[id]
		if !ok {
			continue
		}
		mappingPort, exporterPort := 0, 0
		if mapping != nil {
			mappingPort = mapping.DefaultPort
		}
		if exporter != nil {
			exporterPort = exporter.DefaultPort
		}
		port, source := domain.ResolvePortWithSource(ref, mappingPort, exporterPort)
		views = append(views, JobInstanceView{
			Ref:           ref,
			TargetAddress: targetAddressForJob(ref, job, mapping, exporter),
			Port:          port,
			PortSource:    source,
			Installation:  noteByResource[id],
		})
	}
	return views, nil
}

// ConfirmInstallation records an exporter installation note.
func (s *JobService) ConfirmInstallation(ctx context.Context, jobID, resourceID string, actualPort int, confirmedBy, notes string) (*domain.Installation, error) {
	job, err := s.jobs.Get(ctx, jobID)
	if err != nil {
		return nil, err
	}
	if !contains(job.SelectedInstanceIDs, resourceID) {
		return nil, domain.NewValidationError("resource_id", "is not selected by this job")
	}
	if strings.TrimSpace(confirmedBy) == "" {
		return nil, domain.NewValidationError("confirmed_by", "is required")
	}
	if err := domain.ValidatePort(actualPort); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	note := &domain.Installation{
		ResourceID:  resourceID,
		ScrapeJobID: jobID,
		Status:      domain.InstallationConfirmed,
		ActualPort:  actualPort,
		ConfirmedBy: strings.TrimSpace(confirmedBy),
		Notes:       strings.TrimSpace(notes),
		ConfirmedAt: &now,
	}
	if err := s.installations.Upsert(ctx, note); err != nil {
		return nil, err
	}
	return s.installations.Get(ctx, resourceID, jobID)
}

// DeleteInstallation removes an installation note.
func (s *JobService) DeleteInstallation(ctx context.Context, jobID, resourceID string) error {
	if _, err := s.jobs.Get(ctx, jobID); err != nil {
		return err
	}
	return s.installations.Delete(ctx, resourceID, jobID)
}

// Preview renders the job's targets without persisting anything (NFR-01).
func (s *JobService) Preview(ctx context.Context, jobID string) (string, []PreviewTarget, []PreviewSkip, error) {
	job, err := s.jobs.Get(ctx, jobID)
	if err != nil {
		return "", nil, nil, err
	}
	mapping, exporter, err := s.catalogForJob(ctx, job)
	if err != nil {
		return "", nil, nil, err
	}
	refs, err := s.resources.GetMany(ctx, job.SelectedInstanceIDs)
	if err != nil {
		return "", nil, nil, err
	}
	targets := make([]string, 0, len(job.SelectedInstanceIDs))
	labels := map[string]string{"network_domain": job.NetworkDomainID}
	skipped := make([]PreviewSkip, 0)
	for _, id := range job.SelectedInstanceIDs {
		ref, ok := refs[id]
		if !ok {
			skipped = append(skipped, PreviewSkip{ResourceID: id, Reason: "resource_not_found"})
			continue
		}
		address := targetAddressForJob(ref, job, mapping, exporter)
		if address == "" {
			skipped = append(skipped, PreviewSkip{ResourceID: id, Reason: "missing_address"})
			continue
		}
		targets = append(targets, address)
	}
	out := make([]PreviewTarget, 0, 1)
	if len(targets) > 0 {
		out = append(out, PreviewTarget{Targets: targets, Labels: labels})
	}
	return job.JobName, out, skipped, nil
}

func (s *JobService) prepare(ctx context.Context, job *domain.Job, existing *domain.Job) error {
	normalizeJob(job)
	if !job.JobType.Valid() {
		return domain.NewValidationError("job_type", "must be standard or blackbox")
	}
	if job.ResourceCategory == "" && job.JobType == domain.JobTypeStandard && job.MonitorType != "" {
		if expected, ok := domain.CategoryForMonitorType(job.MonitorType); ok {
			job.ResourceCategory = expected
		}
	}
	if !job.ResourceCategory.Valid() {
		return domain.NewValidationError("resource_category", "must be a known category")
	}
	if err := domain.ValidateJobName(job.JobName); err != nil {
		return err
	}
	if job.InstanceSelectionMode == domain.SelectionFilter {
		return domain.NewValidationError("instance_selection_mode", "filter mode is not supported in this version")
	}
	job.InstanceSelectionMode = domain.SelectionManual
	job.SelectedInstanceIDs = uniqueStrings(job.SelectedInstanceIDs)

	mapping, exporter, err := s.resolveCatalog(ctx, job)
	if err != nil {
		return err
	}
	if _, err := s.requireDomain(ctx, job.NetworkDomainID); err != nil {
		return err
	}
	inputParams := domain.JobParams{
		Interval:    job.ScrapeInterval,
		Timeout:     job.ScrapeTimeout,
		MetricsPath: job.MetricsPath,
		Scheme:      job.Scheme,
	}
	params, err := domain.ResolveJobParams(inputParams, mapping, exporter, job.ResourceCategory)
	if err != nil {
		return err
	}
	job.ScrapeInterval, job.ScrapeTimeout = params.Interval, params.Timeout
	job.MetricsPath, job.Scheme = params.MetricsPath, params.Scheme
	job.MappingOverrides = domain.ComputeMappingOverrides(inputParams, params, mapping)

	if err := s.validateLabelTemplate(ctx, job); err != nil {
		return err
	}
	if err := s.validateInstances(ctx, job, existing); err != nil {
		return err
	}
	if job.DraftStatus == domain.DraftStatusReady && len(job.SelectedInstanceIDs) == 0 {
		return domain.NewValidationError("selected_instance_ids", "at least one instance is required for a ready job")
	}
	return s.applyCredentials(job, existing)
}

func normalizeJob(job *domain.Job) {
	job.JobName = strings.TrimSpace(job.JobName)
	job.MonitorType = strings.TrimSpace(job.MonitorType)
	job.ExporterTemplateID = strings.TrimSpace(job.ExporterTemplateID)
	job.NetworkDomainID = strings.TrimSpace(job.NetworkDomainID)
	job.LabelTemplateID = strings.TrimSpace(job.LabelTemplateID)
	job.BlackboxModule = strings.TrimSpace(job.BlackboxModule)
	if job.JobType == "" {
		job.JobType = domain.JobTypeStandard
	}
	if job.DraftStatus == "" {
		job.DraftStatus = domain.DraftStatusReady
	}
	if job.AuthType == "" {
		job.AuthType = domain.AuthNone
	}
}

func (s *JobService) resolveCatalog(ctx context.Context, job *domain.Job) (*domain.Mapping, *domain.ExporterTemplate, error) {
	if job.JobType == domain.JobTypeBlackbox {
		if job.MonitorType != "" {
			return nil, nil, domain.NewValidationError("monitor_type", "must be empty for blackbox jobs")
		}
		field, err := domain.TargetFieldForCategory(job.ResourceCategory)
		if err != nil {
			return nil, nil, err
		}
		job.TargetField = field
		if job.BlackboxModule == "" {
			return nil, nil, domain.NewValidationError("blackbox_module", "is required for blackbox jobs")
		}
		probe, err := s.probes.GetByName(ctx, job.BlackboxModule)
		if err != nil {
			var nf *domain.NotFoundError
			if errors.As(err, &nf) {
				return nil, nil, domain.NewValidationErrorf("blackbox_module", "blackbox module %q not found", job.BlackboxModule)
			}
			return nil, nil, err
		}
		if !probe.Enabled {
			return nil, nil, domain.NewValidationErrorf("blackbox_module", "blackbox module %q is disabled", job.BlackboxModule)
		}
		job.ExporterTemplateID = ""
		return nil, nil, nil
	}

	if job.MonitorType == "" {
		return nil, nil, domain.NewValidationError("monitor_type", "is required for standard jobs")
	}
	if !domain.ValidMonitorType(job.MonitorType) {
		return nil, nil, domain.NewValidationErrorf("monitor_type", "unknown monitor type %q", job.MonitorType)
	}
	expected, ok := domain.CategoryForMonitorType(job.MonitorType)
	if !ok {
		return nil, nil, domain.NewValidationErrorf("monitor_type", "cannot derive category for %q", job.MonitorType)
	}
	if job.ResourceCategory == "" {
		job.ResourceCategory = expected
	} else if job.ResourceCategory != expected {
		return nil, nil, domain.NewValidationErrorf("resource_category",
			"does not match monitor type %q (%s)", job.MonitorType, expected)
	}
	job.TargetField = ""

	var mapping *domain.Mapping
	if found, ok, err := s.mappings.DefaultByMonitorType(ctx, job.MonitorType); err != nil {
		return nil, nil, err
	} else if ok {
		mapping = found
	}
	if job.ExporterTemplateID == "" && mapping != nil {
		job.ExporterTemplateID = mapping.ExporterTemplateID
	}
	if job.ExporterTemplateID != "" {
		exporter, err := s.exporters.Get(ctx, job.ExporterTemplateID)
		if err != nil {
			return nil, nil, err
		}
		if !domain.ExporterSupportsMonitorType(job.MonitorType, exporter.SupportedMonitorTypes) {
			return nil, nil, domain.NewValidationErrorf("exporter_template_id",
				"exporter %q does not support monitor type %q", exporter.Name, job.MonitorType)
		}
		return mapping, exporter, nil
	}
	return mapping, nil, nil
}

func (s *JobService) requireDomain(ctx context.Context, domainID string) (domain.DomainRef, error) {
	if domainID == "" {
		return domain.DomainRef{}, domain.NewValidationError("network_domain_id", "is required")
	}
	ref, ok, err := s.domains.Get(ctx, domainID)
	if err != nil {
		return domain.DomainRef{}, err
	}
	if !ok {
		return domain.DomainRef{}, domain.NewValidationErrorf("network_domain_id", "network domain %q not found", domainID)
	}
	if !ref.Eligible() {
		return domain.DomainRef{}, domain.NewValidationErrorf("network_domain_id",
			"network domain %q is not an onboarded collection domain; onboard it in M09 first", domainID)
	}
	// 域共享授权：非平台管理员只能使用「登记归属自己」或「被显式授权」的网域
	// （fail-closed，SRS JG v1.2 FR-JG-13）。
	if actor, ok := ActorFrom(ctx); ok && !actor.IsPlatformAdmin && !ref.AuthorizedFor(actor.TenantID) {
		return domain.DomainRef{}, domain.NewValidationErrorf("network_domain_id",
			"network domain %q is not authorized for this tenant", domainID)
	}
	return ref, nil
}

func (s *JobService) validateLabelTemplate(ctx context.Context, job *domain.Job) error {
	if job.LabelTemplateID == "" {
		return nil
	}
	ref, found, err := s.labels.Resolve(ctx, job.LabelTemplateID)
	if err != nil {
		return fmt.Errorf("resolve label template %q: %w", job.LabelTemplateID, err)
	}
	if !found {
		return domain.NewValidationErrorf("label_template_id", "label template %q not found", job.LabelTemplateID)
	}
	if ref.Category != "" && ref.Category != string(job.ResourceCategory) {
		return domain.NewValidationErrorf("label_template_id",
			"label template category %q does not match %q", ref.Category, job.ResourceCategory)
	}
	return nil
}

func (s *JobService) validateInstances(ctx context.Context, job *domain.Job, existing *domain.Job) error {
	if len(job.SelectedInstanceIDs) == 0 {
		return nil
	}
	refs, err := s.resources.GetMany(ctx, job.SelectedInstanceIDs)
	if err != nil {
		return err
	}
	for _, id := range job.SelectedInstanceIDs {
		ref, ok := refs[id]
		if !ok {
			return domain.NewValidationErrorf("selected_instance_ids", "resource %q not found", id)
		}
		if ref.Category != job.ResourceCategory {
			return domain.NewValidationErrorf("selected_instance_ids",
				"resource %q category %q does not match %q", id, ref.Category, job.ResourceCategory)
		}
		if ref.NetworkDomainID != job.NetworkDomainID {
			return domain.NewValidationErrorf("selected_instance_ids",
				"resource %q belongs to network domain %q", id, ref.NetworkDomainID)
		}
		if actor, ok := ActorFrom(ctx); ok && !actor.IsPlatformAdmin && ref.TenantID != "" && ref.TenantID != actor.TenantID {
			return domain.NewValidationErrorf("selected_instance_ids",
				"resource %q belongs to another tenant", id)
		}
		if ref.Status != "online" && !(existing != nil && contains(existing.SelectedInstanceIDs, id)) {
			return domain.NewValidationErrorf("selected_instance_ids", "resource %q is offline", id)
		}
		if job.JobType == domain.JobTypeBlackbox && strings.TrimSpace(ref.TargetURL) == "" {
			return domain.NewValidationErrorf("selected_instance_ids", "resource %q has no probe URL", id)
		}
	}
	return nil
}

func (s *JobService) applyCredentials(job *domain.Job, existing *domain.Job) error {
	switch job.AuthType {
	case domain.AuthNone:
		job.PasswordCipher, job.TokenCipher = "", ""
		job.Username = ""
	case domain.AuthBasic:
		if job.Username == "" {
			return domain.NewValidationError("username", "is required for basic auth")
		}
		if job.PasswordCipher == "" {
			if existing == nil || existing.PasswordCipher == "" {
				return domain.NewValidationError("password", "is required for basic auth")
			}
			job.PasswordCipher = existing.PasswordCipher
		} else {
			job.PasswordCipher = sealCredential(job.PasswordCipher)
		}
		job.TokenCipher = ""
	case domain.AuthBearer:
		if job.TokenCipher == "" {
			if existing == nil || existing.TokenCipher == "" {
				return domain.NewValidationError("token", "is required for bearer auth")
			}
			job.TokenCipher = existing.TokenCipher
		} else {
			job.TokenCipher = sealCredential(job.TokenCipher)
		}
		job.PasswordCipher, job.Username = "", ""
	default:
		return domain.NewValidationError("auth_type", "must be none, basic or bearer")
	}
	return nil
}

func (s *JobService) catalogForCandidate(ctx context.Context, monitorType string) (*domain.Mapping, *domain.ExporterTemplate, error) {
	mapping, ok, err := s.mappings.DefaultByMonitorType(ctx, monitorType)
	if err != nil {
		return nil, nil, err
	}
	if !ok {
		return nil, nil, nil
	}
	exporter, err := s.exporters.Get(ctx, mapping.ExporterTemplateID)
	if err != nil {
		var nf *domain.NotFoundError
		if errors.As(err, &nf) {
			return mapping, nil, nil
		}
		return nil, nil, err
	}
	return mapping, exporter, nil
}

func (s *JobService) catalogForJob(ctx context.Context, job *domain.Job) (*domain.Mapping, *domain.ExporterTemplate, error) {
	var mapping *domain.Mapping
	if job.MonitorType != "" {
		if found, ok, err := s.mappings.DefaultByMonitorType(ctx, job.MonitorType); err != nil {
			return nil, nil, err
		} else if ok {
			mapping = found
		}
	}
	var exporter *domain.ExporterTemplate
	if job.ExporterTemplateID != "" {
		if found, err := s.exporters.Get(ctx, job.ExporterTemplateID); err == nil {
			exporter = found
		} else {
			var nf *domain.NotFoundError
			if !errors.As(err, &nf) {
				return nil, nil, err
			}
		}
	}
	return mapping, exporter, nil
}

func (s *JobService) view(ctx context.Context, job *domain.Job) (*JobView, error) {
	view := &JobView{Job: job}
	if job.ExporterTemplateID != "" {
		if exporter, err := s.exporters.Get(ctx, job.ExporterTemplateID); err == nil {
			view.ExporterName = exporter.Name
		} else {
			var nf *domain.NotFoundError
			if !errors.As(err, &nf) {
				return nil, err
			}
		}
	}
	if domainRef, ok, err := s.domains.Get(ctx, job.NetworkDomainID); err != nil {
		return nil, err
	} else if ok {
		view.DomainName = domainRef.Name
	}
	if job.LabelTemplateID != "" {
		if ref, found, err := s.labels.Resolve(ctx, job.LabelTemplateID); err != nil {
			return nil, err
		} else if found {
			view.LabelTemplateName = ref.Name
		}
	}
	if job.JobGroupID != "" && s.groupNames != nil {
		if group, err := s.groupNames.Get(ctx, job.JobGroupID); err == nil {
			view.GroupName = group.Name
		} else {
			var nf *domain.NotFoundError
			if !errors.As(err, &nf) {
				return nil, err
			}
		}
	}
	return view, nil
}

func targetAddressForJob(ref domain.ResourceRef, job *domain.Job, mapping *domain.Mapping, exporter *domain.ExporterTemplate) string {
	if job.JobType == domain.JobTypeBlackbox {
		return strings.TrimSpace(ref.TargetURL)
	}
	return targetAddress(ref, mapping, exporter)
}

func targetAddress(ref domain.ResourceRef, mapping *domain.Mapping, exporter *domain.ExporterTemplate) string {
	mappingPort, exporterPort := 0, 0
	if mapping != nil {
		mappingPort = mapping.DefaultPort
	}
	if exporter != nil {
		exporterPort = exporter.DefaultPort
	}
	return domain.ResourceAddress(ref, mappingPort, exporterPort)
}

func applyMappingDefaults(input, existing *domain.Job) {
	overridden := make(map[string]struct{}, len(existing.MappingOverrides))
	for _, item := range existing.MappingOverrides {
		overridden[item.Field] = struct{}{}
	}
	if _, ok := overridden["scrape_interval"]; !ok {
		input.ScrapeInterval = ""
	}
	if _, ok := overridden["scrape_timeout"]; !ok {
		input.ScrapeTimeout = ""
	}
	if _, ok := overridden["metrics_path"]; !ok {
		input.MetricsPath = ""
	}
	if _, ok := overridden["scheme"]; !ok {
		input.Scheme = ""
	}
}

func sealCredential(raw string) string {
	if strings.HasPrefix(raw, "plain:") {
		return raw
	}
	return "plain:" + raw
}

func uniqueStrings(values []string) []string {
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

// enforceGroupChildEditScope keeps the job group the single maintenance entry.
// A child job may only change its instance selection (SRS JG v1.0 §11): every
// common parameter, credential and the enabled state belong to the group.
// Empty input fields mean "not provided" and are treated as unchanged, matching
// the other immutable-field checks in Update.
func enforceGroupChildEditScope(input, existing *domain.Job) error {
	if existing.JobGroupID == "" {
		return nil
	}
	checks := []struct {
		field   string
		current string
		next    string
	}{
		{"job_name", existing.JobName, strings.TrimSpace(input.JobName)},
		{"monitor_type", existing.MonitorType, strings.TrimSpace(input.MonitorType)},
		{"resource_category", string(existing.ResourceCategory), string(input.ResourceCategory)},
		{"exporter_template_id", existing.ExporterTemplateID, strings.TrimSpace(input.ExporterTemplateID)},
		{"scrape_interval", existing.ScrapeInterval, strings.TrimSpace(input.ScrapeInterval)},
		{"scrape_timeout", existing.ScrapeTimeout, strings.TrimSpace(input.ScrapeTimeout)},
		{"metrics_path", existing.MetricsPath, strings.TrimSpace(input.MetricsPath)},
		{"scheme", string(existing.Scheme), string(input.Scheme)},
		{"auth_type", string(existing.AuthType), string(input.AuthType)},
		{"username", existing.Username, strings.TrimSpace(input.Username)},
		{"label_template_id", existing.LabelTemplateID, strings.TrimSpace(input.LabelTemplateID)},
		{"blackbox_module", existing.BlackboxModule, strings.TrimSpace(input.BlackboxModule)},
		{"draft_status", string(existing.DraftStatus), string(input.DraftStatus)},
	}
	for _, check := range checks {
		if check.next == "" {
			continue
		}
		if check.next != check.current {
			return domain.NewValidationError(check.field,
				"is managed by the job group; edit the group instead")
		}
	}
	if input.PasswordCipher != "" || input.TokenCipher != "" {
		return domain.NewValidationError("auth_type",
			"credentials are managed by the job group; edit the group instead")
	}
	if input.TLSSkipVerify != existing.TLSSkipVerify {
		return domain.NewValidationError("tls_skip_verify",
			"is managed by the job group; edit the group instead")
	}
	if input.Enabled != existing.Enabled {
		return domain.NewValidationError("enabled",
			"is managed by the job group; disable the group instead")
	}
	return nil
}

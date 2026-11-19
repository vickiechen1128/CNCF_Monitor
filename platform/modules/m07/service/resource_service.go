// Package service contains M07 v3 use cases.
package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m07/references"
	"github.com/metriccenter/metriccenter/platform/modules/m07/repository"
)

// DefaultTenantID is the MVP tenant.
const DefaultTenantID = "platform_admin"

// Bulk reassignment limits and fields (M07 SRS v2.0 FR-28).
const (
	ReassignFieldBizCode      = "biz_code"
	ReassignFieldAppCode      = "app_code"
	ReassignFieldPlatformCode = "platform_code"
	// MaxBulkReassignResources caps one request so the transaction stays
	// bounded and the failure report remains readable.
	MaxBulkReassignResources = 200
)

// DictionaryResolver validates dictionary/domain references.
type DictionaryResolver interface {
	ValidateResource(ctx context.Context, resource *domain.Resource) error
	ValidateResourceUpdate(ctx context.Context, before, after *domain.Resource) error
	PrimaryPlatformOfApp(ctx context.Context, appCode string) (string, bool, error)
	PlatformBelongsToApp(ctx context.Context, appCode, platformCode string) (bool, error)
	ValidateReferenceTarget(ctx context.Context, field, code string) error
}

// ResourceService implements resource use cases.
type ResourceService struct {
	repo     repository.ResourceRepository
	dict     DictionaryResolver
	notifier references.ResourceChangeNotifier
}

// NewResourceService constructs a resource service.
func NewResourceService(repo repository.ResourceRepository, dict DictionaryResolver) *ResourceService {
	return &ResourceService{repo: repo, dict: dict, notifier: references.NoopChangeNotifier{}}
}

// SetChangeNotifier wires the best-effort M01/M09 change notification port.
func (s *ResourceService) SetChangeNotifier(notifier references.ResourceChangeNotifier) {
	if notifier != nil {
		s.notifier = notifier
	}
}

// List returns a page of resources.
func (s *ResourceService) List(ctx context.Context, filter repository.ListFilter) ([]*domain.Resource, int64, error) {
	return s.repo.List(ctx, filter)
}

// Get returns one resource.
func (s *ResourceService) Get(ctx context.Context, resourceID string) (*domain.Resource, error) {
	return s.repo.Get(ctx, resourceID)
}

// Create creates a resource.
func (s *ResourceService) Create(ctx context.Context, resource *domain.Resource) (*domain.Resource, error) {
	if resource == nil {
		return nil, &domain.ValidationError{Field: "resource", Message: "is required"}
	}
	resource.Normalize()
	if resource.ResourceID == "" {
		id, err := domain.NewResourceID()
		if err != nil {
			return nil, err
		}
		resource.ResourceID = id
	}
	if resource.TenantID == "" {
		resource.TenantID = DefaultTenantID
	}
	if resource.SourceType == "" {
		resource.SourceType = domain.SourceManual
	}
	if resource.Status == "" {
		resource.Status = domain.StatusOnline
	}
	if err := s.resolvePlatform(ctx, resource); err != nil {
		return nil, err
	}
	if err := s.dict.ValidateResource(ctx, resource); err != nil {
		return nil, err
	}
	if err := resource.Validate(); err != nil {
		return nil, err
	}
	if err := resource.EnsureDedupKey(); err != nil {
		return nil, err
	}
	if err := s.repo.Create(ctx, resource); err != nil {
		return nil, err
	}
	s.notifyDomains(ctx, resource.NetworkDomainID)
	return resource, nil
}

// Update replaces the mutable fields of an existing resource.
func (s *ResourceService) Update(ctx context.Context, resourceID string, input *domain.Resource) (*domain.Resource, error) {
	if input == nil {
		return nil, &domain.ValidationError{Field: "resource", Message: "is required"}
	}
	existing, err := s.repo.Get(ctx, resourceID)
	if err != nil {
		return nil, err
	}
	if input.Category != "" && input.Category != existing.Category {
		return nil, &domain.ValidationError{Field: "resource_category", Message: "is immutable"}
	}

	updated := *input
	updated.ResourceID = existing.ResourceID
	updated.Category = existing.Category
	updated.TenantID = existing.TenantID
	updated.SourceType = existing.SourceType
	updated.CreatedAt = existing.CreatedAt
	updated.Normalize()
	if updated.Status == "" {
		updated.Status = existing.Status
	}
	if err := s.resolvePlatform(ctx, &updated); err != nil {
		return nil, err
	}
	if err := s.dict.ValidateResourceUpdate(ctx, existing, &updated); err != nil {
		return nil, err
	}
	if err := updated.Validate(); err != nil {
		return nil, err
	}
	if err := updated.EnsureDedupKey(); err != nil {
		return nil, err
	}
	if err := s.repo.Update(ctx, &updated); err != nil {
		return nil, err
	}
	s.notifyDomains(ctx, existing.NetworkDomainID, updated.NetworkDomainID)
	return s.repo.Get(ctx, resourceID)
}

// Delete soft-deletes a resource.
func (s *ResourceService) Delete(ctx context.Context, resourceID string) error {
	if strings.TrimSpace(resourceID) == "" {
		return &domain.ValidationError{Field: "resource_id", Message: "is required"}
	}
	existing, err := s.repo.Get(ctx, resourceID)
	if err != nil {
		return err
	}
	if err := s.repo.SoftDelete(ctx, resourceID); err != nil {
		return err
	}
	s.notifyDomains(ctx, existing.NetworkDomainID)
	return nil
}

// BulkReassignFailure describes one resource rejected by bulk reassignment.
type BulkReassignFailure struct {
	ResourceID string
	Reason     string
}

// BulkReassignError carries per-resource validation failures. The whole batch
// is rejected; no resource is written when any failure is present (FR-28).
type BulkReassignError struct {
	Failures []BulkReassignFailure
}

func (e *BulkReassignError) Error() string {
	if len(e.Failures) == 1 {
		return fmt.Sprintf("资源 %s 校验失败：%s", e.Failures[0].ResourceID, e.Failures[0].Reason)
	}
	return fmt.Sprintf("%d 条资源校验失败，整批未修改，请查看失败明细", len(e.Failures))
}

// BulkReassignResult reports a successful atomic batch update.
type BulkReassignResult struct {
	UpdatedCount int
}

// BulkReassign moves one reference field of many resources to a target
// dictionary entry in a single transaction (M07 SRS v2.0 FR-28 / NFR-19).
//
// Rules:
//   - field ∈ biz_code / app_code / platform_code;
//   - target must be an enabled dictionary entry;
//   - composed resources (application / interface_service) cannot change
//     platform_code directly — it is derived from the app's primary platform;
//   - on app_code changes composed resources follow the target app's primary
//     platform, while static resources must already be associated with it;
//   - any failure rejects the whole batch and returns resource-level reasons.
//
// BulkSetScrapePort sets the instance-level scrape port for many resources.
// 端口只在资源实例上维护（M01 解析链最高优先级），因此这里只做范围校验与批量落库。
func (s *ResourceService) BulkSetScrapePort(ctx context.Context, resourceIDs []string, scrapePort int) (int64, error) {
	ids := normalizeBulkReassignIDs(resourceIDs)
	if len(ids) == 0 {
		return 0, &domain.ValidationError{Field: "resource_ids", Message: "at least one resource is required"}
	}
	if len(ids) > MaxBulkReassignResources {
		return 0, &domain.ValidationError{
			Field:   "resource_ids",
			Message: fmt.Sprintf("一次最多批量修改 %d 条资源，请分批操作", MaxBulkReassignResources),
		}
	}
	if scrapePort < 0 || scrapePort > 65535 {
		return 0, &domain.ValidationError{Field: "scrape_port", Message: "must be between 0 and 65535"}
	}
	updated, err := s.repo.BulkSetScrapePort(ctx, ids, scrapePort)
	if err != nil {
		return 0, err
	}
	s.notifyAll(ctx)
	return updated, nil
}

func (s *ResourceService) BulkReassign(ctx context.Context, resourceIDs []string, field, targetCode string) (*BulkReassignResult, error) {
	ids := normalizeBulkReassignIDs(resourceIDs)
	field = strings.TrimSpace(field)
	targetCode = strings.TrimSpace(targetCode)

	if len(ids) == 0 {
		return nil, &domain.ValidationError{Field: "resource_ids", Message: "at least one resource is required"}
	}
	if len(ids) > MaxBulkReassignResources {
		return nil, &domain.ValidationError{
			Field:   "resource_ids",
			Message: fmt.Sprintf("一次最多批量修改 %d 条资源，请分批操作", MaxBulkReassignResources),
		}
	}
	switch field {
	case ReassignFieldBizCode, ReassignFieldAppCode, ReassignFieldPlatformCode:
	default:
		return nil, &domain.ValidationError{Field: "field", Message: "must be biz_code/app_code/platform_code"}
	}
	if targetCode == "" {
		return nil, &domain.ValidationError{Field: "target_code", Message: "is required"}
	}
	if err := s.dict.ValidateReferenceTarget(ctx, field, targetCode); err != nil {
		return nil, err
	}

	resources, err := s.repo.GetMany(ctx, ids)
	if err != nil {
		return nil, err
	}
	found := make(map[string]struct{}, len(resources))
	for _, resource := range resources {
		found[resource.ResourceID] = struct{}{}
	}
	failures := make([]BulkReassignFailure, 0)
	for _, id := range ids {
		if _, ok := found[id]; !ok {
			failures = append(failures, BulkReassignFailure{ResourceID: id, Reason: "资源不存在或已删除"})
		}
	}
	if len(failures) > 0 {
		return nil, &BulkReassignError{Failures: failures}
	}

	// D43: composed resources derive their platform from the target app's
	// primary platform, so an app reassignment must move both columns.
	derivedPlatform := ""
	if field == ReassignFieldAppCode {
		primary, ok, err := s.dict.PrimaryPlatformOfApp(ctx, targetCode)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, &domain.ValidationError{
				Field:   "target_code",
				Message: fmt.Sprintf("目标应用 %q 没有主平台，无法派生平台归属", targetCode),
			}
		}
		derivedPlatform = primary
	}

	belongsCache := make(map[string]bool)
	for _, resource := range resources {
		switch field {
		case ReassignFieldPlatformCode:
			if resource.Category.IsComposed() {
				failures = append(failures, BulkReassignFailure{
					ResourceID: resource.ResourceID,
					Reason:     "组成型资源（应用服务 / 接口服务）的平台归属由应用主平台派生，不能直接改平台",
				})
				continue
			}
			// 静态资源保留显式平台，但必须与其应用归属的已关联平台一致
			// （与 FR-29 常规编辑校验同一不变量，避免批量入口绕过）。
			app := strings.TrimSpace(resource.AppCode)
			if app == "" || strings.TrimSpace(resource.PlatformCode) == targetCode {
				continue
			}
			cacheKey := app + "|" + targetCode
			belongs, cached := belongsCache[cacheKey]
			if !cached {
				belongs, err = s.dict.PlatformBelongsToApp(ctx, app, targetCode)
				if err != nil {
					return nil, err
				}
				belongsCache[cacheKey] = belongs
			}
			if !belongs {
				failures = append(failures, BulkReassignFailure{
					ResourceID: resource.ResourceID,
					Reason: fmt.Sprintf(
						"应用 %q 未关联目标平台 %q，请先调整应用↔平台关联，或先批量改应用归属",
						app, targetCode,
					),
				})
			}
		case ReassignFieldAppCode:
			if resource.Category.IsComposed() {
				continue
			}
			platform := strings.TrimSpace(resource.PlatformCode)
			if platform == "" || platform == derivedPlatform {
				continue
			}
			cacheKey := targetCode + "|" + platform
			belongs, cached := belongsCache[cacheKey]
			if !cached {
				belongs, err = s.dict.PlatformBelongsToApp(ctx, targetCode, platform)
				if err != nil {
					return nil, err
				}
				belongsCache[cacheKey] = belongs
			}
			if !belongs {
				failures = append(failures, BulkReassignFailure{
					ResourceID: resource.ResourceID,
					Reason: fmt.Sprintf(
						"平台 %q 未关联目标应用 %q，请先调整应用↔平台关联，或批量改平台后再试",
						platform, targetCode,
					),
				})
			}
		}
	}
	if len(failures) > 0 {
		return nil, &BulkReassignError{Failures: failures}
	}

	updated, err := s.repo.BulkReassign(ctx, repository.BulkReassignInput{
		ResourceIDs:         ids,
		Field:               field,
		TargetCode:          targetCode,
		DerivedPlatformCode: derivedPlatform,
	})
	if err != nil {
		return nil, err
	}
	if int(updated) != len(ids) {
		return nil, fmt.Errorf("批量改归属未完全生效：期望 %d 条，实际 %d 条，请重试", len(ids), updated)
	}
	s.notifyAll(ctx)
	return &BulkReassignResult{UpdatedCount: int(updated)}, nil
}

func normalizeBulkReassignIDs(resourceIDs []string) []string {
	seen := make(map[string]struct{}, len(resourceIDs))
	out := make([]string, 0, len(resourceIDs))
	for _, id := range resourceIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func (s *ResourceService) notifyDomains(ctx context.Context, domainIDs ...string) {
	if s.notifier != nil {
		s.notifier.ResourceChanged(ctx, domainIDs...)
	}
}

func (s *ResourceService) notifyAll(ctx context.Context) {
	if s.notifier != nil {
		s.notifier.AllResourcesChanged(ctx)
	}
}

func (s *ResourceService) resolvePlatform(ctx context.Context, resource *domain.Resource) error {
	return resolvePlatformFor(ctx, s.dict, resource)
}

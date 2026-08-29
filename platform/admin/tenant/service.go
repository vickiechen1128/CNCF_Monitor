package tenant

import (
	"errors"
	"fmt"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
)

// 校验规则（PRD §6.1 空白项自定并留痕 dev-feedback）：name trim 后非空，
// 长度上限取 DB 列宽 100；id 上限取 DB 列宽 64。
const (
	maxTenantNameLen = 100
	maxTenantIDLen   = 64
)

// Sentinel errors mapped by the handler layer to the standard errorType
// enumeration (03_API_Standard §3).
var (
	// ErrNotFound indicates the target tenant does not exist (-> 404 not_found).
	ErrNotFound = errors.New("tenant not found")
)

// ValidationError marks a client-side input violation (-> 400 bad_request);
// the message is safe to echo back to the client.
type ValidationError struct{ msg string }

// Error returns the validation failure detail.
func (e *ValidationError) Error() string { return e.msg }

func newValidationError(format string, args ...interface{}) *ValidationError {
	return &ValidationError{msg: fmt.Sprintf(format, args...)}
}

// Service 承载租户管理 MVP 子集的业务规则：列表/详情读取与 name/
// multi_site_enabled 编辑校验。新建与禁用不在 MVP 范围，由 handler 层直接
// 返回 forbidden，不进入 Service。
type Service struct {
	repo *Repository
}

// NewService constructs a Service on top of repo.
func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// ListTenants returns one page of tenants plus the全量 total. status 非空时
// 仅返回该状态的租户；空串等价于不过滤。
func (s *Service) ListTenants(page, pageSize int, status string) ([]models.Tenant, int64, error) {
	return s.repo.ListTenants(page, pageSize, status)
}

// GetTenant returns a single tenant by id.
func (s *Service) GetTenant(id string) (*models.Tenant, error) {
	return s.repo.FindByID(id)
}

// UpdateTenant edits the display name and/or multi-site flag of an existing
// tenant. Empty name / nil update is rejected; id/is_platform_admin/status 等
// 管理字段不可由本操作变更（结构上即不入体）。
func (s *Service) UpdateTenant(id string, name *string, multiSiteEnabled *bool) (*models.Tenant, error) {
	if name == nil && multiSiteEnabled == nil {
		return nil, newValidationError("nothing to update: provide name and/or multi_site_enabled")
	}
	if id == "" {
		return nil, newValidationError("tenant id is required")
	}
	if len(id) > maxTenantIDLen {
		return nil, newValidationError("tenant id exceeds %d characters", maxTenantIDLen)
	}
	tn, err := s.repo.FindByID(id)
	if err != nil {
		return nil, err
	}
	if name != nil {
		trimmed := strings.TrimSpace(*name)
		if trimmed == "" {
			return nil, newValidationError("name is required")
		}
		if len(trimmed) > maxTenantNameLen {
			return nil, newValidationError("name exceeds %d characters", maxTenantNameLen)
		}
		tn.Name = trimmed
	}
	if multiSiteEnabled != nil {
		tn.MultiSiteEnabled = *multiSiteEnabled
	}
	if err := s.repo.Save(tn); err != nil {
		return nil, err
	}
	return tn, nil
}
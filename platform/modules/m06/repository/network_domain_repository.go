package repository

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m06/domain"
	"gorm.io/gorm"
)

// ListNetworkDomainsFilter carries network-domain list filters.
type ListNetworkDomainsFilter struct {
	Status    string
	Keyword   string
	CloudCode string
	ZoneType  string
	TenantID  string
	Page      int
	PageSize  int
}

// NetworkDomainRepository persists administrative network domains.
type NetworkDomainRepository interface {
	List(ctx context.Context, filter ListNetworkDomainsFilter) ([]*domain.NetworkDomain, int64, error)
	Get(ctx context.Context, id string) (*domain.NetworkDomain, error)
	NameExists(ctx context.Context, name, excludeID string) (bool, error)
	IDExistsIncludingDeleted(ctx context.Context, id string) (bool, error)
	Create(ctx context.Context, item *domain.NetworkDomain) error
	Update(ctx context.Context, id string, input domain.UpdateNetworkDomainInput) (*domain.NetworkDomain, error)
	UpdateStatus(ctx context.Context, id string, status domain.DomainStatus) error
	Delete(ctx context.Context, id string) error
}

// GORMNetworkDomainRepository is the GORM-backed network-domain repository.
type GORMNetworkDomainRepository struct {
	db *gorm.DB
}

// NewGORMNetworkDomainRepository constructs a repository.
func NewGORMNetworkDomainRepository(db *gorm.DB) *GORMNetworkDomainRepository {
	return &GORMNetworkDomainRepository{db: db}
}

// List returns network domains matching the filters in created_at/id order.
func (r *GORMNetworkDomainRepository) List(ctx context.Context, filter ListNetworkDomainsFilter) ([]*domain.NetworkDomain, int64, error) {
	query := r.db.WithContext(ctx).Model(&models.NetworkDomain{})
	if filter.Status != "" {
		query = query.Where("status = ?", filter.Status)
	}
	if filter.CloudCode != "" {
		query = query.Where("cloud_code = ?", filter.CloudCode)
	}
	if filter.ZoneType != "" {
		query = query.Where("zone_type = ?", filter.ZoneType)
	}
	if filter.TenantID != "" {
		query = query.Where("tenant_id = ?", filter.TenantID)
	}
	if keyword := strings.TrimSpace(filter.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("(id LIKE ? OR name LIKE ?)", like, like)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count network domains: %w", err)
	}
	page := filter.Page
	if page < 1 {
		page = 1
	}
	pageSize := filter.PageSize
	if pageSize < 1 {
		pageSize = 20
	}
	var rows []models.NetworkDomain
	if err := query.Order("created_at ASC, id ASC").
		Offset((page - 1) * pageSize).Limit(pageSize).
		Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list network domains: %w", err)
	}
	out := make([]*domain.NetworkDomain, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainDomain(&rows[i]))
	}
	return out, total, nil
}

// Get returns one network domain or domain.NetworkDomainNotFoundError.
func (r *GORMNetworkDomainRepository) Get(ctx context.Context, id string) (*domain.NetworkDomain, error) {
	var row models.NetworkDomain
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, &domain.NetworkDomainNotFoundError{DomainID: id}
	}
	if err != nil {
		return nil, fmt.Errorf("get network domain %q: %w", id, err)
	}
	return toDomainDomain(&row), nil
}

// NameExists reports whether another live domain uses the same name
// (case-insensitive).
func (r *GORMNetworkDomainRepository) NameExists(ctx context.Context, name, excludeID string) (bool, error) {
	query := r.db.WithContext(ctx).Model(&models.NetworkDomain{}).Where("lower(name) = lower(?)", name)
	if excludeID != "" {
		query = query.Where("id <> ?", excludeID)
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return false, fmt.Errorf("check network domain name %q: %w", name, err)
	}
	return count > 0, nil
}

// IDExistsIncludingDeleted reports whether the id exists at all. Soft-deleted
// rows keep their primary key, so re-registration must return 409.
func (r *GORMNetworkDomainRepository) IDExistsIncludingDeleted(ctx context.Context, id string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Unscoped().Model(&models.NetworkDomain{}).
		Where("id = ?", id).Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("check network domain id %q: %w", id, err)
	}
	return count > 0, nil
}

// Create persists a new domain and synchronizes affected tenant caches in one
// transaction.
func (r *GORMNetworkDomainRepository) Create(ctx context.Context, item *domain.NetworkDomain) error {
	row := fromDomainDomain(item)
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(row).Error; err != nil {
			if isUniqueViolation(err) {
				return &domain.ConflictError{Message: fmt.Sprintf("network domain id %q already exists", item.ID)}
			}
			return fmt.Errorf("create network domain %q: %w", item.ID, err)
		}
		return syncTenantCaches(ctx, tx, append([]string{row.TenantID}, row.AuthorizedTenantIDs...)...)
	})
}

// isUniqueViolation reports whether the driver rejected a duplicate key. The
// service pre-checks ids, but a concurrent registration can still race; map it
// to a 409 instead of a 500.
func isUniqueViolation(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "unique constraint") ||
		strings.Contains(message, "duplicate key")
}

// Update applies mutable fields and synchronizes both old and new tenant
// caches in one transaction.
func (r *GORMNetworkDomainRepository) Update(ctx context.Context, id string, input domain.UpdateNetworkDomainInput) (*domain.NetworkDomain, error) {
	var updated *domain.NetworkDomain
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row models.NetworkDomain
		if err := tx.Where("id = ?", id).First(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return &domain.NetworkDomainNotFoundError{DomainID: id}
			}
			return fmt.Errorf("get network domain %q: %w", id, err)
		}
		oldAuthorized := append([]string(nil), row.AuthorizedTenantIDs...)
		if input.Name != nil {
			row.Name = strings.TrimSpace(*input.Name)
		}
		if input.Description != nil {
			row.Description = *input.Description
		}
		if input.ZoneType != nil {
			row.ZoneType = strings.TrimSpace(*input.ZoneType)
		}
		if input.AuthorizedTenantIDs != nil {
			row.AuthorizedTenantIDs = append([]string(nil), (*input.AuthorizedTenantIDs)...)
		}
		if err := tx.Model(&row).Select("name", "description", "zone_type", "authorized_tenant_ids").
			Updates(&row).Error; err != nil {
			return fmt.Errorf("update network domain %q: %w", id, err)
		}
		if err := syncTenantCaches(ctx, tx, append(append(oldAuthorized, row.AuthorizedTenantIDs...), row.TenantID)...); err != nil {
			return err
		}
		updated = toDomainDomain(&row)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return updated, nil
}

// UpdateStatus changes the administrative status.
func (r *GORMNetworkDomainRepository) UpdateStatus(ctx context.Context, id string, status domain.DomainStatus) error {
	result := r.db.WithContext(ctx).Model(&models.NetworkDomain{}).
		Where("id = ?", id).Update("status", string(status))
	if result.Error != nil {
		return fmt.Errorf("update network domain %q status: %w", id, result.Error)
	}
	if result.RowsAffected == 0 {
		return &domain.NetworkDomainNotFoundError{DomainID: id}
	}
	return nil
}

// Delete soft-deletes a domain and removes it from tenant caches.
func (r *GORMNetworkDomainRepository) Delete(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row models.NetworkDomain
		if err := tx.Where("id = ?", id).First(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return &domain.NetworkDomainNotFoundError{DomainID: id}
			}
			return fmt.Errorf("get network domain %q: %w", id, err)
		}
		if err := tx.Delete(&row).Error; err != nil {
			return fmt.Errorf("delete network domain %q: %w", id, err)
		}
		// Retire the runtime onboarding identity so a future re-registration can
		// never reuse the old agent token (M09 fields are not exposed by M06 v3).
		if err := tx.Unscoped().Model(&models.NetworkDomain{}).Where("id = ?", id).
			Updates(map[string]any{
				"token":                  "",
				"agent_type":             "",
				"remote_write_url":       "",
				"max_disk_usage_per_url": "",
				"center_endpoint":        "",
				"monitored_status":       "",
				"last_heartbeat":         nil,
				"agent_version":          "",
				"is_monitored":           false,
				"registration_status":    models.RegistrationStatusRetired,
			}).Error; err != nil {
			return fmt.Errorf("retire network domain %q runtime state: %w", id, err)
		}
		return syncTenantCaches(ctx, tx, append(row.AuthorizedTenantIDs, row.TenantID)...)
	})
}

// syncTenantCaches rebuilds tenants.network_domain_ids from the authoritative
// network_domains.authorized_tenant_ids field for the affected tenants.
func syncTenantCaches(ctx context.Context, tx *gorm.DB, tenantIDs ...string) error {
	unique := make(map[string]struct{}, len(tenantIDs))
	for _, id := range tenantIDs {
		if id = strings.TrimSpace(id); id != "" {
			unique[id] = struct{}{}
		}
	}
	if len(unique) == 0 {
		return nil
	}

	var domains []models.NetworkDomain
	if err := tx.WithContext(ctx).
		Select("id", "tenant_id", "authorized_tenant_ids").
		Find(&domains).Error; err != nil {
		return fmt.Errorf("list network domains for authorization sync: %w", err)
	}
	grants := make(map[string]map[string]struct{})
	add := func(tenantID, domainID string) {
		if tenantID == "" || domainID == "" {
			return
		}
		if grants[tenantID] == nil {
			grants[tenantID] = make(map[string]struct{})
		}
		grants[tenantID][domainID] = struct{}{}
	}
	for i := range domains {
		add(domains[i].TenantID, domains[i].ID)
		for _, tenantID := range domains[i].AuthorizedTenantIDs {
			add(tenantID, domains[i].ID)
		}
	}

	for tenantID := range unique {
		var tenant models.Tenant
		if err := tx.WithContext(ctx).Where("id = ? AND deleted_at IS NULL", tenantID).First(&tenant).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			return fmt.Errorf("load tenant %q for authorization sync: %w", tenantID, err)
		}
		ids := make([]string, 0, len(grants[tenantID]))
		for domainID := range grants[tenantID] {
			ids = append(ids, domainID)
		}
		sort.Strings(ids)
		tenant.NetworkDomainIDs = ids
		if err := tx.Model(&tenant).Select("network_domain_ids").Updates(&tenant).Error; err != nil {
			return fmt.Errorf("sync tenant %q domain authorizations: %w", tenantID, err)
		}
	}
	return nil
}

func toDomainDomain(row *models.NetworkDomain) *domain.NetworkDomain {
	return &domain.NetworkDomain{
		ID:                  row.ID,
		Name:                row.Name,
		Description:         row.Description,
		DomainType:          domain.DomainType(row.DomainType),
		ZoneType:            row.ZoneType,
		CloudCode:           row.CloudCode,
		TenantID:            row.TenantID,
		AuthorizedTenantIDs: append([]string(nil), row.AuthorizedTenantIDs...),
		Status:              domain.DomainStatus(row.Status),
		CreatedAt:           row.CreatedAt,
		UpdatedAt:           row.UpdatedAt,
	}
}

func fromDomainDomain(item *domain.NetworkDomain) *models.NetworkDomain {
	return &models.NetworkDomain{
		ID:                  item.ID,
		Name:                item.Name,
		Description:         item.Description,
		DomainType:          models.DomainType(item.DomainType),
		ZoneType:            item.ZoneType,
		CloudCode:           item.CloudCode,
		TenantID:            item.TenantID,
		AuthorizedTenantIDs: append([]string(nil), item.AuthorizedTenantIDs...),
		Channel:             models.ChannelTypeAgentPull,
		Status:              models.DomainStatus(item.Status),
		RegistrationStatus:  models.RegistrationStatusCreated,
	}
}

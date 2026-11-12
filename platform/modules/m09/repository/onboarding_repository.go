package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m09/domain"
)

// ListViewAdmin selects the administrative visibility (D34): every edge /
// collection domain, with an optional status filter.
const ListViewAdmin = "admin"

// domainTypeCollection is the read-compat domain type kept by D16.
const domainTypeCollection = "collection"

// onboardingSelect is the joined projection: M06 administrative fields + M09
// access state + edge-agent aggregates. Edge-agent counts are correlated
// subqueries so the list stays a single round trip (page size <= 100).
const onboardingSelect = `nm.id AS domain_id,
	nm.name AS name,
	COALESCE(nm.description, '') AS description,
	COALESCE(nm.cloud_code, '') AS cloud_code,
	COALESCE(nm.zone_type, '') AS zone_type,
	nm.tenant_id AS tenant_id,
	COALESCE(nm.authorized_tenant_ids, '[]') AS authorized_tenant_ids_json,
	nm.status AS admin_status,
	nm.domain_type AS admin_domain_type,
	COALESCE(nda.registration_status, 'created') AS registration_status,
	nda.monitored_at AS monitored_at,
	COALESCE(nda.token_masked, '') AS token_masked,
	COALESCE(nda.last_heartbeat_at, NULL) AS last_heartbeat_at,
	COALESCE(nda.last_config_version, '') AS last_config_version,
	COALESCE(nda.center_endpoint, '') AS center_endpoint,
	COALESCE(nda.remote_write_url, '') AS remote_write_url,
	nm.created_at AS created_at,
	nm.updated_at AS updated_at,
	(SELECT COUNT(*) FROM edge_agents a
	   WHERE a.network_domain_id = nm.id AND a.deleted_at IS NULL
	     AND a.status <> 'retired') AS agent_count,
	(SELECT COUNT(*) FROM edge_agents a
	   WHERE a.network_domain_id = nm.id AND a.deleted_at IS NULL AND a.status = 'online') AS online_agent_count`

// ListFilter carries onboarding list filters (contract §2.2).
type ListFilter struct {
	RegistrationStatus string
	Keyword            string
	CloudCode          string
	ZoneType           string
	TenantID           string
	// View selects the administrative visibility: empty/onboarding keeps the
	// monitorable scope (enabled edge domains); admin exposes every edge/
	// collection domain and allows the Status filter (D34).
	View string
	// Status filters the administrative state in the admin view.
	Status string
	// AllowedDomainIDs restricts the result to the caller's authorized domains.
	// nil means "no restriction" (platform admin); an empty non-nil slice means
	// "authorized to nothing" (always empty result).
	AllowedDomainIDs []string
	Page             int
	PageSize         int
}

// DomainOnboarding is the service-facing onboarding read model.
type DomainOnboarding struct {
	DomainID            string
	Name                string
	Description         string
	CloudCode           string
	ZoneType            string
	TenantID            string
	AuthorizedTenantIDs []string
	AdminStatus         string
	AdminDomainType     string
	RegistrationStatus  string
	MonitoredAt         *time.Time
	TokenMasked         string
	AgentCount          int64
	OnlineAgentCount    int64
	LastHeartbeatAt     *time.Time
	LastConfigVersion   string
	CenterEndpoint      string
	RemoteWriteURL      string
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

// OnboardingRepository persists M09 onboarding state and reads the joined view.
type OnboardingRepository interface {
	List(ctx context.Context, filter ListFilter) ([]DomainOnboarding, int64, error)
	Get(ctx context.Context, domainID string, allowed []string) (*DomainOnboarding, error)
	FindAccess(ctx context.Context, domainID string) (*domain.Access, error)
	UpsertAccess(ctx context.Context, item *domain.Access) error
	RetireDomainState(ctx context.Context, domainID string) error
	AgentImpact(ctx context.Context, domainID string) (total, online int64, err error)
}

// TenantReader resolves the tenant's authorized network domain set from the
// M06-maintained tenant cache (authoritative source: authorized_tenant_ids).
type TenantReader interface {
	AllowedDomainIDs(ctx context.Context, tenantID string) ([]string, error)
}

// GORMRepository is the GORM-backed M09 repository.
type GORMRepository struct {
	db *gorm.DB
}

// NewGORMRepository constructs a repository.
func NewGORMRepository(db *gorm.DB) *GORMRepository {
	return &GORMRepository{db: db}
}

// List returns onboarding rows. The default scope is enabled edge domains
// (§2.2); the admin view widens it to every edge/collection domain (D34).
func (r *GORMRepository) List(ctx context.Context, filter ListFilter) ([]DomainOnboarding, int64, error) {
	countQuery := r.applyConditions(r.base(ctx), filter)
	var total int64
	if err := countQuery.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count onboarding network domains: %w", err)
	}

	page := filter.Page
	if page < 1 {
		page = 1
	}
	pageSize := filter.PageSize
	if pageSize < 1 {
		pageSize = 20
	}

	var rows []domainOnboardingRow
	query := r.applyConditions(r.base(ctx), filter)
	if err := query.Select(onboardingSelect).
		Order("nm.created_at ASC, nm.id ASC").
		Offset((page - 1) * pageSize).Limit(pageSize).
		Scan(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list onboarding network domains: %w", err)
	}

	items := make([]DomainOnboarding, 0, len(rows))
	for i := range rows {
		items = append(items, toDomainOnboarding(&rows[i]))
	}
	return items, total, nil
}

// Get returns one onboarding row, or domain.NotFoundError when the domain is
// missing or outside the caller's authorized set.
func (r *GORMRepository) Get(ctx context.Context, domainID string, allowed []string) (*DomainOnboarding, error) {
	query := r.base(ctx).Where("nm.deleted_at IS NULL AND nm.domain_type = ? AND nm.id = ?",
		domain.MonitorableDomainTypeEdge, domainID)
	query = applyAllowed(query, allowed)

	var row domainOnboardingRow
	if err := query.Select(onboardingSelect).Limit(1).Scan(&row).Error; err != nil {
		return nil, fmt.Errorf("get onboarding network domain %q: %w", domainID, err)
	}
	if row.DomainID == "" {
		return nil, &domain.NotFoundError{DomainID: domainID}
	}
	item := toDomainOnboarding(&row)
	return &item, nil
}

// FindAccess returns the access row, or (nil, nil) when the domain has never
// been monitored.
func (r *GORMRepository) FindAccess(ctx context.Context, domainID string) (*domain.Access, error) {
	var row accessRecord
	err := r.db.WithContext(ctx).Where("domain_id = ?", domainID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get network domain access %q: %w", domainID, err)
	}
	return toDomainAccess(&row), nil
}

// UpsertAccess inserts or updates the onboarding row. It never writes
// heartbeat/config columns owned by the edge protocol (B4).
func (r *GORMRepository) UpsertAccess(ctx context.Context, item *domain.Access) error {
	now := time.Now().UTC()
	updates := map[string]any{
		"token_hash":             item.TokenHash,
		"token_masked":           item.TokenMasked,
		"token_created_at":       item.TokenCreatedAt,
		"registration_status":    string(item.RegistrationStatus),
		"monitored_at":           item.MonitoredAt,
		"center_endpoint":        item.CenterEndpoint,
		"remote_write_url":       item.RemoteWriteURL,
		"max_disk_usage_per_url": item.MaxDiskUsagePerURL,
		"updated_at":             now,
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&accessRecord{}).Where("domain_id = ?", item.DomainID).Updates(updates)
		if result.Error != nil {
			return fmt.Errorf("update network domain access %q: %w", item.DomainID, result.Error)
		}
		if result.RowsAffected > 0 {
			return nil
		}
		row := accessRecord{
			DomainID:           item.DomainID,
			TokenHash:          item.TokenHash,
			TokenMasked:        item.TokenMasked,
			TokenCreatedAt:     item.TokenCreatedAt,
			RemoteWriteURL:     item.RemoteWriteURL,
			CenterEndpoint:     item.CenterEndpoint,
			MaxDiskUsagePerURL: item.MaxDiskUsagePerURL,
			RegistrationStatus: string(item.RegistrationStatus),
			MonitoredAt:        item.MonitoredAt,
			CreatedAt:          now,
			UpdatedAt:          now,
		}
		if err := tx.Create(&row).Error; err != nil {
			// A concurrent insert may have won the race; retry the update once.
			retry := tx.Model(&accessRecord{}).Where("domain_id = ?", item.DomainID).Updates(updates)
			if retry.Error != nil {
				return fmt.Errorf("create network domain access %q: %w", item.DomainID, err)
			}
			if retry.RowsAffected == 0 {
				return fmt.Errorf("create network domain access %q: %w", item.DomainID, err)
			}
		}
		return nil
	})
}

// RetireDomainState cascades the M09 retirement: revoke the token, retire edge
// agents and drop target/config snapshots. It is idempotent and safe to retry.
func (r *GORMRepository) RetireDomainState(ctx context.Context, domainID string) error {
	now := time.Now().UTC()
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&accessRecord{}).Where("domain_id = ?", domainID).Updates(map[string]any{
			"registration_status": string(domain.RegistrationStatusRetired),
			"token_hash":          "",
			"token_masked":        "",
			"token_created_at":    nil,
			"monitored_at":        nil,
			"updated_at":          now,
		}).Error; err != nil {
			return fmt.Errorf("retire network domain access %q: %w", domainID, err)
		}
		if err := tx.Exec(`UPDATE edge_agents SET status = 'retired', deleted_at = ?, updated_at = ?
			WHERE network_domain_id = ? AND deleted_at IS NULL`, now, now, domainID).Error; err != nil {
			return fmt.Errorf("retire edge agents for %q: %w", domainID, err)
		}
		if err := tx.Exec(`DELETE FROM edge_target_snapshots WHERE network_domain_id = ?`, domainID).Error; err != nil {
			return fmt.Errorf("clear target snapshots for %q: %w", domainID, err)
		}
		if err := tx.Exec(`DELETE FROM domain_config_snapshots WHERE network_domain_id = ?`, domainID).Error; err != nil {
			return fmt.Errorf("clear config snapshots for %q: %w", domainID, err)
		}
		return nil
	})
}

// AgentImpact returns the managed edge-agent count and how many are online.
func (r *GORMRepository) AgentImpact(ctx context.Context, domainID string) (int64, int64, error) {
	var row struct {
		Total  int64
		Online int64
	}
	err := r.db.WithContext(ctx).Table("edge_agents").
		Select("COUNT(*) AS total, COALESCE(SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END), 0) AS online").
		Where("network_domain_id = ? AND deleted_at IS NULL AND status <> 'retired'", domainID).
		Scan(&row).Error
	if err != nil {
		return 0, 0, fmt.Errorf("count edge agents for %q: %w", domainID, err)
	}
	return row.Total, row.Online, nil
}

// AllowedDomainIDs reads the tenant's authorized network domain set. A missing
// tenant yields an empty set (no domains visible).
func (r *GORMRepository) AllowedDomainIDs(ctx context.Context, tenantID string) ([]string, error) {
	var tenant models.Tenant
	err := r.db.WithContext(ctx).Select("id", "network_domain_ids").
		Where("id = ? AND deleted_at IS NULL", tenantID).First(&tenant).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return []string{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load tenant %q authorizations: %w", tenantID, err)
	}
	if tenant.NetworkDomainIDs == nil {
		return []string{}, nil
	}
	return tenant.NetworkDomainIDs, nil
}

func (r *GORMRepository) base(ctx context.Context) *gorm.DB {
	return r.db.WithContext(ctx).
		Table("network_domains AS nm").
		Joins("LEFT JOIN network_domain_access AS nda ON nda.domain_id = nm.id")
}

func (r *GORMRepository) applyConditions(query *gorm.DB, filter ListFilter) *gorm.DB {
	query = query.Where("nm.deleted_at IS NULL")
	if filter.View == ListViewAdmin {
		query = query.Where("nm.domain_type IN ?", []string{domain.MonitorableDomainTypeEdge, domainTypeCollection})
		if filter.Status != "" {
			query = query.Where("nm.status = ?", filter.Status)
		}
	} else {
		query = query.Where("nm.domain_type = ? AND nm.status = ?",
			domain.MonitorableDomainTypeEdge, domain.MonitorableStatusEnabled)
	}
	if filter.RegistrationStatus != "" {
		query = query.Where("COALESCE(nda.registration_status, 'created') = ?", filter.RegistrationStatus)
	}
	if keyword := strings.TrimSpace(filter.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("(nm.id LIKE ? OR nm.name LIKE ?)", like, like)
	}
	if filter.CloudCode != "" {
		query = query.Where("nm.cloud_code = ?", filter.CloudCode)
	}
	if filter.ZoneType != "" {
		query = query.Where("nm.zone_type = ?", filter.ZoneType)
	}
	if filter.TenantID != "" {
		query = query.Where("nm.tenant_id = ?", filter.TenantID)
	}
	return applyAllowed(query, filter.AllowedDomainIDs)
}

func applyAllowed(query *gorm.DB, allowed []string) *gorm.DB {
	if allowed == nil {
		return query
	}
	if len(allowed) == 0 {
		return query.Where("1 = 0")
	}
	return query.Where("nm.id IN ?", allowed)
}

func toDomainOnboarding(row *domainOnboardingRow) DomainOnboarding {
	return DomainOnboarding{
		DomainID:            row.DomainID,
		Name:                row.Name,
		Description:         row.Description,
		CloudCode:           row.CloudCode,
		ZoneType:            row.ZoneType,
		TenantID:            row.TenantID,
		AuthorizedTenantIDs: parseStringList(row.AuthorizedTenantIDsJSON),
		AdminStatus:         row.AdminStatus,
		AdminDomainType:     row.AdminDomainType,
		RegistrationStatus:  row.RegistrationStatus,
		MonitoredAt:         row.MonitoredAt,
		TokenMasked:         row.TokenMasked,
		AgentCount:          row.AgentCount,
		OnlineAgentCount:    row.OnlineAgentCount,
		LastHeartbeatAt:     row.LastHeartbeatAt,
		LastConfigVersion:   row.LastConfigVersion,
		CenterEndpoint:      row.CenterEndpoint,
		RemoteWriteURL:      row.RemoteWriteURL,
		CreatedAt:           row.CreatedAt,
		UpdatedAt:           row.UpdatedAt,
	}
}

// parseStringList decodes the JSON-encoded authorized_tenant_ids column. A
// malformed/empty column degrades to an empty list instead of failing the read.
func parseStringList(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return []string{}
	}
	if out == nil {
		return []string{}
	}
	return out
}

func toDomainAccess(row *accessRecord) *domain.Access {
	return &domain.Access{
		DomainID:           row.DomainID,
		TokenHash:          row.TokenHash,
		TokenMasked:        row.TokenMasked,
		TokenCreatedAt:     row.TokenCreatedAt,
		RemoteWriteURL:     row.RemoteWriteURL,
		CenterEndpoint:     row.CenterEndpoint,
		MaxDiskUsagePerURL: row.MaxDiskUsagePerURL,
		RegistrationStatus: domain.RegistrationStatus(row.RegistrationStatus),
		MonitoredAt:        row.MonitoredAt,
		LastHeartbeatAt:    row.LastHeartbeatAt,
		LastConfigVersion:  row.LastConfigVersion,
		CreatedAt:          row.CreatedAt,
		UpdatedAt:          row.UpdatedAt,
	}
}

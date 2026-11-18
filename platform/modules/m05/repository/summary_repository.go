// Package repository holds the M05 v3 data access layer.
//
// The homepage summary is a pure read model over other modules' tables:
//
//	M07  resources + host_resources / database_resources / middleware_resources /
//	     generic_target_resources / application_resources / interface_service_resources
//	M01  m01_scrape_jobs (selected_instance_ids is the monitored-set source of truth)
//	M06  network_domains, cloud_dicts
//	M00  application_dicts / business_domains / platform_dicts / app_platform_rels
//
// M05 never writes those tables: it only projects them for the dashboard, exactly
// like the v2 `platform/dashboard` package did with the legacy models.
package repository

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

// ResourceRow is one live (not soft-deleted) M07 resource projected for the
// homepage aggregate. Nullable attribution columns are coalesced to empty
// strings: "unset" is a first-class bucket in every by_* aggregation.
type ResourceRow struct {
	ResourceID       string `gorm:"column:resource_id"`
	ResourceCategory string `gorm:"column:resource_category"`
	AppCode          string `gorm:"column:app_code"`
	BizCode          string `gorm:"column:biz_code"`
	PlatformCode     string `gorm:"column:platform_code"`
	NetworkDomainID  string `gorm:"column:network_domain_id"`
}

// JobRow is one effective (not soft-deleted, enabled, draft_status=ready) M01
// scrape job. Its selected_instance_ids carry the monitored relation.
type JobRow struct {
	ID                  string `gorm:"column:id"`
	JobName             string `gorm:"column:job_name"`
	JobType             string `gorm:"column:job_type"`
	NetworkDomainID     string `gorm:"column:network_domain_id"`
	SelectedInstanceIDs []byte `gorm:"column:selected_instance_ids"`
}

// DomainRow is one live network domain (M06). CloudCode is coalesced to "" so a
// domain without a cloud lands in the「未指定云」bucket.
type DomainRow struct {
	ID        string `gorm:"column:id"`
	Name      string `gorm:"column:name"`
	CloudCode string `gorm:"column:cloud_code"`
}

// AppPlatformRelRow is one live application ↔ platform relation (M07).
type AppPlatformRelRow struct {
	AppCode      string `gorm:"column:app_code"`
	PlatformCode string `gorm:"column:platform_code"`
}

// ProbeEndpoint is the display data of one blackbox-capable resource.
// Name is empty for applications: their display name comes from the application
// dictionary (app_code → app_name), not from an extension-table column.
type ProbeEndpoint struct {
	Name string `gorm:"column:name"`
	URL  string `gorm:"column:url"`
}

// JobCounts is the scrape-job counter pair (M01).
type JobCounts struct {
	Total   int64 `gorm:"column:total"`
	Enabled int64 `gorm:"column:enabled"`
}

// SummaryRepository reads every v3 table the homepage summary aggregates.
// It is an interface so the aggregation rules in the service layer can be unit
// tested without a database.
type SummaryRepository interface {
	// Resources returns every live resource projected for aggregation.
	Resources(ctx context.Context) ([]ResourceRow, error)
	// ResourceSubtypes returns resource_id → subtype for one of the four
	// category-specific subtype columns (empty map for application /
	// interface_service, which have no subtype axis).
	ResourceSubtypes(ctx context.Context, category string) (map[string]string, error)
	// ReadyJobs returns effective jobs (enabled + draft_status=ready, every
	// job_type) with their selected instance IDs.
	ReadyJobs(ctx context.Context) ([]JobRow, error)
	// ScrapeJobCounts returns the non-deleted job total and the enabled subset.
	ScrapeJobCounts(ctx context.Context) (JobCounts, error)
	// MonitoredDomainCount counts live network domains whose M09 access record
	// is in the monitored registration state (the former is_monitored column
	// was dropped in V3-only line).
	MonitoredDomainCount(ctx context.Context) (int64, error)
	// Domains returns every live network domain (id / name / cloud_code).
	Domains(ctx context.Context) ([]DomainRow, error)
	// AppNames returns app_code → app_name from application_dicts.
	AppNames(ctx context.Context) (map[string]string, error)
	// BizNames returns biz code → biz name from business_domains.
	BizNames(ctx context.Context) (map[string]string, error)
	// PlatformNames returns platform_code → platform_name from platform_dicts.
	PlatformNames(ctx context.Context) (map[string]string, error)
	// CloudNames returns cloud_code → cloud_name from cloud_dicts (disabled
	// entries included: a referenced code must stay resolvable).
	CloudNames(ctx context.Context) (map[string]string, error)
	// AppPlatformRels returns the live application ↔ platform relations.
	AppPlatformRels(ctx context.Context) ([]AppPlatformRelRow, error)
	// InterfaceServices returns resource_id → api_name/api_url for the given
	// resource IDs (blackbox targets of category interface_service).
	InterfaceServices(ctx context.Context, resourceIDs []string) (map[string]ProbeEndpoint, error)
	// Applications returns resource_id → health_check_url for the given
	// resource IDs (blackbox targets of category application).
	Applications(ctx context.Context, resourceIDs []string) (map[string]ProbeEndpoint, error)
}

// GORMSummaryRepository is the GORM/SQL implementation of SummaryRepository.
//
// Every query spells its soft-delete filter explicitly and only reads the
// columns the aggregate needs, so the homepage stays a bounded number of scans
// (no per-resource N+1).
type GORMSummaryRepository struct {
	db *gorm.DB
}

// NewGORMSummaryRepository constructs the summary repository.
func NewGORMSummaryRepository(db *gorm.DB) *GORMSummaryRepository {
	return &GORMSummaryRepository{db: db}
}

// Resources implements SummaryRepository.
func (r *GORMSummaryRepository) Resources(ctx context.Context) ([]ResourceRow, error) {
	const query = `SELECT resource_id, resource_category,
		COALESCE(app_code, '') AS app_code,
		COALESCE(biz_code, '') AS biz_code,
		COALESCE(platform_code, '') AS platform_code,
		COALESCE(network_domain_id, '') AS network_domain_id
		FROM resources
		WHERE deleted_at IS NULL
		ORDER BY resource_id`
	rows := make([]ResourceRow, 0)
	if err := r.db.WithContext(ctx).Raw(query).Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("list resources for dashboard summary: %w", err)
	}
	return rows, nil
}

// subtypeSource is the (extension table, subtype column) pair backing by_subtype.
// Both values are compile-time constants; the SQL below never interpolates user
// input (the category is passed as a bind parameter).
type subtypeSource struct {
	table  string
	column string
}

// subtypeSources is the closed whitelist of by_subtype dimensions, matching the
// M05 PRD / v2 `subtypeFieldForCategory`:
//
//	host              → host_resources.os_type
//	database          → database_resources.database_type
//	middleware        → middleware_resources.middleware_type
//	generic_target    → generic_target_resources.exporter_type
//
// application and interface_service intentionally have no subtype axis (they
// return an empty array).
var subtypeSources = map[string]subtypeSource{
	"host":           {table: "host_resources", column: "os_type"},
	"database":       {table: "database_resources", column: "database_type"},
	"middleware":     {table: "middleware_resources", column: "middleware_type"},
	"generic_target": {table: "generic_target_resources", column: "exporter_type"},
}

// ResourceSubtypes implements SummaryRepository.
func (r *GORMSummaryRepository) ResourceSubtypes(ctx context.Context, category string) (map[string]string, error) {
	source, ok := subtypeSources[category]
	if !ok {
		return map[string]string{}, nil
	}
	query := fmt.Sprintf(`SELECT r.resource_id AS resource_id, COALESCE(x.%s, '') AS subtype
		FROM resources r
		JOIN %s x ON x.resource_id = r.resource_id
		WHERE r.deleted_at IS NULL AND r.resource_category = ?`,
		source.column, source.table)
	var rows []struct {
		ResourceID string `gorm:"column:resource_id"`
		Subtype    string `gorm:"column:subtype"`
	}
	if err := r.db.WithContext(ctx).Raw(query, category).Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("list %s subtypes for dashboard summary: %w", category, err)
	}
	out := make(map[string]string, len(rows))
	for _, row := range rows {
		out[row.ResourceID] = row.Subtype
	}
	return out, nil
}

// ReadyJobs implements SummaryRepository.
func (r *GORMSummaryRepository) ReadyJobs(ctx context.Context) ([]JobRow, error) {
	const query = `SELECT id, job_name, job_type, network_domain_id, selected_instance_ids
		FROM m01_scrape_jobs
		WHERE deleted_at IS NULL AND draft_status = ? AND enabled = ?
		ORDER BY id`
	rows := make([]JobRow, 0)
	if err := r.db.WithContext(ctx).Raw(query, "ready", true).Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("list effective scrape jobs: %w", err)
	}
	return rows, nil
}

// ScrapeJobCounts implements SummaryRepository.
func (r *GORMSummaryRepository) ScrapeJobCounts(ctx context.Context) (JobCounts, error) {
	const query = `SELECT COUNT(*) AS total,
		COALESCE(SUM(CASE WHEN enabled THEN 1 ELSE 0 END), 0) AS enabled
		FROM m01_scrape_jobs
		WHERE deleted_at IS NULL`
	var counts JobCounts
	if err := r.db.WithContext(ctx).Raw(query).Scan(&counts).Error; err != nil {
		return JobCounts{}, fmt.Errorf("count scrape jobs: %w", err)
	}
	return counts, nil
}

// MonitoredDomainCount implements SummaryRepository.
//
// V3-only: is_monitored no longer exists on network_domains. The authoritative
// onboarding state lives in network_domain_access.registration_status (M09), so
// count live domains through that 1:1 access record.
func (r *GORMSummaryRepository) MonitoredDomainCount(ctx context.Context) (int64, error) {
	const query = `SELECT COUNT(*) FROM network_domain_access nda
		JOIN network_domains nd ON nd.id = nda.domain_id
		WHERE nda.registration_status = ? AND nd.deleted_at IS NULL`
	var count int64
	if err := r.db.WithContext(ctx).Raw(query, "monitored").Scan(&count).Error; err != nil {
		return 0, fmt.Errorf("count monitored network domains: %w", err)
	}
	return count, nil
}

// Domains implements SummaryRepository.
func (r *GORMSummaryRepository) Domains(ctx context.Context) ([]DomainRow, error) {
	const query = `SELECT id, name, COALESCE(cloud_code, '') AS cloud_code
		FROM network_domains
		WHERE deleted_at IS NULL
		ORDER BY id`
	rows := make([]DomainRow, 0)
	if err := r.db.WithContext(ctx).Raw(query).Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("list network domains for dashboard summary: %w", err)
	}
	return rows, nil
}

// AppNames implements SummaryRepository.
func (r *GORMSummaryRepository) AppNames(ctx context.Context) (map[string]string, error) {
	return r.nameMap(ctx, `SELECT app_code AS code, app_name AS name
		FROM application_dicts WHERE deleted_at IS NULL`, "application dict")
}

// BizNames implements SummaryRepository.
func (r *GORMSummaryRepository) BizNames(ctx context.Context) (map[string]string, error) {
	return r.nameMap(ctx, `SELECT code, name
		FROM business_domains WHERE deleted_at IS NULL`, "business domains")
}

// PlatformNames implements SummaryRepository.
func (r *GORMSummaryRepository) PlatformNames(ctx context.Context) (map[string]string, error) {
	return r.nameMap(ctx, `SELECT platform_code AS code, platform_name AS name
		FROM platform_dicts WHERE deleted_at IS NULL`, "platform dict")
}

// CloudNames implements SummaryRepository.
func (r *GORMSummaryRepository) CloudNames(ctx context.Context) (map[string]string, error) {
	return r.nameMap(ctx, `SELECT cloud_code AS code, cloud_name AS name
		FROM cloud_dicts WHERE deleted_at IS NULL`, "cloud dict")
}

// nameMap executes a (code, name) projection and folds it into a map.
func (r *GORMSummaryRepository) nameMap(ctx context.Context, query, what string) (map[string]string, error) {
	var rows []struct {
		Code string `gorm:"column:code"`
		Name string `gorm:"column:name"`
	}
	if err := r.db.WithContext(ctx).Raw(query).Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("list %s: %w", what, err)
	}
	out := make(map[string]string, len(rows))
	for _, row := range rows {
		if row.Code == "" {
			continue
		}
		out[row.Code] = row.Name
	}
	return out, nil
}

// AppPlatformRels implements SummaryRepository.
func (r *GORMSummaryRepository) AppPlatformRels(ctx context.Context) ([]AppPlatformRelRow, error) {
	const query = `SELECT app_code, platform_code
		FROM app_platform_rels
		WHERE deleted_at IS NULL
		ORDER BY app_code, platform_code`
	rows := make([]AppPlatformRelRow, 0)
	if err := r.db.WithContext(ctx).Raw(query).Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("list app platform relations: %w", err)
	}
	return rows, nil
}

// InterfaceServices implements SummaryRepository.
func (r *GORMSummaryRepository) InterfaceServices(ctx context.Context, resourceIDs []string) (map[string]ProbeEndpoint, error) {
	out := make(map[string]ProbeEndpoint, len(resourceIDs))
	if len(resourceIDs) == 0 {
		return out, nil
	}
	const query = `SELECT resource_id, api_name AS name, api_url AS url
		FROM interface_service_resources
		WHERE resource_id IN ?`
	var rows []struct {
		ResourceID string `gorm:"column:resource_id"`
		Name       string `gorm:"column:name"`
		URL        string `gorm:"column:url"`
	}
	if err := r.db.WithContext(ctx).Raw(query, resourceIDs).Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("list interface services for probe targets: %w", err)
	}
	for _, row := range rows {
		out[row.ResourceID] = ProbeEndpoint{Name: row.Name, URL: row.URL}
	}
	return out, nil
}

// Applications implements SummaryRepository.
func (r *GORMSummaryRepository) Applications(ctx context.Context, resourceIDs []string) (map[string]ProbeEndpoint, error) {
	out := make(map[string]ProbeEndpoint, len(resourceIDs))
	if len(resourceIDs) == 0 {
		return out, nil
	}
	const query = `SELECT resource_id, health_check_url AS url
		FROM application_resources
		WHERE resource_id IN ?`
	var rows []struct {
		ResourceID string `gorm:"column:resource_id"`
		URL        string `gorm:"column:url"`
	}
	if err := r.db.WithContext(ctx).Raw(query, resourceIDs).Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("list applications for probe targets: %w", err)
	}
	for _, row := range rows {
		out[row.ResourceID] = ProbeEndpoint{URL: row.URL}
	}
	return out, nil
}

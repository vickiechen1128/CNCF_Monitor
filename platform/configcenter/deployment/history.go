package deployment

import (
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// ListVersions 分页列出某网域的配置版本（契约 §5，network_domain_id 必填；
// change_no 可选收窄）。按 created_at 倒序返回。
func ListVersions(db *gorm.DB, domainID, changeNo string, page, pageSize int) ([]models.ConfigVersion, int64, error) {
	if domainID == "" {
		return nil, 0, ErrDomainRequired
	}
	q := db.Model(&models.ConfigVersion{}).Where("network_domain_id = ?", domainID)
	if changeNo != "" {
		q = q.Where("change_no = ?", changeNo)
	}
	return pagedVersions(db, q, page, pageSize)
}

// GetVersion 按 id 取配置版本详情（契约 §5，供 diff）。
func GetVersion(db *gorm.DB, id string) (*models.ConfigVersion, error) {
	return loadVersion(db, id)
}

// ListDeployments 分页列出某网域的下发记录（契约 §5；status / change_no 可选收窄）。
func ListDeployments(db *gorm.DB, domainID, status, changeNo string, page, pageSize int) ([]models.ConfigDeployment, int64, error) {
	if domainID == "" {
		return nil, 0, ErrDomainRequired
	}
	q := db.Model(&models.ConfigDeployment{}).Where("network_domain_id = ?", domainID)
	if status != "" && status != "all" {
		q = q.Where("status = ?", status)
	}
	if changeNo != "" {
		q = q.Where("source_change_no = ?", changeNo)
	}
	return pagedDeployments(db, q, page, pageSize)
}

func pagedVersions(db *gorm.DB, q *gorm.DB, page, pageSize int) ([]models.ConfigVersion, int64, error) {
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count config versions: %w", err)
	}
	var items []models.ConfigVersion
	if err := q.Order("created_at desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&items).Error; err != nil {
		return nil, 0, fmt.Errorf("list config versions: %w", err)
	}
	return items, total, nil
}

func pagedDeployments(db *gorm.DB, q *gorm.DB, page, pageSize int) ([]models.ConfigDeployment, int64, error) {
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count deployments: %w", err)
	}
	var items []models.ConfigDeployment
	if err := q.Order("created_at desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&items).Error; err != nil {
		return nil, 0, fmt.Errorf("list deployments: %w", err)
	}
	return items, total, nil
}
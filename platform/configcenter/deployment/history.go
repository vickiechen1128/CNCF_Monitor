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

// GetVersion 取配置版本详情（契约 §5，供 diff）。
// 入参兼容两种 ref（T09-05 review-fix）：纯数字视为 ConfigVersion 数字主键 id，
// 否则视为 change_no——source_version 存上一版本 change_no，前端 diff 直接透传命中。
func GetVersion(db *gorm.DB, ref string) (*models.ConfigVersion, error) {
	if isNumeric(ref) {
		return loadVersion(db, ref)
	}
	return loadVersionByChangeNo(db, ref)
}

// isNumeric 判断 ref 是否为纯数字串（ConfigVersion 数字主键）。
func isNumeric(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// loadVersionByChangeNo 按 change_no 读取配置版本行（diff 拉基线版本）。
func loadVersionByChangeNo(db *gorm.DB, changeNo string) (*models.ConfigVersion, error) {
	var v models.ConfigVersion
	if err := db.Where("change_no = ?", changeNo).First(&v).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, ErrVersionNotFound
		}
		return nil, fmt.Errorf("load config version by change_no %s: %w", changeNo, err)
	}
	return &v, nil
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
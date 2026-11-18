package config

import (
	"errors"
	"strconv"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// ErrVersionNotFound 表示请求的版本不存在（契约 §3：not_found）。
var ErrVersionNotFound = errors.New("alertmanager config version not found")

// VersionListItem 是历史版本列表项（契约 §3：列表不返回 content 以省流量，
// id 输出为字符串）。
type VersionListItem struct {
	ID             string  `json:"id"`
	Checksum       string  `json:"checksum"`
	AppliedAt      *string `json:"applied_at,omitempty"`
	AppliedBy      string  `json:"applied_by,omitempty"`
	Status         string  `json:"status"`
	CreatedAt      string  `json:"created_at"`
	SourceChangeNo string  `json:"source_change_no,omitempty"`
}

// toListItem 将留痕版本转换为列表项（剥离 content，时间输出为 ISO 文本）。
func toListItem(v *models.AlertmanagerConfigVersion) VersionListItem {
	return VersionListItem{
		ID:             strconv.FormatUint(uint64(v.ID), 10),
		Checksum:       v.Checksum,
		AppliedAt:      formatTimeOrNil(v.AppliedAt),
		AppliedBy:      v.AppliedBy,
		Status:         string(v.Status),
		CreatedAt:      v.CreatedAt.Format(time.RFC3339),
		SourceChangeNo: v.SourceChangeNo,
	}
}

// formatTimeOrNil 将 *time.Time 输出为 RFC3339 文本；nil 返回 nil。
func formatTimeOrNil(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.Format(time.RFC3339)
	return &s
}

// ListVersions 分页返回历史版本列表（含总数），按挂载留痕时间倒序（最近在前）。
// 空结果返回空切片（契约 §1.4：空 [] 非 null）。
func ListVersions(db *gorm.DB, page, pageSize int) ([]VersionListItem, int64, error) {
	var total int64
	if err := db.Model(&models.AlertmanagerConfigVersion{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []models.AlertmanagerConfigVersion
	if err := db.Order("created_at DESC, id DESC").
		Offset((page - 1) * pageSize).Limit(pageSize).Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	items := make([]VersionListItem, 0, len(rows))
	for i := range rows {
		items = append(items, toListItem(&rows[i]))
	}
	return items, total, nil
}

// GetVersion 返回版本详情（完整 content 只读视图）；不存在返回 ErrVersionNotFound。
func GetVersion(db *gorm.DB, id uint) (*models.AlertmanagerConfigVersion, error) {
	if id == 0 {
		return nil, ErrVersionNotFound
	}
	var v models.AlertmanagerConfigVersion
	err := db.First(&v, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrVersionNotFound
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}
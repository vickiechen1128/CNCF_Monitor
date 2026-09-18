package edge

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"

	"gorm.io/gorm"
)

// configVersionString 生成边缘侧 config_version 标识（PRD §6.2 示例 "20260724-120000"）：
// 取 ConfigVersion.CreatedAt 的 UTC 时间戳 `YYYYMMDD-HHMMSS`。heartbeat 的
// config_changed 判定与 /edge/config 的 metadata 共用同一派生，保证可复算一致。
func configVersionString(v *models.ConfigVersion) string {
	return v.CreatedAt.UTC().Format("20060102-150405")
}

// latestConfigVersion 返回网域最新的 ConfigVersion（按 created_at/id 降序）；
// 无记录时返回 (nil, nil)。
func latestConfigVersion(db *gorm.DB, domainID string) (*models.ConfigVersion, error) {
	var v models.ConfigVersion
	err := db.Where("network_domain_id = ?", domainID).
		Order("created_at DESC, id DESC").First(&v).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load latest config version for %s: %w", domainID, err)
	}
	return &v, nil
}

// configDownloadURL 合成配置包拉取绝对地址（PRD §6.2，禁止相对路径）。
func configDownloadURL(dom *models.NetworkDomain) string {
	base := strings.TrimRight(dom.CenterEndpoint, "/")
	return base + "/api/v2/platform/edge/config?network_domain=" + url.QueryEscape(dom.ID)
}

// nowUTC 返回当前时间（UTC）；隔离以便测试注入。
func nowUTC() time.Time { return time.Now().UTC() }

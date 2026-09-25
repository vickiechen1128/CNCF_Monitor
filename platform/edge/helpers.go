package edge

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

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
// authority 形如 `https://host:port`（应含 scheme + host，由请求来源推导，
// 见 requestAuthority）。修正：不再依赖从未赋值的 dom.CenterEndpoint，否则会
// 拼出缺 host 的相对路径导致边缘 Agent 拉包失败（unsupported protocol scheme ""）。
func configDownloadURL(authority, domainID string) string {
	base := strings.TrimRight(authority, "/")
	return base + "/api/v2/platform/edge/config?network_domain=" + url.QueryEscape(domainID)
}

// requestAuthority 从心跳请求推导中心的对外绝对地址（scheme://host:port），用于
// 生成配置包拉取 URL。优先级：
//  1. X-Forwarded-Proto / X-Forwarded-Host（反代/Cloudflare Tunnel 注入的公网出处）；
//  2. 回落直接请求的 Host + 按 TLS 判断 scheme（本地直连场景）。
//
// 必须优先取转发头：心跳经 cloudflared 隧道到达本地中心时，Request.Host 是
// localhost:8080，直接用它会让腾讯云 Agent 回连 localhost 而失败。
func requestAuthority(c *gin.Context) string {
	proto := strings.TrimSpace(c.GetHeader("X-Forwarded-Proto"))
	host := strings.TrimSpace(c.GetHeader("X-Forwarded-Host"))
	if proto == "" {
		if c.Request.TLS != nil {
			proto = "https"
		} else {
			proto = "http"
		}
	}
	if host == "" {
		host = c.Request.Host
	}
	return proto + "://" + strings.TrimSpace(host)
}

// nowUTC 返回当前时间（UTC）；隔离以便测试注入。
func nowUTC() time.Time { return time.Now().UTC() }

// Package domain implements Module_09 网域监控纳管（onboard）服务层与 handler。
// 网易域从 M06 已建网域中选择纳管，维护 channel/agent_type/token/
// remote_write_url/center_endpoint 等监控纳管字段：
//   - default（历史预置管理域）固定 channel=local（中心同机写盘 reload，无需 Agent / Token）；
//   - 非 default 网域 MVP 仅登记监控参数（channel=agent_pull、agent_type 固定 vmagent），
//     Token 自动签发一次（明文仅签发/重置单次返回）。
//
// 参见 docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md
//   §3.1 / §6.1 / §5.1 与 api-contract-snapshot.md §6.1。
package domain

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// 服务层 sentinel 错误，handler 据此映射 HTTP errorType（not_found / bad_request）。
var (
	// ErrNotFound 表示网域未在 M06 建（或已软删）。
	ErrNotFound = errors.New("network domain not found")
	// ErrAlreadyMonitored 表示该网域已纳管。
	ErrAlreadyMonitored = errors.New("network domain already monitored")
	// ErrNotMonitored 表示该网域尚未纳管（如更新/重置前校验）。
	ErrNotMonitored = errors.New("network domain not monitored")
	// ErrInvalidAgentType 表示 agent_type 非法（MVP 仅支持 vmagent）。
	ErrInvalidAgentType = errors.New("unsupported agent_type (MVP only vmagent)")
	// ErrResetNotAgentPull 表示仅 agent_pull 网域可重置 token（local 拒绝）。
	ErrResetNotAgentPull = errors.New("reset token requires an agent_pull domain")
	// ErrResetRequiresMonitored 表示仅已纳管的 agent_pull 网域可重置 token。
	ErrResetRequiresMonitored = errors.New("reset token requires a monitored agent_pull domain")
)

// MonitorParams 是 POST /monitor 的入参（契约 §6.1）。
type MonitorParams struct {
	AgentType      string `json:"agent_type"`        // MVP 仅 vmagent
	RemoteWriteURL string `json:"remote_write_url"`  // 可选；agent_pull 域登记即写
	Description    string `json:"description,omitempty"`
}

// MonitorOutcome 描述纳管结果。
type MonitorOutcome struct {
	Domain *models.NetworkDomain
	Token  string // 仅 agent_pull 签发一次明文；local 恒为空
}

// UpdateParams 是 PUT /monitor 的入参（契约 §6.1）。
type UpdateParams struct {
	AgentType      string `json:"agent_type,omitempty"`
	RemoteWriteURL string `json:"remote_write_url,omitempty"`
	Description    string `json:"description,omitempty"`
	IsMonitored    *bool  `json:"is_monitored,omitempty"` // nil 表示不修改；false=unmonitor
}

// TokenResult 是 reset-token 的一次性明文 + 脱敏结果。
type TokenResult struct {
	Token       string `json:"token"`
	TokenMasked string `json:"token_masked"`
}

// MonitorDomain 纳管一个网域（POST /monitor）。
//   - default 域固定 channel=local，is_monitored=true，不签发 token；
//   - 非 default 域 channel=agent_pull + agent_type=vmagent（MVP 固定），自动签发 token。
func MonitorDomain(db *gorm.DB, id string, p MonitorParams) (MonitorOutcome, error) {
	var dom models.NetworkDomain
	if err := db.Where("id = ?", id).First(&dom).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return MonitorOutcome{}, ErrNotFound
		}
		return MonitorOutcome{}, fmt.Errorf("load network domain %s: %w", id, err)
	}
	if dom.IsMonitored {
		return MonitorOutcome{}, ErrAlreadyMonitored
	}
	if p.AgentType != "" && models.AgentType(p.AgentType) != models.AgentTypeVMAgent {
		return MonitorOutcome{}, ErrInvalidAgentType
	}

	if id == models.DefaultDomainID {
		// default 固定 local：无需 Agent 与 Token。
		dom.Channel = models.ChannelTypeLocal
		dom.AgentType = ""
		dom.RemoteWriteURL = ""
		dom.IsMonitored = true
		if err := db.Model(&dom).Select("channel", "agent_type", "remote_write_url", "is_monitored").Updates(dom).Error; err != nil {
			return MonitorOutcome{}, fmt.Errorf("persist default domain monitor: %w", err)
		}
		return MonitorOutcome{Domain: &dom}, nil
	}

	// 非 default 边缘域：agent_pull 登记制。
	token, err := newToken()
	if err != nil {
		return MonitorOutcome{}, err
	}
	dom.Channel = models.ChannelTypeAgentPull
	dom.AgentType = models.AgentTypeVMAgent
	dom.RemoteWriteURL = p.RemoteWriteURL
	dom.Token = token
	dom.IsMonitored = true
	if p.Description != "" {
		dom.Description = p.Description
	}
	if err := db.Model(&dom).Select("channel", "agent_type", "token", "remote_write_url", "description", "is_monitored").
		Updates(dom).Error; err != nil {
		return MonitorOutcome{}, fmt.Errorf("persist domain monitor: %w", err)
	}
	dom.TokenMaskedView = models.TokenMasked(token)
	return MonitorOutcome{Domain: &dom, Token: token}, nil
}

// UpdateDomainMonitoring 更新已纳管网域的监控参数（PUT /monitor；
// 可改 agent_type/remote_write_url/description/is_monitored，不可改 channel）。
func UpdateDomainMonitoring(db *gorm.DB, id string, p UpdateParams) (*models.NetworkDomain, error) {
	var dom models.NetworkDomain
	if err := db.Where("id = ?", id).First(&dom).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("load network domain %s: %w", id, err)
	}
	if !dom.IsMonitored {
		return nil, ErrNotMonitored
	}

	updates := map[string]interface{}{}
	if p.AgentType != "" {
		if models.AgentType(p.AgentType) != models.AgentTypeVMAgent {
			return nil, ErrInvalidAgentType
		}
		updates["agent_type"] = p.AgentType
	}
	if p.RemoteWriteURL != "" {
		updates["remote_write_url"] = p.RemoteWriteURL
	}
	if p.Description != "" {
		updates["description"] = p.Description
	}
	if p.IsMonitored != nil {
		updates["is_monitored"] = *p.IsMonitored
	}
	if len(updates) == 0 {
		return &dom, nil
	}
	if err := db.Model(&dom).Updates(updates).Error; err != nil {
		return nil, fmt.Errorf("update domain monitoring: %w", err)
	}
	// 重新读取以获得 AfterFind 派生的 token_masked 与最新时间戳。
	if err := db.Where("id = ?", id).First(&dom).Error; err != nil {
		return nil, fmt.Errorf("reload network domain %s: %w", id, err)
	}
	return &dom, nil
}

// ResetDomainToken 为 agent_pull 已纳管网域重置 token（POST /reset-token），
// 返回一次性明文与脱敏；local 或未纳管网域返回 bad_request。
func ResetDomainToken(db *gorm.DB, id string) (TokenResult, error) {
	var dom models.NetworkDomain
	if err := db.Where("id = ?", id).First(&dom).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return TokenResult{}, ErrNotFound
		}
		return TokenResult{}, fmt.Errorf("load network domain %s: %w", id, err)
	}
	if dom.Channel != models.ChannelTypeAgentPull {
		return TokenResult{}, ErrResetNotAgentPull
	}
	if !dom.IsMonitored {
		return TokenResult{}, ErrResetRequiresMonitored
	}
	token, err := newToken()
	if err != nil {
		return TokenResult{}, err
	}
	if err := db.Model(&dom).Update("token", token).Error; err != nil {
		return TokenResult{}, fmt.Errorf("reset domain token: %w", err)
	}
	return TokenResult{Token: token, TokenMasked: models.TokenMasked(token)}, nil
}

// newToken 生成随机 hex token（crypto/rand，32 字节 → 64 位 hex）。
func newToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate token: %w", err)
	}
	return hex.EncodeToString(b), nil
}
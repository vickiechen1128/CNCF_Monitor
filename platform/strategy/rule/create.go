package rule

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// CreateMonitoringRuleRequest 是创建规则挂载的请求体（api-contract-snapshot §7）：
// content_mode=yaml_passthrough、rule_content 必填、name / enabled / monitor_type 可空。
// Enabled 为指针：缺省（未传）按 true 处理，与采集 Job「创建默认启用」对齐
// （M01 PRD §8）；非指针 bool 会在前端漏传时以零值 false 落库，造成「保存即停用」。
// MonitorType 可空（PRD §5.5 透传模式可空），非空时须为合法监控对象类型。
type CreateMonitoringRuleRequest struct {
	ContentMode models.RuleContentMode `json:"content_mode"`
	RuleContent string                 `json:"rule_content"`
	Name        string                 `json:"name"`
	Enabled     *bool                  `json:"enabled"`
	MonitorType string                 `json:"monitor_type"`
}

// CreateMonitoringRule 是 POST /api/v2/platform/monitoring-rules 的 handler：
// content_mode=yaml_passthrough 时 rule_content 必填且 YAML 合法（至少 groups
// 存在且为数组，否则 bad_request）；scope=central 固定；draft_status=ready；
// change_status=pending（api-contract-snapshot §7）。
func CreateMonitoringRule(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateMonitoringRuleRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("invalid monitoring rule payload: %w", err))
			return
		}
		mode := req.ContentMode
		if mode == "" {
			mode = models.RuleContentModeYAMLPassthrough
		}
		if mode != models.RuleContentModeYAMLPassthrough {
			response.BadRequest(c, fmt.Errorf("content_mode 本期仅支持 yaml_passthrough"))
			return
		}
		if err := validateRuleYAML(req.RuleContent); err != nil {
			response.BadRequest(c, err)
			return
		}
		if mt := strings.TrimSpace(req.MonitorType); mt != "" && !models.ValidMonitorType(mt) {
			response.BadRequest(c, fmt.Errorf("monitor_type %q 非法（非受支持的监控对象类型）", req.MonitorType))
			return
		}

		// enabled 缺省默认启用（M01 PRD §8「创建默认启用」与采集 Job 对齐）。
		enabled := true
		if req.Enabled != nil {
			enabled = *req.Enabled
		}

		// 生效规则将合并进同一份 rules.yml：group 名须全局唯一（禁用时不下发，不校验）。
		if enabled {
			if err := validateGroupNamesAvailable(db, req.RuleContent, 0); err != nil {
				response.BadRequest(c, err)
				return
			}
		}

		r := &models.MonitoringRule{
			Name:         req.Name,
			ContentMode:  mode,
			RuleContent:  req.RuleContent,
			MonitorType:  strings.TrimSpace(req.MonitorType),
			Scope:        models.ScopeTypeCentral,
			Enabled:      enabled,
			DraftStatus:  "ready",
			ChangeStatus: models.ChangeStatusPending,
		}
		if err := db.Create(r).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("create monitoring rule: %w", err))
			return
		}
		response.OK(c, r)
	}
}

// readRuleByID 按 ID 读取规则；未命中返回 not_found 并写响应。
func readRuleByID(c *gin.Context, db *gorm.DB, id uint) (*models.MonitoringRule, bool) {
	var r models.MonitoringRule
	if err := db.First(&r, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			response.NotFound(c, fmt.Sprintf("monitoring rule %d not found", id))
			return nil, false
		}
		response.InternalServerError(c, fmt.Errorf("get monitoring rule %d: %w", id, err))
		return nil, false
	}
	return &r, true
}

// parseRuleID 解析 :id 路由参数为 uint，非法返回 false（bad_request 已写）。
func parseRuleID(c *gin.Context) (uint, bool) {
	raw := c.Param("id")
	id, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || id == 0 {
		response.BadRequest(c, fmt.Errorf("id 非法"))
		return 0, false
	}
	return uint(id), true
}
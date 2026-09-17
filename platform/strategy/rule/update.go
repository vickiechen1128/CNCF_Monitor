package rule

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/strategy/rule/jobref"
	"gorm.io/gorm"
)

// UpdateMonitoringRuleRequest 是更新规则挂载的请求体（api-contract-snapshot §7）：
// name / rule_content / enabled / monitor_type 可改；YAML 非法 bad_request。
// AckJobRefErrors 为决策 67-2 逃生门（见 CreateMonitoringRuleRequest）。
type UpdateMonitoringRuleRequest struct {
	Name            *string `json:"name"`
	RuleContent     *string `json:"rule_content"`
	Enabled         *bool   `json:"enabled"`
	MonitorType     *string `json:"monitor_type"`
	AckJobRefErrors bool    `json:"ack_job_ref_errors"`
}

// UpdateMonitoringRule 是 PUT /api/v2/platform/monitoring-rules/:id 的 handler。
// rule_content 提供时须为合法 YAML（至少 groups 数组）；应用变更后若规则生效
// （enabled && draft_status=ready），其 group 名须与其他生效规则全局唯一；not_found。
func UpdateMonitoringRule(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseRuleID(c)
		if !ok {
			return
		}
		var req UpdateMonitoringRuleRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("invalid monitoring rule payload: %w", err))
			return
		}
		r, ok := readRuleByID(c, db, id)
		if !ok {
			return
		}
		// 决策 44-1（F-25）：change_status=pending 的规则已挂起待确认变更单，
		// 禁止编辑，避免变更单内容与源数据脱节（与采集 Job 侧 409 模式对齐）。
		if r.ChangeStatus == models.ChangeStatusPending {
			response.Conflict(c, fmt.Errorf("规则 %q 存在待确认变更单，禁止编辑；请先前往配置变更确认页处理", r.Name))
			return
		}
		if req.Name != nil {
			r.Name = *req.Name
		}
		if req.Enabled != nil {
			r.Enabled = *req.Enabled
		}
		if req.MonitorType != nil {
			mt := strings.TrimSpace(*req.MonitorType)
			if mt != "" && !models.ValidMonitorType(mt) {
				response.BadRequest(c, fmt.Errorf("monitor_type %q 非法（非受支持的监控对象类型）", *req.MonitorType))
				return
			}
			r.MonitorType = mt
		}
		if req.RuleContent != nil {
			if err := validateRuleYAML(*req.RuleContent); err != nil {
				response.BadRequest(c, err)
				return
			}
			r.RuleContent = *req.RuleContent
		}
		// 生效规则将合并进同一份 rules.yml：变更后 group 名须全局唯一。
		if r.Enabled && r.DraftStatus == "ready" {
			if err := validateGroupNamesAvailable(db, r.RuleContent, r.ID); err != nil {
				response.BadRequest(c, err)
				return
			}
			// 决策 67-2：仅当本次请求携内容（抽屉的「保存变更」）时执行 job 引用门禁，
			// 避免列表页启停等操作被历史数据意外阻断；error 级默认阻断，逃生门可放行。
			if req.RuleContent != nil {
				if err := checkRuleJobRefGate(db, r.RuleContent, req.AckJobRefErrors); err != nil {
					response.BadRequestWithType(c, response.ErrorTypeJobRefUnresolved, err)
					return
				}
			}
		}
		if err := db.Save(r).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("update monitoring rule %d: %w", id, err))
			return
		}
		response.OK(c, r)
	}
}

// DeleteMonitoringRule 是 DELETE /api/v2/platform/monitoring-rules/:id 的 handler：
// 软删返回 {id}；not_found（api-contract-snapshot §7）。
func DeleteMonitoringRule(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseRuleID(c)
		if !ok {
			return
		}
		r, ok := readRuleByID(c, db, id)
		if !ok {
			return
		}
		// 决策 44-1（F-25）：change_status=pending 的规则已挂起待确认变更单，
		// 禁止删除，避免变更单成为幽灵单（与采集 Job 侧 409 模式对齐）。
		if r.ChangeStatus == models.ChangeStatusPending {
			response.Conflict(c, fmt.Errorf("规则 %q 存在待确认变更单，禁止删除；请先前往配置变更确认页处理", r.Name))
			return
		}
		if err := db.Delete(r).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("delete monitoring rule %d: %w", id, err))
			return
		}
		response.OK(c, gin.H{"id": id})
	}
}

// ValidateRuleYAMLRequest 是 validate-yaml 的请求体（api-contract-snapshot §7）。
type ValidateRuleYAMLRequest struct {
	RuleContent string `json:"rule_content"`
}

// ruleIDFromContext 容错解析 validate-yaml 的 :id：空 / 非数字 / 0 一律返回 0
// （「新建」语义，不排除自身）。该 :id 仅用于组名预检的「排除自身」，非法值不应中断
// 预检，故不写响应（区别于 parseRuleID 的 bad_request）。
func ruleIDFromContext(raw string) uint {
	id, err := strconv.ParseUint(strings.TrimSpace(raw), 10, 64)
	if err != nil {
		return 0
	}
	return uint(id)
}

// ValidateRuleYAML 是 POST /api/v2/platform/monitoring-rules/:id/validate-yaml 的
// handler：body {rule_content}，返回 `{valid, error?, job_ref?}`（不做持久化）。
//
// `valid` 语义（决策 69-1 修订）：表示**预检是否可提交**，`valid=false` 时 `error` 给出
// 原因，属**不可覆盖的硬失败**，共两类：
//  1. YAML 语法 / groups 结构非法；
//  2. 组名全局唯一性冲突（与提交侧同实现、同输入集，见 validateGroupNamesForCheck）。
//
// `job_ref` 的 error / warning 级 job 引用问题**不改写 `valid`**——它是另一根可经
// 「逃生门」（ack_job_ref_errors）覆盖的轴（决策 66 / 67-2）。响应形状向后兼容。
func ValidateRuleYAML(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req ValidateRuleYAMLRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("invalid validate-yaml payload: %w", err))
			return
		}
		if err := validateRuleYAML(req.RuleContent); err != nil {
			response.OK(c, gin.H{"valid": false, "error": err.Error(), "job_ref": []jobref.Issue{}})
			return
		}
		// 决策 69-1：组名全局唯一性并入预检（与提交侧同口径，停用规则不校验、编辑排除
		// 自身），使「检查通过 ⇒ 提交不会被组名冲突打回」（仅剩 TOCTOU 竞态）。
		if err := validateGroupNamesForCheck(db, req.RuleContent, ruleIDFromContext(c.Param("id"))); err != nil {
			response.OK(c, gin.H{"valid": false, "error": err.Error(), "job_ref": []jobref.Issue{}})
			return
		}
		issues := ValidateRuleJobRefs(db, req.RuleContent)
		if issues == nil {
			issues = []jobref.Issue{}
		}
		response.OK(c, gin.H{"valid": true, "job_ref": issues})
	}
}
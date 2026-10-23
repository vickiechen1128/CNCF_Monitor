// handler.go 实现 route 前台化 v0.3-a 只读渲染端点（T08-12）：
// GET /api/v2/platform/alertmanager/routes，把当前生效 alertmanager.yml 的 route 段解析为
// 前端「路由规则」页可消费的路由树视图。
//
// 只读、无写能力（鉴权面不扩张：仅全局认证，不挂 RequireAdmin）；响应不返回桥令牌等敏感值
// （receiver 出站地址按 notify 包同款口径脱敏）。解析失败 / 非常规结构降级为
// 「200 + parse_error + raw_yaml」的原文只读展示，绝不 500、不白屏。
//
// 参见 docs/05-execution-records/module-08/task-sequence.yaml T08-12；
//   docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md §9.1 / §11.7。
package route

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/alertmanager/config"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/configcenter/draft"
	"github.com/metriccenter/metriccenter/platform/domainregistry"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// ListRoutes 组装只读路由视图：
//
//   - 成功：{ items, declared_receivers }；
//   - 解析失败 / 非常规结构：{ parse_error, raw_yaml }（降级为原文只读展示，非 500）。
//
// 数据源为「平台最新产物视图」而非挂载留痕原文（见 effectiveAlertmanagerYAML）。
// 2026-10-22：未被路由引用的渠道是正常状态（不会物化），不再在路由页提示「死接收人」。
func ListRoutes(db *gorm.DB) (gin.H, error) {
	baseYAML, err := effectiveAlertmanagerYAML(db)
	if err != nil {
		return nil, err
	}

	// 「文件 receivers: 段已声明的接收人名」与 route 解析相互独立：即便 route 段解析失败进入
	// 降级分支，本字段仍然有效（前端据此判定引用是否悬空），故先于 ParseRouteTree 计算。
	declared := ParseDeclaredReceivers(baseYAML)

	checksum := models.AlertmanagerConfigChecksum(baseYAML)
	pending := pendingChangeView(db)

	nodes, err := ParseRouteTree(baseYAML)
	if err != nil {
		return gin.H{
			"parse_error":        err.Error(),
			"raw_yaml":           baseYAML,
			"declared_receivers": declared,
			"effective_checksum": checksum,
			"pending":            pending,
		}, nil
	}

	return gin.H{
		"items":              nodes,
		"declared_receivers": declared,
		"effective_checksum": checksum,
		"pending":            pending,
	}, nil
}

// pendingChangeView 返回管理域当前活 pending 变更单的轻量视图；无则 nil。
//
// 路由页据此提示「当前显示的是待确认版本，Alertmanager 仍在运行上一版」，
// 并给前端保存时使用的 base_checksum 一个可解释的来源。
func pendingChangeView(db *gorm.DB) interface{} {
	if db == nil {
		return nil
	}
	domID, err := domainregistry.ManagementDomainID(db)
	if err != nil {
		return nil
	}
	d, err := draft.LatestLivePending(db, domID)
	if err != nil || d == nil {
		return nil
	}
	return gin.H{
		"change_no":  d.ChangeNo,
		"created_at": d.CreatedAt,
	}
}

// effectiveAlertmanagerYAML 返回「平台最新产物视图」对应的 alertmanager.yml，按新鲜度取：
//
//  1. 管理域（default，决策 60：AM 产物恒属该域）最近一条**未废弃**草稿的 AlertmanagerYml；
//  2. 管理域最近一条已确认版本（ConfigVersion）的 AlertmanagerYml；
//  3. 上述两者取 created_at 较新者的非空产物；
//  4. 都没有（从未走过 M09 生成）→ 退化到 M08 挂载留痕 LatestApplied 的原文。
//
// 与 config/deployment 的写盘内容同源，故也解释得通「尚无 pending 单时的预览」：已生成待确认
// 的草稿产物即为「即将生效」的路由树。全部缺失时返回空串（调用方解析为空树）。
func effectiveAlertmanagerYAML(db *gorm.DB) (string, error) {
	best := ""
	var bestAt time.Time

	var d models.ConfigDraft
	err := db.Where("network_domain_id = ? AND status <> ?", models.DefaultDomainID, models.DraftStatusDiscarded).
		Order("created_at DESC, id DESC").First(&d).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", fmt.Errorf("load latest config draft: %w", err)
	}
	if err == nil && strings.TrimSpace(d.AlertmanagerYml) != "" {
		best, bestAt = d.AlertmanagerYml, d.CreatedAt
	}

	var v models.ConfigVersion
	err = db.Where("network_domain_id = ?", models.DefaultDomainID).
		Order("created_at DESC, id DESC").First(&v).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", fmt.Errorf("load latest config version: %w", err)
	}
	if err == nil && strings.TrimSpace(v.AlertmanagerYml) != "" && (best == "" || v.CreatedAt.After(bestAt)) {
		best = v.AlertmanagerYml
	}
	if best != "" {
		return best, nil
	}

	cur, err := config.LatestApplied(db)
	if err != nil {
		return "", fmt.Errorf("load latest applied alertmanager config: %w", err)
	}
	if cur == nil {
		return "", nil
	}
	return cur.Content, nil
}

// ListRoutesHandler 处理 GET /api/v2/platform/alertmanager/routes（仅全局认证、只读、无写能力）。
func ListRoutesHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			response.InternalServerError(c, fmt.Errorf("routes requires database connection"))
			return
		}
		data, err := ListRoutes(db)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, data)
	}
}

// EffectiveAlertmanagerYAML 返回「当前生效产品视图」alertmanager.yml 原文（C1：route 保存
// 合并基）。与 ListRoutes 同源（effectiveAlertmanagerYAML：草稿/版本优先、回落挂载留痕），
// 已是磁盘/config-output 即将生效的内容，含平台物化 receivers。响应 { yaml }。
//
// 前端保存 route 段时以此作为合并基：仅覆盖 route 段、保留 receivers 等平台物化内容，
// 避免回滚平台生成的接收人（useRoutes.ts 原以挂载留痕 /config/current 为基，会丢 receivers）。
func EffectiveAlertmanagerYAML(db *gorm.DB) (gin.H, error) {
	yamlStr, err := effectiveAlertmanagerYAML(db)
	if err != nil {
		return nil, err
	}
	return gin.H{"yaml": yamlStr}, nil
}

// EffectiveAlertmanagerYAMLHandler 处理 GET /api/v2/platform/alertmanager/config/product
// （RequireAdmin，与 /config/current 同级——内容含 receivers 出站凭据，须管理门）。返回
// { yaml: "<生效产品视图 alertmanager.yml>" }。
func EffectiveAlertmanagerYAMLHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			response.InternalServerError(c, fmt.Errorf("effective config requires database connection"))
			return
		}
		data, err := EffectiveAlertmanagerYAML(db)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, data)
	}
}
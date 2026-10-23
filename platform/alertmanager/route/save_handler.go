// save_handler.go 实现路由树保存端点：POST /api/v2/platform/alertmanager/routes。
//
// 2026-10-23 架构收口：前端只提交编辑态路由树，后端**整份重建** alertmanager.yml：
//  1. 乐观锁：base_checksum 必须与当前生效产品视图一致（防止覆盖他人改动）；
//  2. 树校验：根接收人 / 根 matchers / matcher 与时长 / 接收人可达性；
//  3. 整份重建 global + route + receivers（旧手写配置段不再保留，见
//     generator.BuildAlertmanagerConfig）；
//  4. 复用 config.Submit：amtool 校验 + 落版本 + 触发 M09。
package route

import (
	"errors"
	"fmt"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/alertmanager/config"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/configcenter/draft"
	"github.com/metriccenter/metriccenter/platform/configcenter/generator"
	"github.com/metriccenter/metriccenter/platform/domainregistry"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// ErrRoutesConflict 表示编辑期间配置已被他人更新（base_checksum 不匹配）。
var ErrRoutesConflict = errors.New("路由配置已被更新，请重新载入后再保存")

// submitRoutesConfig 是可注入的挂载工序（测试替换，避免依赖真实 amtool）。
var submitRoutesConfig = config.Submit

// ErrRouteTreeInvalid 表示路由树未通过后端校验。
type ErrRouteTreeInvalid struct {
	Issues []RouteIssue
}

func (e *ErrRouteTreeInvalid) Error() string {
	if e == nil || len(e.Issues) == 0 {
		return "路由树校验未通过"
	}
	return "路由保存前预检未通过：" + e.Issues[0].Message
}

// SaveRoutesRequest 是 POST /routes 的请求体。
type SaveRoutesRequest struct {
	// BaseChecksum 是进入编辑时 GET /routes 返回的 effective_checksum。
	// 为空时跳过乐观锁（兼容旧调用方）；新前端始终携带。
	BaseChecksum string `json:"base_checksum"`
	// RouteTree 是编辑态路由树（前序扁平，items[0] 为根）。
	RouteTree []generator.RouteEditNode `json:"route_tree" binding:"required"`
}

// SaveRoutesResult 是保存成功的响应。
type SaveRoutesResult struct {
	Version  *models.AlertmanagerConfigVersion `json:"version"`
	ChangeNo string                            `json:"change_no,omitempty"`
}

// SaveRoutes 执行「路由树 → route YAML → 整份配置 → M08 版本 → M09 草稿」。
func SaveRoutes(db *gorm.DB, req SaveRoutesRequest, uploadedBy string) (*SaveRoutesResult, error) {
	if db == nil {
		return nil, fmt.Errorf("routes save requires database connection")
	}
	if len(req.RouteTree) == 0 {
		return nil, &ErrRouteTreeInvalid{}
	}

	// 合并基 = 当前生效产品视图（与 GET /routes 同源）。
	baseYAML, err := effectiveAlertmanagerYAML(db)
	if err != nil {
		return nil, err
	}
	if req.BaseChecksum != "" && models.AlertmanagerConfigChecksum(baseYAML) != req.BaseChecksum {
		return nil, ErrRoutesConflict
	}

	// 路由树结构校验（不依赖渠道）。
	issues := ValidateRouteTree(req.RouteTree)
	if HasBlockingIssue(issues) {
		return nil, &ErrRouteTreeInvalid{Issues: issues}
	}

	// 整份重建（global + route + receivers）：旧文件中的手写 receivers / inhibit_rules
	// 等段落不再保留。输入由共用装配函数加载（渠道 + 平台入口地址），两个入口口径一致。
	routeSection, err := generator.GenerateRouteSection(req.RouteTree)
	if err != nil {
		return nil, &ErrRouteTreeInvalid{Issues: []RouteIssue{{
			Level:   RouteIssueLevelError,
			Code:    "route_generate_failed",
			Message: "生成路由配置失败：" + err.Error(),
		}}}
	}
	input, err := generator.LoadAlertmanagerConfigInput(db, routeSection)
	if err != nil {
		return nil, err
	}

	// 接收人可达集合 = 平台内置 default ∪ 全部通知渠道的稳定 receiver 名（notify-<id>）。
	// 历史手写 / 不属于平台渠道的残留 receiver 不再合法。
	allowedReceivers := make([]string, 0, len(input.Channels)+1)
	allowedReceivers = append(allowedReceivers, generator.DefaultReceiverName)
	for i := range input.Channels {
		allowedReceivers = append(allowedReceivers, input.Channels[i].ReceiverName())
	}
	issues = append(issues, ValidateRouteReceivers(req.RouteTree, allowedReceivers)...)
	if HasBlockingIssue(issues) {
		return nil, &ErrRouteTreeInvalid{Issues: issues}
	}

	configYAML, err := generator.BuildAlertmanagerConfig(input)
	if err != nil {
		return nil, &ErrRouteTreeInvalid{Issues: []RouteIssue{{
			Level:   RouteIssueLevelError,
			Code:    "route_generate_failed",
			Message: "生成路由配置失败：" + err.Error(),
		}}}
	}

	// 复用挂载链路：amtool 校验 + 落版本 + 触发 M09。
	version, submitErr := submitRoutesConfig(db, configYAML, uploadedBy)
	if version == nil {
		return nil, submitErr
	}
	if submitErr != nil {
		// errChangeTrigger 等降级：版本已落库成功，仅记录日志（与配置落库工序同口径）。
		log.Printf("[alertmanager-route] routes persisted but post-submit step failed: %v", submitErr)
	}

	// 返回本次对应的活 pending 变更单号（供前端直接跳转确认页）。
	changeNo := ""
	if domID, dErr := domainregistry.ManagementDomainID(db); dErr == nil {
		if d, lErr := draft.LatestLivePending(db, domID); lErr == nil && d != nil {
			changeNo = d.ChangeNo
		}
	}
	return &SaveRoutesResult{Version: version, ChangeNo: changeNo}, nil
}

// SaveRoutesHandler 处理 POST /api/v2/platform/alertmanager/routes（RequireAdmin）。
func SaveRoutesHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			response.InternalServerError(c, fmt.Errorf("routes save requires database connection"))
			return
		}
		var req SaveRoutesRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("解析请求体失败: %w", err))
			return
		}

		result, err := SaveRoutes(db, req, auth.CurrentUsername(c))
		if err != nil {
			var treeErr *ErrRouteTreeInvalid
			var validationErr *config.ErrValidation
			switch {
			case errors.Is(err, ErrRoutesConflict):
				response.Conflict(c, err)
			case errors.As(err, &treeErr):
				response.BadRequest(c, err)
			case errors.Is(err, domainregistry.ErrManagementDomainNotRegistered):
				response.Conflict(c, err)
			case errors.As(err, &validationErr):
				response.BadRequest(c, err)
			default:
				response.InternalServerError(c, err)
			}
			return
		}
		response.OK(c, result)
	}
}

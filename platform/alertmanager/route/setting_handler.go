// Package route 实现 Module_08「最小运行骨架自动布缆」（决策 113，口径 C）的默认接收人
// 设定读写 API：GET/PUT /api/v2/platform/alertmanager/route-setting。
//
// 语义：用户选定「默认接收人」即授权平台接管 alertmanager.yml 根兜底 route.receiver 单键
// （护栏③：null = 关闭接管，平台停止替换、不删最后写入的值）。写入后与挂载同构——触发
// M09 管理域变更重算 + 自动确认下发 + AM reload（Q4），响应**不含下发状态**（决策 60 冻结）。
// 复用 platform/alertmanager/config 的可注入工序（TriggerChangeDetection /
// AutoApplyManagementDomain），避免另起下发逻辑。
//
// 参见 docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md
//   §4.1.1 / §9.1 / §9.2；docs/05-execution-records/module-08/design-decisions.md 决策 113；
//   docs/05-execution-records/module-08/task-sequence.yaml T08-11。
package route

import (
	"errors"
	"fmt"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/alertmanager/config"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/configcenter/generator"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// effective_source 取值（决策 113 第 6 条：默认接收人 = 已启用渠道按 id 升序第一个）：
//
//   - explicit：用户显式指定默认接收人且目标渠道可用——平台当前**正在接管**根兜底
//     （enabled=true），生成时原地替换 route.receiver；
//   - auto_first_enabled：未设定默认接收人，但存在已启用渠道——仅作 UI 预填建议（取已启用
//     渠道按 id 升序第一个），平台**不接管**（enabled=false，产物字节不变）；
//   - none：无生效默认接收人（显式设定的目标渠道已停用/删除，或平台无任何已启用渠道）。
const (
	RouteReceiverSourceExplicit         = "explicit"
	RouteReceiverSourceAutoFirstEnabled = "auto_first_enabled"
	RouteReceiverSourceNone             = "none"
)

// ErrRouteSettingChannelUnavailable 指定的通知渠道不存在或未启用（PUT → 400 bad_request）。
var ErrRouteSettingChannelUnavailable = errors.New("指定的通知渠道不存在或未启用")

// ErrRouteSettingModeInvalid 指定的 route 段作者模式非法（非 handwritten / managed）。
var ErrRouteSettingModeInvalid = errors.New("route 段作者模式非法（须为 handwritten 或 managed）")

// 可注入工序（测试可替换），默认指向 config 包既有实现的导出包装——与挂载同构闭环。
var (
	triggerChangeDetection    = config.TriggerChangeDetection
	autoApplyManagementDomain = config.AutoApplyManagementDomain
)

// RouteSettingView 是 GET /route-setting 的响应视图（响应不返回桥令牌等敏感值）。
//
//   - Enabled：平台当前是否正在接管根兜底（即 EffectiveSource == explicit）；
//   - DefaultReceiverChannelID：持久化的设定值（nil = 不接管；显式设定的渠道停用后原值保留）；
//   - Mode：route 段作者模式（T08-F12 模式开关）：handwritten / managed；
//   - EffectiveReceiverName：实际（或建议）写入根 route.receiver 的 AM receiver 名；
//   - EffectiveSource：explicit / auto_first_enabled / none（见上方常量）。
type RouteSettingView struct {
	Enabled                  bool               `json:"enabled"`
	DefaultReceiverChannelID *uint              `json:"default_receiver_channel_id"`
	Mode                     models.RouteMode   `json:"mode"`
	EffectiveReceiverName    string             `json:"effective_receiver_name"`
	EffectiveSource          string             `json:"effective_source"`
}

// GetRouteSetting 读取默认接收人设定并派生生效态视图。
//
// 派生口径（护栏③：渠道停用仅回落为不接管、不回写库、不报错）：
//   - 显式设定（DefaultReceiverChannelID 非 nil）：目标渠道可用 → explicit + enabled=true；
//     不可用 → none + enabled=false（不为此另选其它渠道，保留用户显式意图原值）；
//   - 未设定：存在已启用渠道 → auto_first_enabled（仅建议，enabled=false）；
//     无已启用渠道 → none。
// Mode 取自持久化设定（T08-F12），存量零值归一为 handwritten。
func GetRouteSetting(db *gorm.DB) (*RouteSettingView, error) {
	setting, err := generator.LoadRouteSetting(db)
	if err != nil {
		return nil, err
	}
	channels, err := generator.LoadEnabledNotifyChannels(db)
	if err != nil {
		return nil, err
	}

	mode := setting.Mode
	if mode == "" {
		mode = models.RouteModeHandwritten
	}

	view := &RouteSettingView{DefaultReceiverChannelID: setting.DefaultReceiverChannelID, Mode: mode}
	if setting.DefaultReceiverChannelID != nil {
		if name, ok := setting.EffectiveDefaultReceiver(channels); ok {
			view.Enabled = true
			view.EffectiveSource = RouteReceiverSourceExplicit
			view.EffectiveReceiverName = name
		} else {
			view.EffectiveSource = RouteReceiverSourceNone
		}
		return view, nil
	}
	if len(channels) > 0 {
		// LoadEnabledNotifyChannels 已按 id 升序，取第一个即「已启用渠道第一个」。
		view.EffectiveSource = RouteReceiverSourceAutoFirstEnabled
		view.EffectiveReceiverName = channels[0].ReceiverName()
		return view, nil
	}
	view.EffectiveSource = RouteReceiverSourceNone
	return view, nil
}

// PutRouteSetting 写入默认接收人设定与 route 段作者模式（T08-F12）：
//   - channelID 为 nil = 关闭接管（护栏③）；非 nil 时校验目标渠道存在且已启用；
//   - mode 为 route 段作者模式：空串归一为 handwritten；非 handwritten/managed 视为非法。
// 任一校验失败返回对应错误，不写入。
func PutRouteSetting(db *gorm.DB, channelID *uint, mode models.RouteMode) error {
	if mode == "" {
		mode = models.RouteModeHandwritten
	}
	if mode != models.RouteModeHandwritten && mode != models.RouteModeManaged {
		return ErrRouteSettingModeInvalid
	}
	if channelID != nil {
		channels, err := generator.LoadEnabledNotifyChannels(db)
		if err != nil {
			return err
		}
		available := false
		for i := range channels {
			if channels[i].ID == *channelID {
				available = true
				break
			}
		}
		if !available {
			return ErrRouteSettingChannelUnavailable
		}
	}
	return saveRouteSetting(db, channelID, mode)
}

// saveRouteSetting 按管理域单例（default）写入或更新设定行（含模式）。
func saveRouteSetting(db *gorm.DB, channelID *uint, mode models.RouteMode) error {
	var s models.AlertmanagerRouteSetting
	err := db.Where("network_domain_id = ?", models.DefaultDomainID).First(&s).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if err := db.Create(&models.AlertmanagerRouteSetting{
			NetworkDomainID:          models.DefaultDomainID,
			DefaultReceiverChannelID: channelID,
			Mode:                     mode,
		}).Error; err != nil {
			return fmt.Errorf("create alertmanager route setting: %w", err)
		}
		return nil
	}
	if err != nil {
		return fmt.Errorf("load alertmanager route setting: %w", err)
	}
	s.DefaultReceiverChannelID = channelID
	s.Mode = mode
	if err := db.Save(&s).Error; err != nil {
		return fmt.Errorf("update alertmanager route setting: %w", err)
	}
	return nil
}

// GetRouteSettingHandler 处理 GET /api/v2/platform/alertmanager/route-setting（全局认证）。
func GetRouteSettingHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		view, err := GetRouteSetting(db)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, view)
	}
}

// PutRouteSettingHandler 处理 PUT /api/v2/platform/alertmanager/route-setting（RequireAdmin）：
//
//	body: { default_receiver_channel_id: number|null }
//
// 写入后与挂载同构（Q4）——触发 M09 管理域变更重算 + 自动确认下发 + AM reload，端到端一次
// 生效；两步失败仅记录日志（沿用 config.submitValidated 的降级语义：收录已成功，由稳态
// watcher / 人工确认兜底重试）。响应**不含下发状态**（决策 60 冻结），仅返回最新生效视图。
func PutRouteSettingHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			DefaultReceiverChannelID *uint              `json:"default_receiver_channel_id"`
			Mode                      models.RouteMode  `json:"mode"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("解析请求体失败: %w", err))
			return
		}

		if err := PutRouteSetting(db, req.DefaultReceiverChannelID, req.Mode); err != nil {
			if errors.Is(err, ErrRouteSettingChannelUnavailable) || errors.Is(err, ErrRouteSettingModeInvalid) {
				response.BadRequest(c, err)
				return
			}
			response.InternalServerError(c, err)
			return
		}

		// 与挂载同构闭环：触发变更检测 → 自动确认下发（AM reload）。失败仅记日志、不报错。
		if err := triggerChangeDetection(db); err != nil {
			log.Printf("[alertmanager-route] trigger change detect failed: %v", err)
		}
		if err := autoApplyManagementDomain(db, auth.CurrentUsername(c)); err != nil {
			log.Printf("[alertmanager-route] auto-apply management domain failed: %v", err)
		}

		view, err := GetRouteSetting(db)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, view)
	}
}
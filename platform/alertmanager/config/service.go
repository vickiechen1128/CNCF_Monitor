// Package config 实现 Module_08 告警配置（alertmanager.yml）文件挂载服务：
// 校验（amtool check-config 等价）+ 版本留痕落库 + 触发 M09 管理域变更检测。
// 参见 docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md
//   §5.1（文件挂载契约）/ §6.6 / §9.1 / §9.2；design-decisions.md 决策 59/60。
package config

import (
	"errors"
	"fmt"
	"log"
	"strings"

	"github.com/metriccenter/metriccenter/platform/configcenter/change"
	"github.com/metriccenter/metriccenter/platform/configcenter/draft"
	"github.com/metriccenter/metriccenter/platform/configcenter/generator"
	"github.com/metriccenter/metriccenter/platform/domainregistry"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// ErrEmptyContent 表示挂载内容为空（契约 §7：content 必填，空内容 bad_request）。
var ErrEmptyContent = errors.New("alertmanager.yml content is required")

// ErrValidation 表示校验失败（行级错误集合）。校验失败不落库、不进 M09 流水线
// （决策 60），由 handler 映射为 bad_request，data 形如 { items, note, cause }（契约 §3）。
// Cause 归因（决策 45-3 复用）：user_config=用户配置问题（可改）；
// platform_fault=平台校验工具未就绪（如 amtool 缺失 / 崩溃，用户不可修、待运维就绪后重校）。
type ErrValidation struct {
	Items []models.ValidateErrorItem
	Note  string
	Cause models.ValidationCause
}

// Error 返回首条行级错误，便于日志与通用错误透传；无错误项时返回通用文案。
func (e *ErrValidation) Error() string {
	if len(e.Items) == 0 {
		return "alertmanager config validation failed"
	}
	return e.Items[0].Message
}

// triggerChangeDetection 触发 M09 变更检测：挂载留痕把 alertmanager.yml 写回源数据
// 后，主动跑一轮管理域变更检测，使 M09 下一轮 configgen 纳入 alertmanager.yml 产物
// （决策 60 / T09-60-1）。稳态路径是 pull 30s watcher；此处为「挂载即感知」的即时触发，
// 失败不阻断挂载（watcher 下一轮会兜底重试）。默认实现在测试中可注入替换。
//
// 管理域（中心直连域）不再预置，必须按 domain_type 动态解析：未登记时返回
// domainregistry.ErrManagementDomainNotRegistered，由 handler 映射为可操作提示。
var triggerChangeDetection = func(db *gorm.DB) error {
	domainID, err := domainregistry.ManagementDomainID(db)
	if err != nil {
		return err
	}
	return change.ProcessDomain(db, domainID)
}

// TriggerChangeDetection 是对私有 triggerChangeDetection 的导出包装（T08-11 路由设定写
// 路径复用）：暴露「触发管理域 default 变更检测」工序，供同 M08 的 route 包（设定读写 API
// 写后与挂载同构）调用，避免把私有变量直接暴露为跨包依赖。默认实现在测试中可注入替换
// （经 config 包测试覆盖；route 包测试以自己的可注入包装指向本函数）。
func TriggerChangeDetection(db *gorm.DB) error {
	return triggerChangeDetection(db)
}

// EnsurePendingDraft 是对私有 ensurePendingDraft 的导出包装（T08-11 路由设定写路径复用）：
// 暴露「确保管理域 default 有活pending 变更单（生成/复用/取代）、但不确认下发」工序，
// 供 route 包在兜底接收人写路径后调用，避免另起一套（口径同挂载路径，见 ensurePendingDraft
// 注释中「为什么必须显式生成」）。
func EnsurePendingDraft(db *gorm.DB) error {
	return ensurePendingDraft(db)
}

// ensurePendingDraft 确保管理域 default 有一张活pending 变更单（无则生成、产物已变则取代旧单），
// **但不确认下发**——生效一律由用户在 M09「配置变更确认」页人工 ConfirmDraft。
//
// 为什么必须显式生成（2026-10-09 实测修复）：变更检测链路change.ProcessDomain 依赖
// generator.SourceDataVersion 的版本推进，而 sourceTableScopes **不含
// AlertmanagerConfigVersion**（提交告警配置不会推进源数据版本）→ ProcessDomain 视
// "源数据无变化"直接跳过、**永远不会为告警配置变更产出草稿**。上一轮移除自动确认闭环时
// 连带删掉了原有的自动闭环入口，其内部 GenerateDraft 的"产草稿"职责无人接手，导致
// 「提交后 M09 连 pending 单都没有」。故此处显式补GenerateDraft，保住「提交 → 产 pending
// 草稿 → 人工确认 → 写盘reload」的两段式。
//
// 同域 pending 保活/取代口径与 watcher 一致（决策 42-1 / 44-2）：已有活 pending 时比较
// 当前产物 checksum（ShouldSupersedePending），不同则生成新单取代旧单，相同则复用旧单。
var ensurePendingDraft = generateOrReusePendingDraft

func generateOrReusePendingDraft(db *gorm.DB) error {
	domainID, err := domainregistry.ManagementDomainID(db)
	if err != nil {
		return err
	}
	live, err := draft.LatestLivePending(db, domainID)
	if err != nil {
		return err
	}
	if live != nil {
		dom, dErr := generator.LoadDomain(db, domainID)
		if dErr != nil {
			return dErr
		}
		supersede, sErr := draft.ShouldSupersedePending(db, dom, live)
		if sErr != nil {
			return sErr
		}
		if supersede {
			_, gErr := draft.GenerateDraft(db, domainID)
			return gErr
		}
		return nil // 产物无变化，复用既有 live pending
	}
	_, gErr := draft.GenerateDraft(db, domainID)
	return gErr
}

// Submit 提交挂载一份 alertmanager.yml：
//
//   - 空内容 → ErrEmptyContent（bad_request）；
//   - 先 amtool check-config 等价校验，失败返回 *ErrValidation，不落库、不进 M09
//     （决策 60）；amtool 不可调用同样视为校验失败并在 dev-feedback 登记；
//   - 校验通过：计算 sha256 写入 AlertmanagerConfigVersion（content/checksum/status=applied）
//     留痕（决策 59 内容留痕），并触发 M09 管理域变更检测（决策 60）；
//   - 同 checksum 重复挂载幂等：已存在相同内容版本时直接返回已有版本，不重复生成。
func Submit(db *gorm.DB, content, uploadedBy string) (*models.AlertmanagerConfigVersion, error) {
	if strings.TrimSpace(content) == "" {
		return nil, ErrEmptyContent
	}
	checksum := models.AlertmanagerConfigChecksum(content)

	// 幂等：已有相同内容已留痕，直接返回该版本，不重复生成（MVP 保留版本历史供回滚）。
	existing, err := findVersionByChecksum(db, checksum)
	if err != nil {
		return nil, fmt.Errorf("check existing config version: %w", err)
	}
	if existing != nil {
		return existing, nil
	}

	return submitValidated(db, content, checksum, uploadedBy)
}

// Remount 将历史版本内容重新挂载提交（P0 回滚动线，决策 59）：复用校验工序，
// **总是写入新版本并重新触发 M09 变更检测**，即便该内容校验和此前已留痕。
// 返回新写入的版本；校验失败返回 *ErrValidation（不落库）。
func Remount(db *gorm.DB, content, uploadedBy string) (*models.AlertmanagerConfigVersion, error) {
	if strings.TrimSpace(content) == "" {
		return nil, ErrEmptyContent
	}
	checksum := models.AlertmanagerConfigChecksum(content)
	return submitValidated(db, content, checksum, uploadedBy)
}

// submitValidated 执行校验→落库→触发变更检测的共同工序。调用方已保证 content 非空。
func submitValidated(db *gorm.DB, content, checksum, uploadedBy string) (*models.AlertmanagerConfigVersion, error) {
	// alertmanager.yml 恒属管理域（决策 60）：中心直连域未登记时没有归属域，
	// 直接拒绝而不是写一条永远无法生成变更单的版本。
	if _, err := domainregistry.ManagementDomain(db); err != nil {
		return nil, err
	}

	// 校验失败不落库（决策 60）。
	if err := validateAlertmanagerConfig(content); err != nil {
		return nil, err
	}

	v := &models.AlertmanagerConfigVersion{
		Content:   content,
		Checksum:  checksum,
		Status:    models.AlertmanagerConfigStatusApplied,
		AppliedBy: uploadedBy,
	}
	if err := db.Create(v).Error; err != nil {
		return nil, fmt.Errorf("persist alertmanager config version: %w", err)
	}

	// 触发 M09 管理域（default）变更检测；失败仅记录、不阻断挂载
	// （persist 已成功，稳态 watcher 下一轮也会兜底重试检测）。
	if err := triggerChangeDetection(db); err != nil {
		return v, errChangeTrigger
	}

	// 2026-10-09 用户裁决（立场 1，关闭自动闭环）：**不再自动确认草稿**。
	// 原 dev-feedback §25 方案 A 在此处调 autoApplyManagementDomain 自动 GenerateDraft +
	// ConfirmDraft，使「提交」直接写盘 + AM reload 生效；实测导致路由结构调整在用户
	// 未复核的情况下自动上线（高危：改错即告警丢失/风暴），且与前端「待变更单确认下发」
	// 的文案自相矛盾——文案要用户去 M09 确认，M09 却已被系统自己确认掉、待确认视图里
	// 根本查不到该单。
	//
	// 现改为两段式：提交只负责「收录为 M09 源数据 + **产出 pending 草稿**」，生效一律由
	// 用户在 M09「配置变更确认」页人工确认（ConfirmDraft → 写盘 + AM reload）。
	// 必须显式调 ensurePendingDraft 而非只靠 triggerChangeDetection —— 后者因
	// sourceTableScopes 不含 AlertmanagerConfigVersion 而永远不会为此变更产草稿（详见
	// ensurePendingDraft 注释）。草稿保活/取代口径不变（决策 42-1 / 44-2）。
	//
	// ErrNoChanges（产物与上一生效版本无实质差异，如幂等重复提交）不是失败：沿用既有
	// pending 状态即可，不报错、不阻断挂载。
	if err := ensurePendingDraft(db); err != nil && !errors.Is(err, draft.ErrNoChanges) {
		log.Printf("[alertmanager-config] persist ok but generate pending draft failed: %v", err)
	}
	return v, nil
}

// errChangeTrigger 是触发 M09 变更检测失败的哨兵错误：挂载已成功留痕，仅提示
// 变更检测触发异常（可由稳态 watcher 下一轮兜底），handler 据此记录日志而非报错。
var errChangeTrigger = errors.New("persist ok but trigger change detection failed (watcher will retry)")

// errAutoApply 是自动闭环（生成/确认管理域 default 草稿并下发）失败的哨兵错误：M08 收录
// 已成功留痕，仅自动下发异常（草稿生成失败 / 校验未过 / confirm 失败等）。与
// errChangeTrigger 同款降级语义——handler 记录日志而非报错，由稳态 watcher 下一轮或
// 人工确认兜底重试（dev-feedback §25 方案 A 幂等/降级口径）。
//
// 2026-10-09（立场 1，关闭自动闭环）：submitValidated 已不再返回本哨兵（自动确认已移除），
// 此处保留定义与 handler 降级分支作为防御——若将来重新引入自动确认路径，handler 已能
// 正确降级而非误报 500。
var errAutoApply = errors.New("persist ok but auto-apply management domain config failed (watcher or manual confirm will retry)")

// findVersionByChecksum 按校验和查询已留痕版本；无则返回 (nil, nil)。
// 仅认 status=applied 的留痕（dev-feedback #44）：discarded 是废弃终态（其变更单已废弃、
// 无活单可确认），**不满足幂等语义**——否则用户重新导入同样内容会被幂等分支静默返回
// 已废弃版本、既不产新版本也不产新变更单，恢复路径（重新挂载/重新导入）被吞掉。
func findVersionByChecksum(db *gorm.DB, checksum string) (*models.AlertmanagerConfigVersion, error) {
	var v models.AlertmanagerConfigVersion
	err := db.Where("checksum = ? AND status = ?", checksum, models.AlertmanagerConfigStatusApplied).First(&v).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

// LatestApplied 返回最近一条 applied 留痕版本（当前生效配置）；无则 (nil, nil)。
// 供「当前生效只读视图」与版本历史排序复用（T08-03）。
// dev-feedback #44：排除 discarded 终态——已废弃留痕的内容不在磁盘上，不得作为
// 「当前生效」呈现（其恢复路径是重新挂载/重新导入，见 findVersionByChecksum）。
func LatestApplied(db *gorm.DB) (*models.AlertmanagerConfigVersion, error) {
	var v models.AlertmanagerConfigVersion
	err := db.Where("status = ?", models.AlertmanagerConfigStatusApplied).
		Order("created_at DESC, id DESC").First(&v).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

// GetVersionByID 按版本 ID 查询完整留痕版本（含 content 只读视图）；无则 (nil, nil)。
// 供版本详情与重新挂载（remount）复用（T08-03）。
func GetVersionByID(db *gorm.DB, id uint) (*models.AlertmanagerConfigVersion, error) {
	if id == 0 {
		return nil, nil
	}
	var v models.AlertmanagerConfigVersion
	err := db.First(&v, id).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}
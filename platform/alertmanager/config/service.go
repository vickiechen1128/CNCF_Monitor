// Package config 实现 Module_08 告警配置（alertmanager.yml）文件挂载服务：
// 校验（amtool check-config 等价）+ 版本留痕落库 + 触发 M09 管理域变更检测。
// 参见 docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md
//   §5.1（文件挂载契约）/ §6.6 / §9.1 / §9.2；design-decisions.md 决策 59/60。
package config

import (
	"errors"
	"fmt"
	"strings"

	"github.com/metriccenter/metriccenter/platform/configcenter/change"
	"github.com/metriccenter/metriccenter/platform/configcenter/draft"
	"github.com/metriccenter/metriccenter/platform/configcenter/generator"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// ErrEmptyContent 表示挂载内容为空（契约 §7：content 必填，空内容 bad_request）。
var ErrEmptyContent = errors.New("alertmanager.yml content is required")

// ErrValidation 表示校验失败（行级错误集合）。校验失败不落库、不进 M09 流水线
// （决策 60），由 handler 映射为 bad_request，data 形如 { items, note }（契约 §3）。
type ErrValidation struct {
	Items []models.ValidateErrorItem
	Note  string
}

// Error 返回首条行级错误，便于日志与通用错误透传；无错误项时返回通用文案。
func (e *ErrValidation) Error() string {
	if len(e.Items) == 0 {
		return "alertmanager config validation failed"
	}
	return e.Items[0].Message
}

// managementDomainID 是 alertmanager.yml 归属的管理域（default）scope 网域（决策 60）：
// 变更单恒为该管理域，不参与按网域扇出、不进 agent_pull 配置包。可注入便于测试。
var managementDomainID = models.DefaultDomainID

// triggerChangeDetection 触发 M09 变更检测：挂载留痕把 alertmanager.yml 写回源数据
// 后，主动跑一轮管理域变更检测，使 M09 下一轮 configgen 纳入 alertmanager.yml 产物
// （决策 60 / T09-60-1）。稳态路径是 pull 30s watcher；此处为「挂载即感知」的即时触发，
// 失败不阻断挂载（watcher 下一轮会兜底重试）。默认实现在测试中可注入替换。
var triggerChangeDetection = func(db *gorm.DB) error {
	return change.ProcessDomain(db, managementDomainID)
}

// autoApplyManagementDomain 是「生成/复用管理域 default 的 pending 草稿并确认下发」的
// 可注入工序（dev-feedback §25 方案 A）。M08 apply 仅收录源数据 + 触发 M09 变更检测时
// 只会产出一张 pending 草稿、**永不自动确认**，磁盘上的 alertmanager.yml 仍是旧的，AM
// 实际未加载新配置。此工序在触发检测后自动闭环到 confirm → 落盘 + AM reload，使 M08 一次
// apply 端到端生效。默认实现在测试中可注入替换（风格同 triggerChangeDetection）。
var autoApplyManagementDomain = func(db *gorm.DB, by string) error {
	return applyManagementDomainConfig(db, by)
}

// applyManagementDomainConfig 对管理域 default 生成/复用一张 pending 草稿并确认下发：
//
//   - 已有活 pending：按 watcher.go 的 ShouldSupersedePending 口径判断是否需要重新生成
//     （supersede=true 时 GenerateDraft 取新单并取代旧单，否则复用既有 live.ChangeNo），
//     与 30s 轮询 change watcher 的裁决一致，规避「已有活 pending」竞态导致的重复生成；
//   - 无活 pending：GenerateDraft 生成新单；ErrNoChanges（无实质变更，决策 44-3）视为
//     无需下发、返回 nil；其他错误返回；
//   - 最终 ConfirmDraft(changeNo, by) → 走既有 confirm 下发链路（DiskApplier 写
//     alertmanager.yml + AM reload），由 deployment.writebackAlertmanagerApplied 回填
//     applied_at/source_change_no。管理域为 local 直发通道（决策 31-M2），自动应用合规。
//
// 任一步失败均原样返回错误，由调用方（submitValidated）转成哨兵 errAutoApply 降级——
// 收录已成功，不下发失败不得让 M08 submit 报错。
func applyManagementDomainConfig(db *gorm.DB, by string) error {
	changeNo := ""
	live, err := draft.LatestLivePending(db, managementDomainID)
	if err != nil {
		return err
	}
	if live != nil {
		// 参考 change/watcher.go 的保活/取代口径：产物变化则取新单取代旧单，否则复用旧单。
		dom, dErr := generator.LoadDomain(db, managementDomainID)
		if dErr != nil {
			return dErr
		}
		supersede, sErr := draft.ShouldSupersedePending(db, dom, live)
		if sErr != nil {
			return sErr
		}
		if supersede {
			d, gErr := draft.GenerateDraft(db, managementDomainID)
			if gErr != nil {
				if errors.Is(gErr, draft.ErrNoChanges) {
					return nil
				}
				return gErr
			}
			changeNo = d.ChangeNo
		} else {
			changeNo = live.ChangeNo
		}
	} else {
		d, gErr := draft.GenerateDraft(db, managementDomainID)
		if gErr != nil {
			if errors.Is(gErr, draft.ErrNoChanges) {
				return nil
			}
			return gErr
		}
		changeNo = d.ChangeNo
	}
	if changeNo == "" {
		return nil
	}
	_, err = draft.ConfirmDraft(db, changeNo, by)
	return err
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

	// dev-feedback §25 方案 A：自动闭环——触发检测只产 pending 草稿、永不自动确认，
	// 磁盘 alertmanager.yml 仍是旧的。此处对管理域 default 生成/复用 pending 草稿并确认
	// 下发（confirm → DiskApplier 写盘 + AM reload），使 M08 一次 apply 端到端生效。
	// 失败不阻断挂载（收录已成功），按 errChangeTrigger 同款降级返回哨兵 errAutoApply：
	// handler 仅记日志，由稳态 watcher / 人工确认兜底。Submit/Remount 均经本工序。
	if err := autoApplyManagementDomain(db, uploadedBy); err != nil {
		return v, errAutoApply
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
var errAutoApply = errors.New("persist ok but auto-apply management domain config failed (watcher or manual confirm will retry)")

// findVersionByChecksum 按校验和查询已留痕版本；无则返回 (nil, nil)。
func findVersionByChecksum(db *gorm.DB, checksum string) (*models.AlertmanagerConfigVersion, error) {
	var v models.AlertmanagerConfigVersion
	err := db.Where("checksum = ?", checksum).First(&v).Error
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
func LatestApplied(db *gorm.DB) (*models.AlertmanagerConfigVersion, error) {
	var v models.AlertmanagerConfigVersion
	err := db.Order("created_at DESC, id DESC").First(&v).Error
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
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
	return v, nil
}

// errChangeTrigger 是触发 M09 变更检测失败的哨兵错误：挂载已成功留痕，仅提示
// 变更检测触发异常（可由稳态 watcher 下一轮兜底），handler 据此记录日志而非报错。
var errChangeTrigger = errors.New("persist ok but trigger change detection failed (watcher will retry)")

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
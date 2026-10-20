package draft

import (
	"encoding/json"
	"errors"

	"github.com/metriccenter/metriccenter/platform/configcenter/generator"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// 系统初始化空配置（bootstrap）标识。空平台部署边缘 agent 时，网域尚无任何
// ConfigVersion，agent 永远拉不到 prometheus.yml，采集器无法启动。这里在 agent
// 首次心跳时补一份合法的零 Job 配置版本，使节点以「空运行」状态正常起来；
// 后续真实配置确认下发后自然覆盖。
const (
	// BootstrapConfirmedBy 写入 ConfigDraft.ConfirmedBy，作为系统自动确认的审计标识。
	BootstrapConfirmedBy = "system:bootstrap"
	// BootstrapSummary 是引导草稿的摘要，同时用于识别重试时复用的引导草稿。
	BootstrapSummary = "系统初始化空配置（当前网域暂无采集任务）"
)

// EnsureBootstrapVersion 为尚无任何 ConfigVersion 的 agent_pull 网域生成并确认
// 一份零 Job 的空配置版本（prometheus.yml 含 `scrape_configs: []`）。
//
// 幂等：已有任意 ConfigVersion 时返回 (nil, nil)；同一域并发调用由 lockDomain 串行化。
// 只对「已纳管（IsMonitored）+ 非禁用 + agent_pull」网域生效，与 M09 GenerateDraft
// 的准入条件保持一致。返回 nil 版本表示无需引导。
func EnsureBootstrapVersion(db *gorm.DB, domainID string) (*models.ConfigVersion, error) {
	defer lockDomain(domainID)()

	dom, err := generator.LoadDomain(db, domainID)
	if err != nil {
		return nil, err
	}
	if !dom.IsMonitored ||
		dom.Status == models.DomainStatusDisabled ||
		dom.Channel != models.ChannelTypeAgentPull {
		return nil, nil
	}

	// 锁内二次确认：已有正式版本则无需引导。
	var existing models.ConfigVersion
	err = db.Where("network_domain_id = ?", domainID).
		Order("created_at DESC, id DESC").First(&existing).Error
	if err == nil {
		return nil, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	// 上一次引导已建单但确认失败（如 DB 瞬时异常）时，复用该 pending 单重试，
	// 避免每轮心跳重复堆积引导草稿。
	var pending models.ConfigDraft
	err = db.Where("network_domain_id = ? AND status = ? AND summary = ?",
		domainID, models.DraftStatusPending, BootstrapSummary).First(&pending).Error
	if err == nil {
		return ConfirmDraft(db, pending.ChangeNo, BootstrapConfirmedBy)
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	// 复用正式生成链路：零 Job → global.external_labels + scrape_configs: []。
	artifacts, _, _, err := buildArtifacts(db, dom)
	if err != nil {
		return nil, err
	}
	sourceVersion, err := generator.SourceDataVersion(db, domainID)
	if err != nil {
		return nil, err
	}
	targetsJSON, err := json.Marshal(artifacts.TargetsFiles)
	if err != nil {
		return nil, err
	}
	metaJSON, err := json.Marshal(models.ConfigDraftMetadata{
		SourceDataVersion: sourceVersion,
		TriggerSummary:    "系统初始化空配置",
		Checksum:          artifacts.Checksum(),
		GeneratorVersion:  generator.GeneratorVersion,
	})
	if err != nil {
		return nil, err
	}
	changeNo, err := nextChangeNo(db)
	if err != nil {
		return nil, err
	}

	d := &models.ConfigDraft{
		NetworkDomainID:   domainID,
		ChangeNo:          changeNo,
		PrometheusYml:     artifacts.PrometheusYML,
		RulesYml:          artifacts.RulesYML,
		BlackboxYml:       artifacts.BlackboxYML,
		AlertmanagerYml:   artifacts.AlertmanagerYML,
		TargetsFiles:      string(targetsJSON),
		Metadata:          string(metaJSON),
		Summary:           BootstrapSummary,
		ChangeItems:       "[]",
		Status:            models.DraftStatusPending,
		ValidationStatus:  string(models.ValidationStatusPassed),
		ValidationMessage: "系统初始化空配置，无需人工校验",
		ValidationDetails: "[]",
	}
	if err := db.Create(d).Error; err != nil {
		return nil, err
	}

	version, err := ConfirmDraft(db, d.ChangeNo, BootstrapConfirmedBy)
	if err != nil {
		// 确认失败时清掉引导草稿，避免它作为活 pending 阻塞后续真实草稿生成；
		// 下一轮心跳会重新引导。软删除保留审计痕迹。
		_ = db.Delete(d).Error
		return nil, err
	}
	return version, nil
}

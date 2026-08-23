package scrapejob

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// io 常量：下拉所需已纳管网域的校验与默认实例选择方式。
const (
	defaultInstanceSelection = models.InstanceSelectionManual
)

// validateJobRequest 校验 ScrapeJob 创建/更新请求的基础业务规则
// （api-contract-snapshot §5/§10 决策31）：
//   - network_domain_id 必填且 is_monitored=true 且 status=enabled（冻结 bad_request）
//   - monitor_type ∈ ValidMonitorTypes（standard）
//   - 认证TLS：basic→username+password 必填；bearer→token 必填；password/token 仅存储
//   - blackbox：blackbox_module 必填 + blackbox_targets 非空且 protocol ∈ 限定集；
//     monitor_type / exporter_template_id 置空
//   - instance_selection_mode 默认 manual
func validateJobRequest(db *gorm.DB, job *models.ScrapeJob) error {
	if strings.TrimSpace(job.JobName) == "" {
		return fmt.Errorf("job_name 不能为空")
	}
	if job.NetworkDomainID == "" {
		return fmt.Errorf("network_domain_id 必填（须为已纳管且非冻结的网域）")
	}
	if err := validateNetworkDomain(db, job.NetworkDomainID); err != nil {
		return err
	}
	if job.InstanceSelectionMode == "" {
		job.InstanceSelectionMode = defaultInstanceSelection
	}
	if job.JobType != models.JobTypeStandard && job.JobType != models.JobTypeBlackbox {
		return fmt.Errorf("job_type 非法，可选 standard/blackbox")
	}

	switch job.JobType {
	case models.JobTypeBlackbox:
		// blackbox：不绑定 monitor_type / exporter；必须配置 blackbox 拨测字段。
		job.MonitorType = ""
		job.ExporterTemplateID = ""
		if strings.TrimSpace(job.BlackboxModule) == "" {
			return fmt.Errorf("job_type=blackbox 时 blackbox_module 必填")
		}
		if len(job.BlackboxTargets) == 0 {
			return fmt.Errorf("job_type=blackbox 时 blackbox_targets 不能为空")
		}
		for _, t := range job.BlackboxTargets {
			if strings.TrimSpace(t.Target) == "" {
				return fmt.Errorf("blackbox_targets 中 target 必填")
			}
			if !models.ValidBlackboxTargetProtocol(string(t.Protocol)) {
				return fmt.Errorf("blackbox target 协议 %q 非法，可选 http/https/tcp/icmp/dns", t.Protocol)
			}
		}
	default:
		// standard：monitor_type 合法、采集参数必填。
		if !models.ValidMonitorType(job.MonitorType) {
			return fmt.Errorf("monitor_type %q 非法", job.MonitorType)
		}
		if strings.TrimSpace(job.ScrapeInterval) == "" || strings.TrimSpace(job.ScrapeTimeout) == "" {
			return fmt.Errorf("standard 任务 scrape_interval/scrape_timeout 必填")
		}
		if strings.TrimSpace(job.MetricsPath) == "" || strings.TrimSpace(job.Scheme) == "" {
			return fmt.Errorf("standard 任务 metrics_path/scheme 必填")
		}
	}

	// 认证TLS（决策31）。
	switch job.AuthType {
	case models.AuthTypeNone:
		// 无认证：清除遗留的认证字段，避免残留明文。
		job.Username = ""
		job.Password = ""
		job.Token = ""
	case models.AuthTypeBasic:
		if strings.TrimSpace(job.Username) == "" || strings.TrimSpace(job.Password) == "" {
			return fmt.Errorf("auth_type=basic 时 username 与 password 必填")
		}
		job.Token = ""
	case models.AuthTypeBearer:
		if strings.TrimSpace(job.Token) == "" {
			return fmt.Errorf("auth_type=bearer 时 token 必填")
		}
		job.Username = ""
		job.Password = ""
	default:
		job.AuthType = models.AuthTypeNone
	}

	// 已选实例须属于同一网域（非同域 bad_request）。
	if err := validateSelectedInstancesDomain(db, job); err != nil {
		return err
	}
	return nil
}

// validateNetworkDomain 校验网域已纳管且非冻结：is_monitored=true 且 status=enabled
// （用户决策，Module_01 §5.4 / §10）。
func validateNetworkDomain(db *gorm.DB, domainID string) error {
	var domain models.NetworkDomain
	if err := db.First(&domain, "id = ?", domainID).Error; err != nil {
		return fmt.Errorf("network_domain_id %q 不存在", domainID)
	}
	if !domain.IsMonitored {
		return fmt.Errorf("网域 %q 未纳管（is_monitored=false），禁止创建采集任务", domainID)
	}
	if domain.Status != models.DomainStatusEnabled {
		return fmt.Errorf("网域 %q 已冻结（status=%s），禁止创建采集任务", domainID, domain.Status)
	}
	return nil
}

// validateSelectedInstancesDomain 校验 job.SelectedInstanceIDs 均属于 job 的网域
// （非同域 bad_request）。空选择集（手填 exporter 场景）直接通过。
func validateSelectedInstancesDomain(db *gorm.DB, job *models.ScrapeJob) error {
	if len(job.SelectedInstanceIDs) == 0 {
		return nil
	}
	for _, id := range job.SelectedInstanceIDs {
		ok, err := resourceInDomain(db, id, job.NetworkDomainID)
		if err != nil {
			return err
		}
		if !ok {
			return fmt.Errorf("实例 %q 不属于网域 %q", id, job.NetworkDomainID)
		}
	}
	return nil
}

// resourceInDomain 报告 resourceID 资源是否存在于指定网域（host/database/
// middleware/application/generic_target 五类任一命中）。
func resourceInDomain(db *gorm.DB, resourceID, domainID string) (bool, error) {
	checks := []struct {
		model interface{}
	}{
		{&models.Host{}},
		{&models.Database{}},
		{&models.Middleware{}},
		{&models.Application{}},
		{&models.GenericTarget{}},
	}
	for _, c := range checks {
		var count int64
		if err := db.Model(c.model).
			Where("resource_id = ? AND network_domain_id = ?", resourceID, domainID).
			Count(&count).Error; err != nil {
			return false, fmt.Errorf("check resource %q in domain: %w", resourceID, err)
		}
		if count > 0 {
			return true, nil
		}
	}
	return false, nil
}

// inheritDefaultsFromMapping 从 CITypeExporterMapping（该 monitor_type 的
// is_default）继承采集参数作为快照预填：scrape_interval/scrape_timeout/
// metrics_path/scheme/label_template_id。调用方已保证 job.MonitorType 合法。
// 返回是否找到默认映射（未找到时保留字段原值）。
func inheritDefaultsFromMapping(db *gorm.DB, job *models.ScrapeJob) {
	if job.JobType == models.JobTypeBlackbox {
		return
	}
	var m models.CITypeExporterMapping
	err := db.Where("monitor_type = ? AND is_default = ?", job.MonitorType, true).
		First(&m).Error
	if err != nil {
		return // 无默认映射：保留调用方传入/手填值
	}
	if job.ScrapeInterval == "" {
		job.ScrapeInterval = m.ScrapeInterval
	}
	if job.ScrapeTimeout == "" {
		job.ScrapeTimeout = m.ScrapeTimeout
	}
	if job.MetricsPath == "" {
		job.MetricsPath = m.MetricsPath
	}
	if job.Scheme == "" {
		job.Scheme = m.Scheme
	}
	if job.LabelTemplateID == "" {
		job.LabelTemplateID = m.LabelTemplateID
	}
}

// exporterExists 校验 exporter_template_id（存 ID 字符串）对应采集器存在；
// 非空且非法/不存在返回错误。
func exporterExists(db *gorm.DB, exporterTemplateID string) error {
	if exporterTemplateID == "" {
		return nil // 手填 exporter 场景允许空
	}
	id, err := strconv.ParseUint(exporterTemplateID, 10, 64)
	if err != nil || id == 0 {
		return fmt.Errorf("exporter_template_id %q 非法", exporterTemplateID)
	}
	var tmpl models.ExporterTemplate
	if err := db.First(&tmpl, id).Error; err != nil {
		return fmt.Errorf("exporter_template_id %s 不存在", exporterTemplateID)
	}
	return nil
}
// Package draft implements Module_09 配置草稿服务（config-draft service）：
// 手动触发生成配置草稿、列表 / 详情、确认（生成 ConfigVersion）、废弃、重校验，
// 以及同域至多一张活 pending 的保活约束（决策 42-1）。
// 契约以 docs/05-execution-records/module-09/api-contract-snapshot.md §4 为准。
package draft

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/metriccenter/metriccenter/platform/configcenter/deployment"
	"github.com/metriccenter/metriccenter/platform/configcenter/generator"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// 服务层 sentinel 错误，handler 据此映射 HTTP errorType。
var (
	ErrNotFound          = errors.New("config draft not found")
	ErrDomainNotFound    = errors.New("network domain not found")
	ErrDomainNotMonitored = errors.New("network domain is not monitored")
	ErrDomainFrozen      = errors.New("network domain is frozen (disabled), no new change may be generated")
	ErrNotPending        = errors.New("config draft is not pending")
	ErrValidationNotPassed = errors.New("draft validation has not passed; revalidate or discard instead")
	ErrValidationStillFailed = errors.New("draft validation still failed")
)

// GenerateDraft 手动触发生成一条配置草稿（POST /api/v2/platform/config/drafts）。
//
// 约束（PRD §3.4 / 决策 42-1）：
//   - 网域须已纳管（is_monitored）且非冻结（status=enabled）；
//   - 同域至多一张「活 pending」：已存在时直接返回该草稿（不重复生成）。
//
// 产物经 generator 组装后计算联合 checksum 与变更清单，写入 ConfigDraft 并对
// 中心内容做下发前校验（promtool 不可调用返回 pending，决策 42-2）。
func GenerateDraft(db *gorm.DB, domainID string) (*models.ConfigDraft, error) {
	dom, err := generator.LoadDomain(db, domainID)
	if err != nil {
		var nf generator.ErrNotFound
		if errors.As(err, &nf) {
			return nil, ErrDomainNotFound
		}
		return nil, err
	}
	if !dom.IsMonitored {
		return nil, ErrDomainNotMonitored
	}
	if dom.Status == models.DomainStatusDisabled {
		return nil, ErrDomainFrozen
	}

	// 同域活 pending 保活：已存在直接返回。
	if existing, err := latestLivePending(db, domainID); err != nil {
		return nil, err
	} else if existing != nil {
		return existing, nil
	}

	artifacts, err := buildArtifacts(db, dom)
	if err != nil {
		return nil, err
	}

	sourceVersion, err := generator.SourceDataVersion(db, domainID)
	if err != nil {
		return nil, err
	}

	jobs, _ := generator.LoadJobs(db, domainID)
	rules, _ := generator.LoadRules(db)
	items := buildChangeItems(jobs, rules)
	checksum := artifacts.Checksum()
	validation, vMsg := generator.ValidateArtifacts(artifacts, artifacts.BlackboxYML != "")

	meta := models.ConfigDraftMetadata{
		SourceDataVersion: sourceVersion,
		TriggerSummary:    "手动触发生成",
		Checksum:          checksum,
		GeneratorVersion:  generator.GeneratorVersion,
	}
	metaJSON, err := json.Marshal(meta)
	if err != nil {
		return nil, fmt.Errorf("marshal draft metadata: %w", err)
	}
	targetsJSON, err := json.Marshal(artifacts.TargetsFiles)
	if err != nil {
		return nil, fmt.Errorf("marshal targets files: %w", err)
	}
	itemsJSON, err := json.Marshal(items)
	if err != nil {
		return nil, fmt.Errorf("marshal change items: %w", err)
	}

	changeNo, err := nextChangeNo(db)
	if err != nil {
		return nil, err
	}
	_ = vMsg // 校验说明已反映在 validation 状态（MVP 不单独落库）

	draft := &models.ConfigDraft{
		NetworkDomainID:  domainID,
		ChangeNo:         changeNo,
		PrometheusYml:    artifacts.PrometheusYML,
		RulesYml:         artifacts.RulesYML,
		BlackboxYml:      artifacts.BlackboxYML,
		TargetsFiles:     string(targetsJSON),
		Metadata:         string(metaJSON),
		Summary:          buildSummary(items),
		ChangeItems:      string(itemsJSON),
		Status:           models.DraftStatusPending,
		ValidationStatus: string(validation),
	}
	if err := db.Create(draft).Error; err != nil {
		return nil, fmt.Errorf("create config draft: %w", err)
	}
	return draft, nil
}

// buildArtifacts 聚合网域源数据并组装配置产物（jobs 目标解析 + rules 透传）。
func buildArtifacts(db *gorm.DB, dom *models.NetworkDomain) (*generator.ConfigArtifacts, error) {
	jobs, err := generator.LoadJobs(db, dom.ID)
	if err != nil {
		return nil, err
	}
	rules, err := generator.LoadRules(db)
	if err != nil {
		return nil, err
	}

	jobBuilds := make([]generator.JobBuild, 0, len(jobs))
	for _, job := range jobs {
		tmpl, err := generator.LoadDefaultTemplate(db, models.ResourceCategory(job.ResourceType))
		if err != nil {
			return nil, err
		}
		targets, err := generator.ResolveJobTargets(db, job, tmpl)
		if err != nil {
			return nil, err
		}
		jobBuilds = append(jobBuilds, generator.JobBuild{Job: job, Targets: targets})
	}

	// replica 无独立数据源，MVP 不注入（external_labels 仅 network_domain_id/zone_type）。
	artifacts, err := generator.Assemble(dom.ID, dom.ZoneType, "", jobBuilds, rules)
	if err != nil {
		return nil, err
	}
	return artifacts, nil
}

// latestLivePending 返回某网域最新的活 pending 草稿（无则 nil）。
func latestLivePending(db *gorm.DB, domainID string) (*models.ConfigDraft, error) {
	var d models.ConfigDraft
	err := db.Where("network_domain_id = ? AND status = ?", domainID, models.DraftStatusPending).
		Order("created_at desc").First(&d).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load latest pending draft: %w", err)
	}
	return &d, nil
}

// buildChangeItems 依据参与生成的 jobs / rules 生成结构化变更清单。
// 规则：删除目标 / 告警规则变更 = high，新增采集 Job / 目标 = low（契约 §8）。
func buildChangeItems(jobs []models.ScrapeJob, rules []models.MonitoringRule) []models.ConfigChangeItem {
	items := make([]models.ConfigChangeItem, 0, len(jobs)+len(rules))
	for i, job := range jobs {
		aFiles := []string{string(models.AffectedFilePrometheus), string(models.AffectedFileTargets)}
		if job.JobType == models.JobTypeBlackbox {
			aFiles = append(aFiles, string(models.AffectedFileBlackbox))
		}
		items = append(items, models.ConfigChangeItem{
			ID:            fmt.Sprintf("ci-%d", i+1),
			Type:          string(models.ChangeItemTypeAdd),
			Target:        string(models.ChangeItemTargetScrapeJob),
			Description:   "新增采集 Job " + job.JobName,
			AffectedFiles: aFiles,
			Risk:          string(models.RiskLow),
		})
	}
	for i, r := range rules {
		items = append(items, models.ConfigChangeItem{
			ID:            fmt.Sprintf("ci-job-%d", i+1),
			Type:          string(models.ChangeItemTypeAdd),
			Target:        string(models.ChangeItemTargetMonitoringRule),
			Description:   "新增告警/记录规则 " + jobNameOr(r.Name, fmt.Sprintf("rule-%d", i+1)),
			AffectedFiles: []string{string(models.AffectedFileRules)},
			Risk:          string(models.RiskHigh),
		})
	}
	return items
}

// jobNameOr 返回非空名称，否则回退默认名。
func jobNameOr(name, fallback string) string {
	if name != "" {
		return name
	}
	return fallback
}

// highRisk reports whether any change item is high risk.
func highRisk(items []models.ConfigChangeItem) bool {
	for _, it := range items {
		if it.Risk == string(models.RiskHigh) {
			return true
		}
	}
	return false
}

// computeRisk 返回变更清单的最高风险等级。
func computeRisk(items []models.ConfigChangeItem) string {
	if highRisk(items) {
		return string(models.RiskHigh)
	}
	return string(models.RiskLow)
}

// affectedFiles 收集变更清单涉及的全部配置文件并去重排序。
func affectedFiles(items []models.ConfigChangeItem) []string {
	set := map[string]struct{}{}
	for _, it := range items {
		for _, f := range it.AffectedFiles {
			set[f] = struct{}{}
		}
	}
	out := make([]string, 0, len(set))
	for f := range set {
		out = append(out, f)
	}
	sort.Strings(out)
	return out
}

// buildSummary 生成人话变更摘要（PRD §9.1）。
func buildSummary(items []models.ConfigChangeItem) string {
	if len(items) == 0 {
		return "本次无配置变更"
	}
	jobN, ruleN := 0, 0
	for _, it := range items {
		switch it.Target {
		case string(models.ChangeItemTargetScrapeJob):
			jobN++
		case string(models.ChangeItemTargetMonitoringRule):
			ruleN++
		}
	}
	parts := []string{}
	if jobN > 0 {
		parts = append(parts, fmt.Sprintf("采集 Job %d 个", jobN))
	}
	if ruleN > 0 {
		parts = append(parts, fmt.Sprintf("告警规则 %d 条", ruleN))
	}
	if len(parts) == 0 {
		parts = append(parts, fmt.Sprintf("变更项 %d 个", len(items)))
	}
	return "本次配置变更涉及 " + join(parts, "、")
}

// join 拼接字符串切片（避免引入额外依赖）。
func join(parts []string, sep string) string {
	s := ""
	for i, p := range parts {
		if i > 0 {
			s += sep
		}
		s += p
	}
	return s
}

// nextChangeNo 生成全局唯一变更单号 CHG-YYYYMMDD-NNN（当日自增）。
func nextChangeNo(db *gorm.DB) (string, error) {
	prefix := "CHG-" + time.Now().Format("20060102") + "-"
	var last models.ConfigDraft
	err := db.Where("change_no LIKE ?", prefix+"%").Order("change_no desc").First(&last).Error
	seq := 1
	if err == nil {
		var n int
		if _, scanErr := fmt.Sscanf(last.ChangeNo, prefix+"%d", &n); scanErr == nil {
			seq = n + 1
		}
	} else if err != gorm.ErrRecordNotFound {
		return "", fmt.Errorf("query latest change_no: %w", err)
	}
	return fmt.Sprintf("%s%03d", prefix, seq), nil
}

// ListDrafts 分页列出某网域的配置草稿（network_domain_id 必填，契约 §4）。
// status 为空或 all 时不筛选；只返回 draft 主要列表字段。
func ListDrafts(db *gorm.DB, domainID, status string, page, pageSize int) ([]models.ConfigDraft, int64, error) {
	if domainID == "" {
		return nil, 0, ErrDomainNotFound
	}
	q := db.Model(&models.ConfigDraft{}).Where("network_domain_id = ?", domainID)
	switch {
	case status == "" || status == "all":
	case models.DraftStatus(status) == models.DraftStatusPending:
		q = q.Where("status = ?", models.DraftStatusPending)
	case models.DraftStatus(status) == models.DraftStatusConfirmed:
		q = q.Where("status = ?", models.DraftStatusConfirmed)
	case models.DraftStatus(status) == models.DraftStatusDiscarded:
		q = q.Where("status = ?", models.DraftStatusDiscarded)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count config drafts: %w", err)
	}
	var drafts []models.ConfigDraft
	if err := q.Order("created_at desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&drafts).Error; err != nil {
		return nil, 0, fmt.Errorf("list config drafts: %w", err)
	}
	return drafts, total, nil
}

// GetDraftDetail 按变更单号取草稿详情（含完整产物）。
func GetDraftDetail(db *gorm.DB, changeNo string) (*models.ConfigDraft, error) {
	var d models.ConfigDraft
	if err := db.Where("change_no = ?", changeNo).First(&d).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get config draft %s: %w", changeNo, err)
	}
	return &d, nil
}

// ConfirmDraft 确认一张 pending + validation=passed 的草稿：生成 ConfigVersion 并将
// 草稿置为 confirmed，随后触发 local 下发（confirm → deployments 记录，T09-06）。
// 契约 §4；writeback change_status 见 deployment.Dispatch（决策 31-M2）。
//
// MEDIUM-1 review-fix：create ConfigVersion / 置草稿 confirmed / 落下发记录收拢到
// 同一事务，任一步失败整体回滚（重试仍见 pending 草稿，不落「版本已建草稿已
// confirmed 却报 500」的部分提交死角）。
func ConfirmDraft(db *gorm.DB, changeNo, confirmedBy string) (*models.ConfigVersion, error) {
	d, err := GetDraftDetail(db, changeNo)
	if err != nil {
		return nil, err
	}
	if d.Status != models.DraftStatusPending {
		return nil, ErrNotPending
	}
	if d.ValidationStatus != string(models.ValidationStatusPassed) {
		return nil, ErrValidationNotPassed
	}

	var version *models.ConfigVersion
	if err := db.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		version = &models.ConfigVersion{
			NetworkDomainID: d.NetworkDomainID,
			DraftID:         fmt.Sprint(d.ID),
			ChangeNo:        d.ChangeNo,
			PrometheusYml:   d.PrometheusYml,
			RulesYml:        d.RulesYml,
			BlackboxYml:     d.BlackboxYml,
			TargetsFiles:    d.TargetsFiles,
			Metadata:        d.Metadata,
		}
		if err := tx.Create(version).Error; err != nil {
			return fmt.Errorf("create config version: %w", err)
		}

		updates := map[string]interface{}{
			"status":         models.DraftStatusConfirmed,
			"confirmed_by":   confirmedBy,
			"confirmed_at":   &now,
			"source_version": d.ChangeNo,
		}
		if err := tx.Model(d).Updates(updates).Error; err != nil {
			return fmt.Errorf("mark draft confirmed: %w", err)
		}
		// confirm 触发 local 下发（T09-06）：创建 ConfigDeployment 记录；local 通道写盘
		// reload 并回写 M01 change_status；agent_pull 通道登记占位（MVP）。
		// writeback 失败已在 deployment.Dispatch 内降级处理，不阻断本事务提交。
		if _, err := deployment.DeployConfirmedVersion(tx, version, confirmedBy); err != nil {
			return err
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return version, nil
}

// DiscardDraft 废弃一张 pending 草稿（支持校验失败态 failed 草稿）；
// 已非 pending 返回 bad_request。
func DiscardDraft(db *gorm.DB, changeNo string) (*models.ConfigDraft, error) {
	d, err := GetDraftDetail(db, changeNo)
	if err != nil {
		return nil, err
	}
	if d.Status != models.DraftStatusPending {
		return nil, ErrNotPending
	}
	d.Status = models.DraftStatusDiscarded
	if err := db.Model(d).Update("status", models.DraftStatusDiscarded).Error; err != nil {
		return nil, fmt.Errorf("discard config draft: %w", err)
	}
	return d, nil
}

// RevalidateDraft 重校一张 pending 草稿的中心内容校验（契约 §4 / 决策 42-2）：
//   - 重算后仍 failed → 返回 ErrValidationStillFailed（bad_request）；
//   - 通过 / pending → 更新 validation_status 并返回草稿。
func RevalidateDraft(db *gorm.DB, changeNo string) (*models.ConfigDraft, error) {
	d, err := GetDraftDetail(db, changeNo)
	if err != nil {
		return nil, err
	}
	if d.Status != models.DraftStatusPending {
		return nil, ErrNotPending
	}

	artifacts, err := artifactsFromDraft(d)
	if err != nil {
		return nil, err
	}
	validation, _ := generator.ValidateArtifacts(artifacts, artifacts.BlackboxYML != "")
	d.ValidationStatus = string(validation)
	if err := db.Model(d).Update("validation_status", d.ValidationStatus).Error; err != nil {
		return nil, fmt.Errorf("update draft validation_status: %w", err)
	}
	if validation == models.ValidationStatusFailed {
		return d, ErrValidationStillFailed
	}
	return d, nil
}

// artifactsFromDraft 回溯草稿已存产物为 generator.ConfigArtifacts（用于重校验）。
func artifactsFromDraft(d *models.ConfigDraft) (*generator.ConfigArtifacts, error) {
	targets := map[string]string{}
	if d.TargetsFiles != "" {
		if err := json.Unmarshal([]byte(d.TargetsFiles), &targets); err != nil {
			return nil, fmt.Errorf("parse draft targets_files: %w", err)
		}
	}
	return &generator.ConfigArtifacts{
		PrometheusYML: d.PrometheusYml,
		RulesYML:      d.RulesYml,
		BlackboxYML:   d.BlackboxYml,
		TargetsFiles:  targets,
	}, nil
}
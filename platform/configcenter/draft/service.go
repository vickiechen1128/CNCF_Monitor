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
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/configcenter/deployment"
	"github.com/metriccenter/metriccenter/platform/configcenter/generator"
	"github.com/metriccenter/metriccenter/platform/models"
	"gopkg.in/yaml.v3"
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
	// ErrNoChanges 表示当前源数据产物无任何变更项（如无 ready job/rule），
	// 且该网域从未产生已生效版本；用于抑制「配置无变化」的噪声变更单（决策 44-3）。
	ErrNoChanges = errors.New("no config changes to generate")
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

	// MEDIUM-2 review-fix：jobs/rules 复用聚合产物的一次加载（buildArtifacts 已上抛
	// 加载错误），不再二次查询并吞错（原 `jobs, _ :=` / `rules, _ :=` 会在 DB 瞬时
	// 失败时静默生成空草稿可 passed→confirm 下发空配置）。
	artifacts, jobs, rules, err := buildArtifacts(db, dom)
	if err != nil {
		return nil, err
	}

	// 同域活 pending 保活 / 取代（决策 42-1）：
	// 若已有 pending 草稿，基于当前源数据全量重算产物；checksum 相同则幂等返回，
	// 不同则生成新 pending 并将旧单置 discarded（metadata 互记 supersede 关系）。
	existing, err := latestLivePending(db, domainID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return reconcileWithExistingPending(db, existing, artifacts, jobs, rules)
	}

	sourceVersion, err := generator.SourceDataVersion(db, domainID)
	if err != nil {
		return nil, err
	}

	items := buildChangeItems(jobs, rules)
	checksum := artifacts.Checksum()
	validation, cause, details, vMsg := generator.ValidateArtifacts(artifacts, artifacts.BlackboxYML != "")

	// 决策 44-3：抑制「配置无变化」的噪声变更单。
	// 无任何变更项且该网域从未产生已生效版本时，不生成草稿，直接返回 ErrNoChanges。
	if len(items) == 0 {
		baseVersion, err := lastConfirmedVersion(db, domainID)
		if err != nil {
			return nil, err
		}
		if baseVersion == nil {
			return nil, ErrNoChanges
		}
	}

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
	detailsJSON, err := json.Marshal(details)
	if err != nil {
		return nil, fmt.Errorf("marshal validation details: %w", err)
	}

	changeNo, err := nextChangeNo(db)
	if err != nil {
		return nil, err
	}

	// T09-05 review-fix：source_version 回填为该网域「上一已确认 ConfigVersion」的
	// change_no（契约 §4 语义「基于哪个 ConfigVersion」，供版本对比 Tab 拉基线版本）。
	// 无历史版本保持空，前端据此显示「无历史版本可对比」。
	baseVersion, err := lastConfirmedVersion(db, domainID)
	if err != nil {
		return nil, err
	}
	sourceVersionRef := ""
	if baseVersion != nil {
		sourceVersionRef = baseVersion.ChangeNo
	}

	draft := &models.ConfigDraft{
		NetworkDomainID:  domainID,
		ChangeNo:         changeNo,
		SourceVersion:    sourceVersionRef,
		PrometheusYml:    artifacts.PrometheusYML,
		RulesYml:         artifacts.RulesYML,
		BlackboxYml:      artifacts.BlackboxYML,
		TargetsFiles:     string(targetsJSON),
		Metadata:         string(metaJSON),
		Summary:          buildSummary(items),
		ChangeItems:      string(itemsJSON),
		Status:            models.DraftStatusPending,
		ValidationStatus:  string(validation),
		ValidationMessage: vMsg,
		ValidationCause:   string(cause),
		ValidationDetails: string(detailsJSON),
	}
	if err := db.Create(draft).Error; err != nil {
		return nil, fmt.Errorf("create config draft: %w", err)
	}
	return draft, nil
}

// buildArtifacts 聚合网域源数据并组装配置产物（jobs 目标解析 + rules 透传）。
// 同时返回参与生成的 jobs/rules，供上层构建变更清单复用（MEDIUM-2），避免二次查询。
func buildArtifacts(db *gorm.DB, dom *models.NetworkDomain) (*generator.ConfigArtifacts, []models.ScrapeJob, []models.MonitoringRule, error) {
	jobs, err := generator.LoadJobs(db, dom.ID)
	if err != nil {
		return nil, nil, nil, err
	}
	rules, err := generator.LoadRules(db)
	if err != nil {
		return nil, nil, nil, err
	}

	jobBuilds := make([]generator.JobBuild, 0, len(jobs))
	for _, job := range jobs {
		tmpl, err := generator.LoadTemplateForJob(db, job)
		if err != nil {
			return nil, nil, nil, err
		}
		targets, err := generator.ResolveJobTargets(db, job, tmpl)
		if err != nil {
			return nil, nil, nil, err
		}
		jobBuilds = append(jobBuilds, generator.JobBuild{Job: job, Targets: targets})
	}

	// replica 无独立数据源，MVP 不注入（external_labels 仅 network_domain_id/zone_type）。
	artifacts, err := generator.Assemble(dom.ID, dom.ZoneType, "", jobBuilds, rules)
	if err != nil {
		return nil, nil, nil, err
	}
	return artifacts, jobs, rules, nil
}

// LatestLivePending 返回某网域最新活 pending 草稿（无则 nil）。供 M09 自动变更检测
// 轮询（configcenter/change 包）复用保活口径判断「该域是否已有待确认变更单」：
// 已有活 pending 时跳过本轮（等用户处理），避免重复生成，与决策 42-1 对齐。
func LatestLivePending(db *gorm.DB, domainID string) (*models.ConfigDraft, error) {
	return latestLivePending(db, domainID)
}

// ShouldSupersedePending 判断当前源数据产物 checksum 是否与已有 pending 草稿不同。
// 供 watcher 在 skipped_pending 分支决定是否取代旧单（决策 44-2）：不同则返回 true，
// 调用方应继续 GenerateDraft 生成新 pending 并取代旧单；相同或出错则返回 false。
func ShouldSupersedePending(db *gorm.DB, dom *models.NetworkDomain, pending *models.ConfigDraft) (bool, error) {
	artifacts, _, _, err := buildArtifacts(db, dom)
	if err != nil {
		return false, err
	}
	currentChecksum := artifacts.Checksum()

	var existingMeta models.ConfigDraftMetadata
	if err := json.Unmarshal([]byte(pending.Metadata), &existingMeta); err != nil {
		// metadata 损坏/为空，按「有实质差异」处理。
		return true, nil
	}
	return currentChecksum != existingMeta.Checksum, nil
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

// reconcileWithExistingPending 在已有活 pending 草稿时，基于当前源数据产物做保活/取代裁决。
// checksum 与旧草稿相同 → 返回旧草稿（幂等）；不同 → 生成新 pending 并将旧单置 discarded，
// 两者 metadata 互记 supersede 关系。
func reconcileWithExistingPending(
	db *gorm.DB,
	existing *models.ConfigDraft,
	artifacts *generator.ConfigArtifacts,
	jobs []models.ScrapeJob,
	rules []models.MonitoringRule,
) (*models.ConfigDraft, error) {
	currentChecksum := artifacts.Checksum()

	var existingMeta models.ConfigDraftMetadata
	if err := json.Unmarshal([]byte(existing.Metadata), &existingMeta); err != nil {
		// 旧草稿 metadata 损坏/为空，按「有实质差异」处理并继续生成新单。
		existingMeta = models.ConfigDraftMetadata{}
	}

	if currentChecksum == existingMeta.Checksum && currentChecksum != "" {
		// 产物无实质变化：幂等返回旧草稿，不生成噪声。
		return existing, nil
	}

	// 产物有变化：生成新 pending 并取代旧单。
	sourceVersion, err := generator.SourceDataVersion(db, existing.NetworkDomainID)
	if err != nil {
		return nil, err
	}

	items := buildChangeItems(jobs, rules)
	validation, cause, details, vMsg := generator.ValidateArtifacts(artifacts, artifacts.BlackboxYML != "")

	changeNo, err := nextChangeNo(db)
	if err != nil {
		return nil, err
	}

	baseVersion, err := lastConfirmedVersion(db, existing.NetworkDomainID)
	if err != nil {
		return nil, err
	}
	sourceVersionRef := ""
	if baseVersion != nil {
		sourceVersionRef = baseVersion.ChangeNo
	}

	newMeta := models.ConfigDraftMetadata{
		SourceDataVersion:    sourceVersion,
		TriggerSummary:       "源数据变更自动取代待确认草稿",
		Checksum:             currentChecksum,
		GeneratorVersion:     generator.GeneratorVersion,
		SupersedesChangeNo:   existing.ChangeNo,
	}
	newMetaJSON, err := json.Marshal(newMeta)
	if err != nil {
		return nil, fmt.Errorf("marshal new draft metadata: %w", err)
	}
	targetsJSON, err := json.Marshal(artifacts.TargetsFiles)
	if err != nil {
		return nil, fmt.Errorf("marshal targets files: %w", err)
	}
	itemsJSON, err := json.Marshal(items)
	if err != nil {
		return nil, fmt.Errorf("marshal change items: %w", err)
	}
	detailsJSON, err := json.Marshal(details)
	if err != nil {
		return nil, fmt.Errorf("marshal validation details: %w", err)
	}

	newDraft := &models.ConfigDraft{
		NetworkDomainID:   existing.NetworkDomainID,
		ChangeNo:          changeNo,
		SourceVersion:     sourceVersionRef,
		PrometheusYml:     artifacts.PrometheusYML,
		RulesYml:          artifacts.RulesYML,
		BlackboxYml:       artifacts.BlackboxYML,
		TargetsFiles:      string(targetsJSON),
		Metadata:          string(newMetaJSON),
		Summary:           buildSummary(items),
		ChangeItems:       string(itemsJSON),
		Status:            models.DraftStatusPending,
		ValidationStatus:  string(validation),
		ValidationMessage: vMsg,
		ValidationCause:   string(cause),
		ValidationDetails: string(detailsJSON),
	}

	// 更新旧草稿 metadata（superseded_by）并置 discarded；同时创建新草稿。
	err = db.Transaction(func(tx *gorm.DB) error {
		existingMeta.SupersededByChangeNo = newDraft.ChangeNo
		updatedMetaJSON, mErr := json.Marshal(existingMeta)
		if mErr != nil {
			return fmt.Errorf("marshal superseded metadata: %w", mErr)
		}
		if err := tx.Model(existing).Updates(map[string]interface{}{
			"status":   models.DraftStatusDiscarded,
			"metadata": string(updatedMetaJSON),
		}).Error; err != nil {
			return fmt.Errorf("mark existing draft discarded: %w", err)
		}
		if err := tx.Create(newDraft).Error; err != nil {
			return fmt.Errorf("create superseding draft: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return newDraft, nil
}

// lastConfirmedVersion 返回某网域最近一次 confirm 生成的 ConfigVersion（按 created_at
// 倒序取最新一条）；无历史版本返回 nil。用于 GenerateDraft 回填 source_version。
func lastConfirmedVersion(db *gorm.DB, domainID string) (*models.ConfigVersion, error) {
	var v models.ConfigVersion
	err := db.Where("network_domain_id = ?", domainID).Order("created_at desc").First(&v).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load last confirmed config version: %w", err)
	}
	return &v, nil
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

// ListDrafts 分页列出配置草稿（契约 §4 / 前端「全部网域」选项：network_domain_id 为空时列出全部网域，
// 不为空时按网域过滤；与 deployment 列表语义一致，避免默认态/「全部网域」报错）。
// status 为空或 all 时不筛选；只返回 draft 主要列表字段。
func ListDrafts(db *gorm.DB, domainID, status string, page, pageSize int) ([]models.ConfigDraft, int64, error) {
	q := db.Model(&models.ConfigDraft{})
	if domainID != "" {
		q = q.Where("network_domain_id = ?", domainID)
	}
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
			"status":       models.DraftStatusConfirmed,
			"confirmed_by": confirmedBy,
			"confirmed_at": &now,
			// T09-05 review-fix：不再覆盖 source_version。它已在 GenerateDraft 时回填为
			// 上一已确认 ConfigVersion 的 change_no（旧实现误置为草稿自身 change_no，
			// 导致版本对比 Tab 拉基线版本不命中 diff 降级）。确认不应改变该基线指向。
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

// DiscardImpact 描述废弃一张配置变更单后对源数据（当前仅 ScrapeJob）的影响统计，
// 用于前端二次确认弹窗分类告知（决策 43-7）。
type DiscardImpact struct {
	NewReverted     int `json:"new_reverted"`      // 新建未生效 job 回退 draft
	ModifiedKept    int `json:"modified_kept"`     // 已生效 job 的修改保留
	DeletedRestored int `json:"deleted_restored"`  // 删除/停用/草稿化的已生效 job 被恢复
	Missing         int `json:"missing"`           // 生效版本中存在但 DB 中已无记录
}

// DiscardDraft 废弃一张 pending 草稿（支持校验失败态 failed 草稿）；
// 已非 pending 返回 bad_request。
//
// 废弃必须伴随源数据处理：full-render 模型下「只改变更单状态、不处理源数据」
// 会导致被废弃的差异在下一轮全量渲染中复现（鬼影）。分类处理规则（决策 43 系列）：
//   - 新建且从未生效的 job：回退 draft_status=draft，change_status=none；
//   - 已生效 job 的修改：保留修改值，change_status=deployed（MVP 不自动回滚，弹窗已告知）；
//   - 已生效 job 的删除/停用/草稿化：恢复（undelete + enabled + ready），change_status=deployed。
func DiscardDraft(db *gorm.DB, changeNo string) (*models.ConfigDraft, *DiscardImpact, error) {
	d, err := GetDraftDetail(db, changeNo)
	if err != nil {
		return nil, nil, err
	}
	if d.Status != models.DraftStatusPending {
		return nil, nil, ErrNotPending
	}

	impact, err := computeDiscardImpact(db, d)
	if err != nil {
		return nil, nil, err
	}
	liveJobNames, err := jobNamesFromLiveVersion(db, d)
	if err != nil {
		return nil, nil, err
	}

	var jobs []models.ScrapeJob
	if err := db.Unscoped().Where("network_domain_id = ?", d.NetworkDomainID).Find(&jobs).Error; err != nil {
		return nil, nil, fmt.Errorf("load domain jobs for discard: %w", err)
	}

	now := time.Now()
	err = db.Transaction(func(tx *gorm.DB) error {
		for i := range jobs {
			j := &jobs[i]
			wasLive := liveJobNames[j.JobName]
			isLiveNow := !j.DeletedAt.Valid && j.Enabled && j.DraftStatus == "ready"
			updates := map[string]interface{}{"updated_at": now}
			switch {
			case !isLiveNow && wasLive:
				// 删除/停用/草稿化的已生效 job：恢复为生效态。
				updates["deleted_at"] = gorm.Expr("NULL")
				updates["enabled"] = true
				updates["draft_status"] = "ready"
				updates["change_status"] = string(models.ChangeStatusDeployed)
			case isLiveNow && !wasLive:
				// 新建未生效 job：回退 draft。
				updates["draft_status"] = "draft"
				updates["change_status"] = string(models.ChangeStatusNone)
			case isLiveNow && wasLive:
				// 已生效 job 的修改：保留修改，清除 pending。
				updates["change_status"] = string(models.ChangeStatusDeployed)
			default:
				// 从未参与生效的草稿/已删 job：无需处理。
				continue
			}
			// 使用 Unscoped：被软删的 job 需要恢复，且需要把 deleted_at 真正置 NULL。
			if err := tx.Unscoped().Model(j).Updates(updates).Error; err != nil {
				return fmt.Errorf("update job %d on discard: %w", j.ID, err)
			}
		}
		if err := tx.Model(d).Update("status", models.DraftStatusDiscarded).Error; err != nil {
			return fmt.Errorf("discard config draft: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	d.Status = models.DraftStatusDiscarded
	return d, impact, nil
}

// GetDiscardImpact 在真正废弃前计算影响面（GET /config-drafts/:change_no/discard-impact）。
func GetDiscardImpact(db *gorm.DB, changeNo string) (*DiscardImpact, error) {
	d, err := GetDraftDetail(db, changeNo)
	if err != nil {
		return nil, err
	}
	if d.Status != models.DraftStatusPending {
		return nil, ErrNotPending
	}
	return computeDiscardImpact(db, d)
}

// computeDiscardImpact 基于当前 DB 源数据与上一生效版本产物，统计废弃后的分类影响。
// 当前仅处理 ScrapeJob；MonitoringRule 的自动回滚待 v0.3 deployed_snapshot 后扩展。
func computeDiscardImpact(db *gorm.DB, d *models.ConfigDraft) (*DiscardImpact, error) {
	var jobs []models.ScrapeJob
	if err := db.Unscoped().Where("network_domain_id = ?", d.NetworkDomainID).Find(&jobs).Error; err != nil {
		return nil, fmt.Errorf("load domain jobs: %w", err)
	}
	liveJobNames, err := jobNamesFromLiveVersion(db, d)
	if err != nil {
		return nil, err
	}

	impact := &DiscardImpact{}
	currentNames := make(map[string]bool, len(jobs))
	for _, j := range jobs {
		currentNames[j.JobName] = true
		wasLive := liveJobNames[j.JobName]
		isLiveNow := !j.DeletedAt.Valid && j.Enabled && j.DraftStatus == "ready"
		switch {
		case !isLiveNow && wasLive:
			impact.DeletedRestored++
		case isLiveNow && !wasLive:
			impact.NewReverted++
		case isLiveNow && wasLive:
			impact.ModifiedKept++
		}
	}
	for name := range liveJobNames {
		if !currentNames[name] {
			impact.Missing++
		}
	}
	return impact, nil
}

// jobNamesFromLiveVersion 从变更单对应的上一个生效 ConfigVersion 产物中解析 job_name 集合。
func jobNamesFromLiveVersion(db *gorm.DB, d *models.ConfigDraft) (map[string]bool, error) {
	out := make(map[string]bool)
	if d.SourceVersion == "" {
		return out, nil
	}
	var v models.ConfigVersion
	if err := db.Where("change_no = ?", d.SourceVersion).First(&v).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return out, nil
		}
		return nil, fmt.Errorf("load source version %q: %w", d.SourceVersion, err)
	}
	return scrapeJobNamesFromPrometheusYml(v.PrometheusYml)
}

// scrapeJobNamesFromPrometheusYml 从 prometheus.yml 内容中提取 scrape_configs[].job_name。
func scrapeJobNamesFromPrometheusYml(yml string) (map[string]bool, error) {
	out := make(map[string]bool)
	if strings.TrimSpace(yml) == "" {
		return out, nil
	}
	var cfg struct {
		ScrapeConfigs []struct {
			JobName string `yaml:"job_name"`
		} `yaml:"scrape_configs"`
	}
	if err := yaml.Unmarshal([]byte(yml), &cfg); err != nil {
		return nil, fmt.Errorf("parse prometheus yml: %w", err)
	}
	for _, sc := range cfg.ScrapeConfigs {
		if sc.JobName != "" {
			out[sc.JobName] = true
		}
	}
	return out, nil
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
	validation, cause, details, vMsg := generator.ValidateArtifacts(artifacts, artifacts.BlackboxYML != "")
	detailsJSON, err := json.Marshal(details)
	if err != nil {
		return nil, fmt.Errorf("marshal validation details: %w", err)
	}
	d.ValidationStatus = string(validation)
	d.ValidationMessage = vMsg
	d.ValidationCause = string(cause)
	d.ValidationDetails = string(detailsJSON)
	if err := db.Model(d).Updates(map[string]interface{}{
		"validation_status":   d.ValidationStatus,
		"validation_message":  d.ValidationMessage,
		"validation_cause":    d.ValidationCause,
		"validation_details":  d.ValidationDetails,
	}).Error; err != nil {
		return nil, fmt.Errorf("update draft validation: %w", err)
	}
	if validation == models.ValidationStatusFailed {
		return d, fmt.Errorf("%w: %s", ErrValidationStillFailed, vMsg)
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
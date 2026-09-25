// Package generator implements Module_09 配置生成器：按网域组装
// prometheus.yml / rules.yml / blackbox.yml 与 targets/*.json 配置产物，
// 并配合校验（validate.go）与变更检测（change_detect.go）产出配置草稿。
// 参见 docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md
//   §3.3 配置生成服务 / §3.3.1 external_labels / §3.3.3 变更检测 / §3.5.1 下发前校验。
package generator

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
)

// GeneratorVersion 标识配置生成器版本（写入 ConfigDraft metadata，供追溯）。
const GeneratorVersion = "0.1.0"

// ConfigArtifacts 是一次配置生成的可验证产物集合。
//
//	PrometheusYML   prometheus.yml 文本（global.external_labels + scrape_configs 骨架）
//	RulesYML        rules.yml 文本（scope=central yaml_passthrough 规则解析合并 groups 为单文档，可为空）
//	BlackboxYML     blackbox.yml 文本（存在 blackbox job 时生成，可为空）
//	TargetsFiles    targets/<job>.json → 文件内容（file_sd 目标）
//	AlertmanagerYML alertmanager.yml 文本（决策 60：仅管理域 default scope，无告警配置时为空）
type ConfigArtifacts struct {
	PrometheusYML   string
	RulesYML        string
	BlackboxYML     string
	TargetsFiles    map[string]string
	AlertmanagerYML string
	// TargetDiagnostics 是生成期目标解析归因（C-1，config-sync-stall-and-empty-targets-guard
	// 设计提案 §3.1 / §3.2 判定点 2）：哪些 Job 的哪些实例未进入产物 targets 及原因。
	// **非产物字段**：不参与 Checksum()、不落盘、不 JSON 序列化、不进 metadata，
	// 仅用于生成侧校验（ValidateArtifacts）在命中空 targets 时给出资源级归因文案。
	// 无整体序列化 ConfigArtifacts 的路径（仅五个产物字段分别落库/拼接），
	// 若未来引入整体序列化必须显式加 json:"-"。
	TargetDiagnostics []TargetDiagnostics
}

// TargetDiagnostics 是单个 Job 在生成期的目标解析归因（非产物内容）。
type TargetDiagnostics struct {
	JobName  string
	FileName string // targets/<job>.json
	Skipped  []SkippedInstance
}

// anyOfflineOnly 判定某 Job 的归因是否「全部实例均为 offline 排除、且无任何地址类缺陷」。
// 用于文案区分：全部 offline 是设计预期的排除（决策 2：仍判 failed 阻断，但文案引导
// 「移除该 Job 或恢复实例」），与地址为空（用户配置缺陷，引导「补齐采集地址」）成因不同。
func (td TargetDiagnostics) anyOfflineOnly() bool {
	if len(td.Skipped) == 0 {
		return false
	}
	for _, s := range td.Skipped {
		if s.Reason != SkipReasonOffline {
			return false
		}
	}
	return true
}

// TargetGroup 是 file_sd 目标文件的单组目标（targets + labels）。
type TargetGroup struct {
	Targets []string          `json:"targets"`
	Labels  map[string]string `json:"labels"`
}

// boundaryLabelKeys 是 M09 会注入到 external_labels 的部署级标签集合。
// 仅注入 network_domain_id / zone_type / replica；不注入 tenant_id 与业务标签。
func buildExternalLabels(domainID, zoneType, replica string) map[string]string {
	labels := map[string]string{"network_domain_id": domainID}
	if zoneType != "" {
		labels["zone_type"] = zoneType
	}
	if replica != "" {
		labels["replica"] = replica
	}
	return labels
}

// Checksum 计算配置产物联合 checksum：
// sha256(prometheus.yml + rules_yml + blackbox_yml + alertmanager_yml + targets 内容按固定顺序拼接)，
// 缺失文件按空串处理（PRD §3.3.3 决策 42-4）。alertmanager.yml 内容参与联合裁决，
// 其内容变化即触发变更检测（决策 60 / T09-60-1）。
func (a *ConfigArtifacts) Checksum() string {
	type kv struct{ k, v string }
	sorted := make([]kv, 0, len(a.TargetsFiles))
	for k, v := range a.TargetsFiles {
		sorted = append(sorted, kv{k, v})
	}
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].k < sorted[j].k })

	var b strings.Builder
	b.WriteString(a.PrometheusYML)
	b.WriteString(a.RulesYML)
	b.WriteString(a.BlackboxYML)
	b.WriteString(a.AlertmanagerYML)
	for _, item := range sorted {
		b.WriteString(item.v)
	}
	sum := sha256.Sum256([]byte(b.String()))
	return hex.EncodeToString(sum[:])
}

// ArtifactsChanged 判定新产物与某生效版本 checksum 是否一致（一致视为无实质变化）。
func (a *ConfigArtifacts) ArtifactsChanged(activeChecksum string) bool {
	return activeChecksum == "" || a.Checksum() != activeChecksum
}

// NormalizeJobFilename 导出 normalizeJobFilename，供 draft 等包做 targets 文件 diff 时
// 按同一口径反查 job 对应的 targets 文件名。
func NormalizeJobFilename(jobName string) string {
	return normalizeJobFilename(jobName)
}

// normalizeJobFilename 将 job 名规范化为平台内部 targets 文件名（小写、非字母数字转 -）。
func normalizeJobFilename(jobName string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(jobName) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '_', r == '-':
			b.WriteRune(r)
		default:
			if b.Len() == 0 || b.String()[b.Len()-1] != '-' {
				b.WriteRune('-')
			}
		}
	}
	name := strings.Trim(b.String(), "-")
	if name == "" {
		name = "default"
	}
	return fmt.Sprintf("%s.json", name)
}
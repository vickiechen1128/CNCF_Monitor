package deployer

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/metriccenter/platform/edge-sync-agent/internal/contract"
)

// 校验策略说明：
//
// 理想情况下应使用 promtool check config/rules、blackbox_exporter --config.check
// 对解包产物做完整语义校验。但边缘目标机（隔离网域）不一定预装这些工具，SIGSTOP/
// 内网环境下也可能无法联网。因此默认提供 StructuralValidate 结构级 sanity 保底：
//   - targets/*.json：完整 JSON 结构 + targets/labels 合法性（encoding/json，可靠）；
//   - prometheus.yml / rules.yml / blackbox.yml：YAML 仅做「必填顶层键存在」的
//     轻量行式检查（当前零第三方依赖无法完整解析 YAML；若目标机可调用 promtool /
//     blackbox --config.check，可在 New 时注入更强的 Validator 替换本默认值）。
//
// 无论用哪种校验，失败路径统一回滚、保留上一份可运行配置（deployer.Apply 保证）。

// StructuralValidate 是默认结构校验器。
func StructuralValidate(pkg *Package) error {
	// prometheus.yml 必有 scrape_configs / rule_files 语义由 promtool 负责；此处
	// 仅要求含 scrape_configs 顶层键（缺失说明严重损坏，拒绝落盘）。
	if !hasLineKey(pkg.PrometheusYML, "scrape_configs") {
		return fmt.Errorf("deployer: prometheus.yml missing 'scrape_configs'")
	}
	// targets/*.json 逐文件结构校验（PRD §6.4 条目 3）。
	names := make([]string, 0, len(pkg.Targets))
	for n := range pkg.Targets {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		if err := ValidateTargetsJSON(n, pkg.Targets[n]); err != nil {
			return err
		}
	}
	// rules.yml 可选，含则要求 groups 顶层键。
	if strings.TrimSpace(pkg.RulesYML) != "" && !hasLineKey(pkg.RulesYML, "groups") {
		return fmt.Errorf("deployer: rules.yml missing 'groups'")
	}
	// blackbox.yml 可选，含则要求 modules 顶层键。
	if strings.TrimSpace(pkg.BlackboxYML) != "" && !hasLineKey(pkg.BlackboxYML, "modules") {
		return fmt.Errorf("deployer: blackbox.yml missing 'modules'")
	}
	return nil
}

// hasLineKey 做极简 YAML 顶层键存在性检查：找到「key:」开头的行即视为存在。
// 仅为无 promtool 时的结构 sanity，不追求 YAML 语义正确。
func hasLineKey(content, key string) bool {
	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, key+":") {
			return true
		}
	}
	return false
}

// marshalMetadata 将 metadata 序列化（对齐中心 zipper.go 字段序）。
func marshalMetadata(m *contract.Metadata) ([]byte, error) {
	b, err := json.Marshal(struct {
		ConfigVersion string `json:"config_version"`
		GeneratedAt   string `json:"generated_at"`
		AgentType     string `json:"agent_type"`
		Checksum      string `json:"checksum"`
	}{
		ConfigVersion: m.ConfigVersion,
		GeneratedAt:   m.GeneratedAt,
		AgentType:     m.AgentType,
		Checksum:      m.Checksum,
	})
	if err != nil {
		return nil, fmt.Errorf("deployer: marshal metadata: %w", err)
	}
	return append(b, '\n'), nil
}

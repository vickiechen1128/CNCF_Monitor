package edge

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
)

// metadata 是配置包中的 metadata.json 内容（PRD §6.3）。
type metadata struct {
	ConfigVersion string `json:"config_version"`
	GeneratedAt   string `json:"generated_at"`
	AgentType     string `json:"agent_type"`
	Checksum      string `json:"checksum"`
}

// targetsCarrier 与 ConfigVersion.TargetsFiles（JSON 载体 map[filename]content）对齐。
type targetsCarrier map[string]string

// BuildConfigZip 从网域最新 ConfigVersion 重建 edge 配置 zip（决策 D5：不新建
// config-output，直接从版本内容组装）。
//
// zip 结构对齐 PRD §6.3：
//
//	prometheus.yml      本域 scrape_configs（file_sd 引用 targets/）
//	targets/<job>.json  file_sd 目标文件（按 job 分文件，固定文件名覆盖写）
//	rules.yml           本域告警规则（非空才含）
//	blackbox.yml        本域 Blackbox 探测模块（可选，存在才含）
//	metadata.json       config_version / generated_at / agent_type / 联合 checksum
//
// 返回 (zip 字节, 联合 sha256)。联合 checksum 由包内容（prometheus+rules+blackbox+
// 各 targets 按固定序）计算，不含 metadata.json 自身，保证可复算一致。
func BuildConfigZip(v *models.ConfigVersion, agentType models.AgentType) ([]byte, string, error) {
	targets := targetsCarrier{}
	if v.TargetsFiles != "" {
		if err := json.Unmarshal([]byte(v.TargetsFiles), &targets); err != nil {
			return nil, "", fmt.Errorf("parse targets carrier: %w", err)
		}
	}

	zipMeta := metadata{
		ConfigVersion: configVersionString(v),
		GeneratedAt:   v.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
		AgentType:     string(agentType),
	}

	// 内容条目（metadata.json 之外的包内容顺序化，供 checksum 可复算）。
	type entry struct{ path, content string }
	entries := []entry{{"prometheus.yml", v.PrometheusYml}}
	if strings.TrimSpace(v.RulesYml) != "" {
		entries = append(entries, entry{"rules.yml", v.RulesYml})
	}
	if strings.TrimSpace(v.BlackboxYml) != "" {
		entries = append(entries, entry{"blackbox.yml", v.BlackboxYml})
	}
	fnames := make([]string, 0, len(targets))
	for name := range targets {
		fnames = append(fnames, name)
	}
	sort.Strings(fnames)
	targetEntries := make([]entry, 0, len(fnames))
	for _, name := range fnames {
		targetEntries = append(targetEntries, entry{"targets/" + name, targets[name]})
	}

	zipMeta.Checksum = packageChecksum(v.PrometheusYml, v.RulesYml, v.BlackboxYml, targets)

	metaJSON, err := json.Marshal(zipMeta)
	if err != nil {
		return nil, "", fmt.Errorf("marshal metadata.json: %w", err)
	}

	all := append(entries, targetEntries...)
	all = append(all, entry{path: "metadata.json", content: string(metaJSON)})

	buf := &bytes.Buffer{}
	zw := zip.NewWriter(buf)
	for _, e := range all {
		w, err := zw.Create(e.path)
		if err != nil {
			return nil, "", fmt.Errorf("create zip entry %s: %w", e.path, err)
		}
		if _, err := w.Write([]byte(e.content)); err != nil {
			return nil, "", fmt.Errorf("write zip entry %s: %w", e.path, err)
		}
	}
	if err := zw.Close(); err != nil {
		return nil, "", fmt.Errorf("close zip writer: %w", err)
	}
	return buf.Bytes(), zipMeta.Checksum, nil
}

// packageChecksum 计算配置包联合 sha256：prometheus.yml + rules.yml + blackbox.yml
// + 各 targets 内容按固定序拼接（与 generator.ConfigArtifacts.Checksum 同纪律），
// 不含 metadata.json（避免循环引用）。缺失文件按空串处理。
func packageChecksum(promYML, rulesYML, blackboxYML string, targets targetsCarrier) string {
	type kv struct{ k, v string }
	sorted := make([]kv, 0, len(targets))
	for k, v := range targets {
		sorted = append(sorted, kv{k, v})
	}
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].k < sorted[j].k })

	var b strings.Builder
	b.WriteString(promYML)
	b.WriteString(rulesYML)
	b.WriteString(blackboxYML)
	for _, item := range sorted {
		b.WriteString(item.v)
	}
	sum := sha256.Sum256([]byte(b.String()))
	return hex.EncodeToString(sum[:])
}

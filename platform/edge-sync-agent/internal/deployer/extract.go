// Package deployer 负责把已通过联合 checksum 校验的 edge 配置包（zip）结构校验后
// 原子落盘到本网域专属配置目录，并按需触发采集器 / 拨测器 reload（PRD §6.4）。
//
// 本包仅依赖 stdlib 与 internal 契约，零第三方 / 零控制面依赖。配置包 zip 已在
// puller 完成 metadata 联合 sha256 校验，本包只做结构校验（fallback）+ 原子切换
// + reload 触发，保证失败可回滚、幂等不重复落盘/reload。
package deployer

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/metriccenter/platform/edge-sync-agent/internal/contract"
)

// Package 是解包后的配置产物（PRD §6.3 的 zip 内容剥离 metadata 后的视图）。
type Package struct {
	PrometheusYML string
	RulesYML      string            // 可选（空表示不含）
	BlackboxYML   string            // 可选（空表示不含）
	Targets       map[string]string // key=targets 文件相对名（不含 targets/ 前缀），value=内容
	Metadata      *contract.Metadata
}

// extractPackage 把 zip 解包为 Package。prometheus.yml 缺失报错；
// targets/*.json 按文件名收敛；rules / blackbox 可选。metadata 由入参 meta 提供
// （调用方 puller 已解析校验），此处仅回填。
func extractPackage(zipBytes []byte, meta *contract.Metadata) (*Package, error) {
	zr, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		return nil, fmt.Errorf("deployer: open zip: %w", err)
	}
	pkg := &Package{
		Targets:  map[string]string{},
		Metadata: meta,
	}
	for _, f := range zr.File {
		if strings.HasSuffix(f.Name, "/") {
			continue
		}
		b, err := readEntry(f)
		if err != nil {
			return nil, fmt.Errorf("deployer: read %s: %w", f.Name, err)
		}
		switch {
		case f.Name == contract.ZipEntryPrometheus:
			pkg.PrometheusYML = string(b)
		case f.Name == contract.ZipEntryRules:
			pkg.RulesYML = string(b)
		case f.Name == contract.ZipEntryBlackbox:
			pkg.BlackboxYML = string(b)
		case strings.HasPrefix(f.Name, contract.ZipTargetsDirPrefix):
			name := strings.TrimPrefix(f.Name, contract.ZipTargetsDirPrefix)
			if name == "" {
				continue
			}
			pkg.Targets[name] = string(b)
		case f.Name == contract.ZipEntryMetadata:
			// metadata 已由 puller 校验，落盘时单独写；此处不判重。
		default:
			// 未知条目忽略（保持对中心未来扩展向后兼容）。
		}
	}
	if strings.TrimSpace(pkg.PrometheusYML) == "" {
		return nil, fmt.Errorf("deployer: prometheus.yml missing or empty")
	}
	return pkg, nil
}

// ValidateTargetsJSON 做 targets 文件结构校验（PRD §6.4 条目 3）：每个文件必须是
// JSON 数组，元素为对象，含字符串数组 targets，labels（可选）为对象。失败返回错误。
func ValidateTargetsJSON(name, content string) error {
	var arr []json.RawMessage
	if err := json.Unmarshal([]byte(content), &arr); err != nil {
		return fmt.Errorf("deployer: targets %s: %w", name, err)
	}
	if len(arr) == 0 {
		return fmt.Errorf("deployer: targets %s: empty array", name)
	}
	for i, raw := range arr {
		var obj map[string]json.RawMessage
		if err := json.Unmarshal(raw, &obj); err != nil {
			return fmt.Errorf("deployer: targets %s[%d]: not an object: %w", name, i, err)
		}
		tgt, ok := obj["targets"]
		if !ok {
			return fmt.Errorf("deployer: targets %s[%d]: missing targets", name, i)
		}
		var tlist []string
		if err := json.Unmarshal(tgt, &tlist); err != nil {
			return fmt.Errorf("deployer: targets %s[%d]: targets not string array: %w", name, i, err)
		}
		if len(tlist) == 0 {
			return fmt.Errorf("deployer: targets %s[%d]: empty targets", name, i)
		}
		if labels, ok := obj["labels"]; ok {
			var m map[string]string
			if err := json.Unmarshal(labels, &m); err != nil {
				return fmt.Errorf("deployer: targets %s[%d]: labels not string map: %w", name, i, err)
			}
		}
	}
	return nil
}

func readEntry(f *zip.File) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	var buf bytes.Buffer
	if _, err := buf.ReadFrom(rc); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

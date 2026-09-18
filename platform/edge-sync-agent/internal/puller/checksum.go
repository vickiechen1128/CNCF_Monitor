// Package puller 实现 Edge Sync Agent 心跳-拉包主循环与配置包 checksum 校验。
package puller

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"

	"github.com/metriccenter/platform/edge-sync-agent/internal/contract"
)

// VerifyChecksum 解包 zip、解析 metadata.json 并重算联合 checksum 校验。
//
// 与中心 zipper.go 同纪律（PRD §6.3）：checksum = sha256(prometheus.yml + rules.yml +
// blackbox.yml + 各 targets 内容按文件名固定序拼接)，缺失文件按空串处理，排除 metadata.json。
// 校验失败返回 ErrChecksumMismatch，且不进入解压步骤（§6.4 条目 2：保留最后有效配置）。
func VerifyChecksum(zipBytes []byte) (*contract.Metadata, error) {
	zr, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		return nil, fmt.Errorf("puller: open zip: %w", err)
	}

	content := map[string]string{}
	var meta *contract.Metadata
	for _, f := range zr.File {
		if f.Name == "" {
			continue
		}
		b, err := readZipFile(f)
		if err != nil {
			return nil, fmt.Errorf("puller: read entry %s: %w", f.Name, err)
		}
		if f.Name == contract.ZipEntryMetadata {
			var m contract.Metadata
			if err := json.Unmarshal(b, &m); err != nil {
				return nil, fmt.Errorf("puller: parse metadata.json: %w", err)
			}
			mc := m
			meta = &mc
			continue
		}
		content[f.Name] = string(b)
	}
	if meta == nil {
		return nil, fmt.Errorf("puller: metadata.json missing")
	}

	got := recomputeChecksum(content)
	if got != meta.Checksum {
		return meta, ErrChecksumMismatch
	}
	return meta, nil
}

// ErrChecksumMismatch 表示 metadata.checksum 与包内容重算不一致。
var ErrChecksumMismatch = fmt.Errorf("puller: config checksum mismatch")

// recomputeChecksum 按固定序拼接包内容计算联合 sha256（不含 metadata.json）。
func recomputeChecksum(content map[string]string) string {
	var b bytes.Buffer
	b.WriteString(content[contract.ZipEntryPrometheus])
	b.WriteString(content[contract.ZipEntryRules])
	b.WriteString(content[contract.ZipEntryBlackbox])

	// targets 按文件名排序。
	targetFiles := make([]string, 0, len(content))
	for name := range content {
		if len(name) >= len(contract.ZipTargetsDirPrefix) && name[:len(contract.ZipTargetsDirPrefix)] == contract.ZipTargetsDirPrefix {
			targetFiles = append(targetFiles, name)
		}
	}
	sort.Strings(targetFiles)
	for _, name := range targetFiles {
		b.WriteString(content[name])
	}

	sum := sha256.Sum256(b.Bytes())
	return hex.EncodeToString(sum[:])
}

func readZipFile(f *zip.File) ([]byte, error) {
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

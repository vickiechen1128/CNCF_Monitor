package edge

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"
)

// 组件清单（PRD §3.3 包清单：edge-sync-agent + vmagent + blackbox_exporter）。
const (
	// EdgeSyncAgentComponent 边缘 Agent（守护 + 拉包 + reload）。
	EdgeSyncAgentComponent = "edge-sync-agent"
	// VMAgentComponent 采集器（vmagent）。
	VMAgentComponent = "vmagent"
	// BlackboxComponent 拨测器（blackbox_exporter）。
	BlackboxComponent = "blackbox_exporter"
)

// PackageComponent 描述离线包内单个组件的名称 / 版本 / sha256 / 大小。
type PackageComponent struct {
	Name      string `json:"name"`
	Version   string `json:"version"`
	Sha256    string `json:"sha256"`
	SizeBytes int64  `json:"size_bytes"`
}

// PackageArtifact 描述一个一体化离线包（PRD §3.3 / §6.4）。
// v0.2 版本清单来自构建产物元数据，不建 DB 模型（§3.3「版本清单来源：来自构建产物
// 元数据，不建 DB 模型」；EdgePackageRelease 模型 {v0.3} 再评估）。
type PackageArtifact struct {
	ID          string             `json:"id"`
	Version     string             `json:"version"` // 包版本（区别于组件版本）
	Components  []PackageComponent `json:"components"`
	SizeBytes   int64              `json:"size_bytes"`
	Sha256      string             `json:"sha256"` // 整包 sha256
	DownloadURL string             `json:"download_url"`
}

// offlinePackageDownloadPath 是 /edge-packages/latest/download 的相对下载地址。
// 管理面下载同源（区别于 edge 协议配置包需要绝对地址给外部 Agent 拉取），前端可直接拼接。
const offlinePackageDownloadPath = "/api/v2/platform/edge-packages/latest/download"

// offlinePackageDownloadPathFor 返回指定版本的相对下载地址（契约 §2：
// /api/v2/platform/edge-packages/<version>/download）。
func offlinePackageDownloadPathFor(version string) string {
	return "/api/v2/platform/edge-packages/" + version + "/download"
}

// 可发布的离线包集合（MVPT 交付包元数据）。version 升级必选「v0.x.y 同格式」以便字典序可比。
var packageRegistry = []PackageArtifact{
	{
		ID:      "release-v0.1.0",
		Version: "v0.1.0",
		Components: []PackageComponent{
			componentSpec(EdgeSyncAgentComponent, "v0.1.0"),
			componentSpec(VMAgentComponent, "v1.106.0"),
			componentSpec(BlackboxComponent, "v0.25.0"),
		},
	},
	{
		ID:      "release-v0.2.0",
		Version: "v0.2.0",
		Components: []PackageComponent{
			componentSpec(EdgeSyncAgentComponent, "v0.2.0"),
			componentSpec(VMAgentComponent, "v1.152.0"),
			componentSpec(BlackboxComponent, "v0.26.0"),
		},
	},
}

// componentSpec 构造组件规格；就地计算占位二进制内容大小与 sha256（确定性）。
func componentSpec(name, version string) PackageComponent {
	b := componentBinBytes(name, version)
	return PackageComponent{
		Name:      name,
		Version:   version,
		Sha256:    sha256Hex(b),
		SizeBytes: int64(len(b)),
	}
}

// componentBinBytes 返回某组件占位二进制内容（版本清单来自构建产物元数据，MVP 用可复算占位）。
func componentBinBytes(name, version string) []byte {
	return []byte(fmt.Sprintf("metriccenter-component-placeholder:%s:%s", name, version))
}

// resolveArtifact 依据 artifact 的组件清单重建整包 zip，回填 SizeBytes / Sha256 / DownloadURL。
func resolveArtifact(art PackageArtifact) (PackageArtifact, error) {
	zipData, sha, err := buildOfflinePackageZip(art)
	if err != nil {
		return art, err
	}
	art.SizeBytes = int64(len(zipData))
	art.Sha256 = sha
	art.DownloadURL = offlinePackageDownloadPathFor(art.Version)
	return art, nil
}

// ListPackages 返回全部可发布离线包的清单（含整包大小与 sha256）。
func ListPackages() ([]PackageArtifact, error) {
	sorted := make([]PackageArtifact, len(packageRegistry))
	copy(sorted, packageRegistry)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Version > sorted[j].Version })
	out := make([]PackageArtifact, 0, len(sorted))
	for _, a := range sorted {
		r, err := resolveArtifact(a)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, nil
}

// ErrNoPackage 表示无可发布离线包。
var ErrNoPackage = errors.New("no edge offline package available")

// ErrPackageNotFound 表示未找到指定版本的离线包。
var ErrPackageNotFound = errors.New("edge offline package not found")

// FindPackage 按版本精确匹配返回指定的离线包（填充整包元数据）；未命中返回 ErrPackageNotFound。
func FindPackage(version string) (PackageArtifact, error) {
	for _, a := range packageRegistry {
		if a.Version == version {
			return resolveArtifact(a)
		}
	}
	return PackageArtifact{}, ErrPackageNotFound
}

// LatestPackage 返回版本号最大的离线包（填充整包元数据）。
func LatestPackage() (PackageArtifact, error) {
	sorted := make([]PackageArtifact, len(packageRegistry))
	copy(sorted, packageRegistry)
	if len(sorted) == 0 {
		return PackageArtifact{}, ErrNoPackage
	}
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Version > sorted[j].Version })
	return resolveArtifact(sorted[0])
}

// buildOfflinePackageZip 重建一体化离线包 zip（确定性，便于 ETag 复用）：
// 每个组件各占位一个文件 + 顶层 metadata.json（含版本与组件清单）。返回 zip 字节与整包 sha256。
func buildOfflinePackageZip(art PackageArtifact) ([]byte, string, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	// 固定写时间保证确定性构建（ETag / sha256 稳定）。
	fixedTime := time.Unix(0, 0).UTC()

	meta := map[string]interface{}{
		"id":         art.ID,
		"version":    art.Version,
		"components": art.Components,
	}
	for _, c := range art.Components {
		if err := writeZipEntry(zw, c.Name, componentBinBytes(c.Name, c.Version), fixedTime); err != nil {
			return nil, "", fmt.Errorf("write %s: %w", c.Name, err)
		}
	}
	metaJSON, err := json.Marshal(meta)
	if err != nil {
		return nil, "", fmt.Errorf("marshal metadata: %w", err)
	}
	if err := writeZipEntry(zw, "metadata.json", metaJSON, fixedTime); err != nil {
		return nil, "", err
	}
	if err := zw.Close(); err != nil {
		return nil, "", fmt.Errorf("close zip: %w", err)
	}
	return buf.Bytes(), sha256Hex(buf.Bytes()), nil
}

func writeZipEntry(zw *zip.Writer, name string, data []byte, modTime time.Time) error {
	h := &zip.FileHeader{Name: name, Method: zip.Store}
	h.SetModTime(modTime)
	w, err := zw.CreateHeader(h)
	if err != nil {
		return err
	}
	_, err = w.Write(data)
	return err
}

// sha256Hex 计算 content 的 sha256 十六进制小写。
func sha256Hex(content []byte) string {
	sum := sha256.Sum256(content)
	return hex.EncodeToString(sum[:])
}
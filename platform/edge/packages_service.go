package edge

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
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

// PackageComponent 描述离线包内单个组件的名称 / 版本。
type PackageComponent struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	// Sha256 / SizeBytes 当前构建产物元数据不提供（按组件留空并省略），
	// 保留字段以兼容后续按组件细化的产物元数据。
	Sha256    string `json:"sha256,omitempty"`
	SizeBytes int64  `json:"size_bytes,omitempty"`
}

// PackageArtifact 描述一个一体化离线包（PRD §3.3 / §6.4）。
// v0.2 版本清单来自构建产物元数据（包目录下的 release_meta.json），不建 DB 模型
// （§3.3「版本清单来源：来自构建产物元数据，不建 DB 模型」；EdgePackageRelease 模型 {v0.3} 再评估）。
type PackageArtifact struct {
	ID      string `json:"id"`
	Version string `json:"version"` // 包版本（区别于组件版本）
	// File 是 tarball 的纯文件名（不含路径），来自 release_meta.json 的 file 字段；
	// 文件名带构建时间戳、无法由 version 推导，故必须由打包脚本写入清单。
	File        string             `json:"file"`
	Components  []PackageComponent `json:"components"`
	SizeBytes   int64              `json:"size_bytes"`
	Sha256      string             `json:"sha256"` // 整包 sha256（构建时写入清单，下载时直接复用，不重算）
	DownloadURL string             `json:"download_url"`
}

// releaseMetaFile 是包目录下的发布元数据文件名（唯一清单来源，单版本）。
const releaseMetaFile = "release_meta.json"

// offlinePackageDownloadPath 是 /edge-packages/latest/download 的相对下载地址。
// 管理面下载同源（区别于 edge 协议配置包需要绝对地址给外部 Agent 拉取），前端可直接拼接。
const offlinePackageDownloadPath = "/api/v2/platform/edge-packages/latest/download"

// offlinePackageDownloadPathFor 返回指定版本的相对下载地址（契约 §2：
// /api/v2/platform/edge-packages/<version>/download）。
func offlinePackageDownloadPathFor(version string) string {
	return "/api/v2/platform/edge-packages/" + version + "/download"
}

// ErrNoPackage 表示无可发布离线包。
var ErrNoPackage = errors.New("no edge offline package available")

// ErrPackageNotFound 表示未找到指定版本的离线包。
var ErrPackageNotFound = errors.New("edge offline package not found")

// errPackageArtifactUnavailable 是内部 sentinel：包目录尚无可用产物（release_meta.json
// 不存在、file 字段缺失，或 file 指向的文件不存在 / 为空）。这是「未打包」的正常态，
// 对 ListPackages 映射为空清单 + nil，对 Latest/Find 映射为 404 语义 sentinel。
var errPackageArtifactUnavailable = errors.New("edge offline package artifact unavailable")

// loadManifest 读取包目录下的 release_meta.json 并回填派生字段。
//
// 语义（与契约 §2 对齐）：
//   - manifest 文件不存在 → errPackageArtifactUnavailable（未打包，正常态，不是故障）；
//   - file 字段缺失 / 归一后非法 / 对应文件不存在或大小为 0 → errPackageArtifactUnavailable；
//   - manifest 存在但 JSON 非法或 version 为空 → 普通 error（真故障，上层走 500）。
func loadManifest(dir string) (PackageArtifact, error) {
	data, err := os.ReadFile(filepath.Join(dir, releaseMetaFile))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return PackageArtifact{}, errPackageArtifactUnavailable
		}
		return PackageArtifact{}, fmt.Errorf("read %s: %w", releaseMetaFile, err)
	}

	var art PackageArtifact
	if err := json.Unmarshal(data, &art); err != nil {
		return PackageArtifact{}, fmt.Errorf("parse %s: %w", releaseMetaFile, err)
	}
	if art.Version == "" {
		return PackageArtifact{}, fmt.Errorf("invalid %s: version is empty", releaseMetaFile)
	}

	// 安全：file 归一为纯文件名，禁止路径穿越（filepath.Base 收敛任何目录前缀 / ../）。
	name := filepath.Base(art.File)
	if name == "" || name == "." || name == ".." || name == string(filepath.Separator) {
		return PackageArtifact{}, errPackageArtifactUnavailable
	}
	info, err := os.Stat(filepath.Join(dir, name))
	if err != nil || info.IsDir() || info.Size() == 0 {
		return PackageArtifact{}, errPackageArtifactUnavailable
	}

	art.File = name
	if art.ID == "" {
		art.ID = "release-" + art.Version
	}
	if art.SizeBytes <= 0 {
		art.SizeBytes = info.Size()
	}
	art.DownloadURL = offlinePackageDownloadPathFor(art.Version)
	return art, nil
}

// ListPackages 返回包目录下 release_meta.json 描述的唯一离线包清单。
// 未打包（manifest 缺失或产物不可用）时返回空清单 + nil error，让前端走空态。
func ListPackages(dir string) ([]PackageArtifact, error) {
	art, err := loadManifest(dir)
	if err != nil {
		if errors.Is(err, errPackageArtifactUnavailable) {
			return []PackageArtifact{}, nil
		}
		return nil, err
	}
	return []PackageArtifact{art}, nil
}

// LatestPackage 返回包目录下清单描述的离线包（单版本，即最新）。
// 未打包时返回 ErrNoPackage（handler 侧语义保持现状）。
func LatestPackage(dir string) (PackageArtifact, error) {
	art, err := loadManifest(dir)
	if err != nil {
		if errors.Is(err, errPackageArtifactUnavailable) {
			return PackageArtifact{}, ErrNoPackage
		}
		return PackageArtifact{}, err
	}
	return art, nil
}

// FindPackage 按版本与清单 version 做等值比较返回指定离线包；未命中返回 ErrPackageNotFound。
// version 仅用于等值比较，绝不用于拼接路径。
func FindPackage(dir, version string) (PackageArtifact, error) {
	art, err := loadManifest(dir)
	if err != nil {
		if errors.Is(err, errPackageArtifactUnavailable) {
			return PackageArtifact{}, ErrPackageNotFound
		}
		return PackageArtifact{}, err
	}
	if art.Version != version {
		return PackageArtifact{}, ErrPackageNotFound
	}
	return art, nil
}

// OpenPackageFile 打开 art 对应的 tarball 文件句柄，供 handler 流式下发
// （http.ServeContent），避免把大包读进内存。
func OpenPackageFile(dir string, art PackageArtifact) (*os.File, error) {
	name := filepath.Base(art.File)
	if name == "" || name == "." || name == ".." || name == string(filepath.Separator) {
		return nil, ErrNoPackage
	}
	f, err := os.Open(filepath.Join(dir, name))
	if err != nil {
		return nil, fmt.Errorf("open package artifact %s: %w", name, err)
	}
	return f, nil
}

package deployer

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/metriccenter/platform/edge-sync-agent/internal/contract"
	"github.com/metriccenter/platform/edge-sync-agent/internal/logger"
)

// ComponentType 是 reload 触发目标的组件类型（采集器 / 拨测器）。
type ComponentType string

const (
	ComponentCollector ComponentType = contract.ComponentTypeCollector
	ComponentBlackbox  ComponentType = contract.ComponentTypeBlackbox
)

// Reloader 是触发组件 reload 的可注入回调。对采集器用 Prometheus /-/reload（或
// SIGUSR1）；对 blackbox 用 SIGHUP。真实进程信号/HTTP 触发由 T11-15 main 装配注入，
// 本包以接口隔离以便单测。
type Reloader func(ctx context.Context, comp ComponentType, configVersion string) error

// Validator 对解包后的配置做结构校验；返回错误表示校验失败（回滚、不落盘）。
// 默认用 structuralValidator；生产可替换为 promtool / blackbox_exporter --config.check
// 驱动的实现（见 validate.go 顶部说明）。
type Validator func(pkg *Package) error

// applyStateFileName 是「最近一次配置应用结果」的落盘文件名（随 current 软链指向当前
// 生效版本目录，见 applyStatePath）。
const applyStateFileName = "apply-state.json"

// ApplyState 是最近一次配置应用结果（M11 dev-feedback F-17 / 设计提案 D-1）：
// Apply 失败时记录失败版本、原因与时间；应用成功时清空。落盘避免 Agent 重启后丢失
// 诊断信息（重启后仍可随心跳上送上一次失败原因）。
type ApplyState struct {
	Version string `json:"version,omitempty"` // 应用失败的配置版本
	Error   string `json:"error,omitempty"`   // 失败原因（Apply 返回的 error 文本）
	At      string `json:"at,omitempty"`      // 记录时间（RFC3339）
}

// Failed 表示存在尚未被成功应用清除的失败记录。
func (s ApplyState) Failed() bool { return s.Error != "" }

// Deployer 实现配置包原子落盘 + reload 触发，并满足 puller.Deployer 接口
// （Apply(ctx, zipBytes, meta)）。zip 已完成联合 checksum 校验，此处仅做结构校验。
type Deployer struct {
	root        string // 部署根目录，config-<net_domain_id> 位于其下
	netDomainID string
	logger      *logger.Logger
	validate    Validator
	promReload  Reloader // 采集器 reload（/-/reload）
	bbReload    Reloader // 拨测器 reload（SIGHUP）

	// 幂等与 reload 判定基准：当前生效版本与其 prometheus.yml 内容。
	currentVersion string
	currentPromYML string
	// 最近一次应用结果（内存 + 落盘 current/apply-state.json），供心跳上报中心。
	applyState ApplyState
}

// New 构造 Deployer。root 为配置部署根目录（staging / 版本目录都建其下），
// netDomainID 决定专属子目录 config-<net_domain_id>。validate 为 nil 时用
// StructuralValidate；reload 回调为 nil 时跳过对应 reload（仅落盘）。
func New(root, netDomainID string, logg *logger.Logger, validate Validator, promReload, bbReload Reloader) *Deployer {
	if validate == nil {
		validate = StructuralValidate
	}
	return &Deployer{
		root:        root,
		netDomainID: netDomainID,
		logger:      logg,
		validate:    validate,
		promReload:  promReload,
		bbReload:    bbReload,
	}
}

// DomainDir 返回本网域专属配置目录 <root>/config-<net_domain_id>。
func (d *Deployer) DomainDir() string { return filepath.Join(d.root, "config-"+d.netDomainID) }

// VersionDir 返回指定版本目录 <root>/config-<net_domain_id>/<version>。
func (d *Deployer) VersionDir(version string) string {
	return filepath.Join(d.DomainDir(), version)
}

// CurrentVersion 返回当前生效配置版本（未应用过为空）。
func (d *Deployer) CurrentVersion() string { return d.currentVersion }

// CurrentDir 返回本网域当前生效配置目录，即符号链接 <root>/config-<id>/current
// （恒指向最新已生效版本目录）。进程统一以 current 为基准启动并 reload，使后续
// 下发的新版本能被 SIGHUP / /-/reload 重载到运行态（H-2 修复：避免 reload 旧版本
// 目录导致第二次及以后下发对运行中实例失效）。无任何已生效版本时软链不存在。
func (d *Deployer) CurrentDir() string {
	return filepath.Join(d.DomainDir(), "current")
}

// setCurrentLink 将 current 软链更新为指向指定版本目录（相对软链，稳定跨重启）。
func (d *Deployer) setCurrentLink(version string) {
	current := d.CurrentDir()
	_ = os.RemoveAll(current)
	if err := os.Symlink(version, current); err != nil {
		d.logger.Warnf("deployer: set current link to %s failed: %v", version, err)
	}
}

// Restore 从磁盘恢复上次生效配置版本（崩溃恢复 / 重启复用，PRD §6.4 条目 6）：
// 扫描 <root>/config-<net_domain_id>/ 下的版本目录，取字典序最大的作为 currentVersion，
// 并读回其 prometheus.yml 作为 reload 判定基准。无任何版本目录时保持未生效态（返回 nil，
// 由心跳以空 config_version 上报，待中心下发生效）。同时恢复「最近一次应用失败」记录，
// 避免重启丢失诊断信息。
func (d *Deployer) Restore() error {
	// 恢复诊断状态（current 软链为上一进程遗留，先于本函数改写 currentVersion 读取）。
	d.loadApplyState()
	entries, err := os.ReadDir(d.DomainDir())
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("deployer: restore scan: %w", err)
	}
	var best string
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		if best == "" || e.Name() > best {
			best = e.Name()
		}
	}
	if best == "" {
		return nil
	}
	promBytes, err := os.ReadFile(filepath.Join(d.VersionDir(best), contract.ZipEntryPrometheus))
	if err != nil {
		d.logger.Warnf("deployer: restore %s: cannot read prometheus.yml: %v", best, err)
		return nil
	}
	d.currentVersion = best
	d.setCurrentLink(best)
	d.currentPromYML = string(promBytes)
	d.logger.Infof("deployer: restored effective config_version=%s", best)
	return nil
}

// Apply 应用一个配置包：幂等去重 → 解包 → 结构校验 → staging 落盘 → 原子改名切换
// → 按需 reload。任一失败保留上一份可运行配置（旧版本目录不被触碰/删除，回滚保底）。
// 同时维护「最近一次应用结果」状态（失败记录版本 + 原因并落盘，成功清空），供心跳上报。
func (d *Deployer) Apply(ctx context.Context, zipBytes []byte, meta *contract.Metadata) error {
	// 幂等：同 config_version 不重复落盘/切换/reload（puller 已按 config_changed
	// 避免调用，此处再防御）。
	if meta != nil && meta.ConfigVersion != "" && meta.ConfigVersion == d.currentVersion {
		d.logger.Infof("deployer: config_version %s already applied, skip", meta.ConfigVersion)
		// 该版本已在生效，视为应用成功：清空历史失败记录，避免陈旧告警。
		d.clearApplyState()
		return nil
	}

	version := ""
	if meta != nil {
		version = meta.ConfigVersion
	}

	pkg, err := extractPackage(zipBytes, meta)
	if err != nil {
		d.recordApplyFailure(version, err)
		return err
	}

	// 结构校验：失败则回滚（不写任何文件），保留上一份可运行配置。
	if err := d.validate(pkg); err != nil {
		d.logger.Warnf("deployer: config validation failed, keep last runnable config: %v", err)
		d.recordApplyFailure(version, err)
		return err
	}

	staging := d.stagingDir()
	if err := writePackage(staging, pkg); err != nil {
		_ = os.RemoveAll(staging)
		err = fmt.Errorf("deployer: write staging: %w", err)
		d.recordApplyFailure(version, err)
		return err
	}

	version = pkg.Metadata.ConfigVersion
	versionDir := d.VersionDir(version)

	// 原子切换：staging 整体 rename 为版本目录（同文件系统 rename 原子）。
	if err := os.Rename(staging, versionDir); err != nil {
		_ = os.RemoveAll(staging)
		err = fmt.Errorf("deployer: atomic switch: %w", err)
		d.recordApplyFailure(version, err)
		return err
	}
	d.currentVersion = version
	d.setCurrentLink(version)
	d.logger.Infof("deployer: applied config_version=%s at %s", version, versionDir)

	d.triggerReload(ctx, pkg)
	// 应用成功：清空失败记录（落盘文件与内存状态）。
	d.clearApplyState()
	return nil
}

// ApplyState 返回最近一次配置应用失败记录（无失败时为零值）。
func (d *Deployer) ApplyState() ApplyState { return d.applyState }

// applyStatePath 返回应用结果状态文件路径——`<root>/config-<id>/current/apply-state.json`
// （current 为指向当前生效版本目录的软链）。尚无可用的 current 软链（如首次拉包即失败、
// 从未成功应用过）时回落到网域目录 `<root>/config-<id>/apply-state.json`，保证诊断信息
// 不因无生效版本而丢失。
func (d *Deployer) applyStatePath() string {
	if _, err := os.Stat(d.CurrentDir()); err == nil {
		return filepath.Join(d.CurrentDir(), applyStateFileName)
	}
	return filepath.Join(d.DomainDir(), applyStateFileName)
}

// recordApplyFailure 记录一次应用失败（版本 + 原因 + 时间）并尽力落盘。落盘失败仅记
// WARN，不影响应用结果（内存状态仍可用于本轮心跳）。
func (d *Deployer) recordApplyFailure(version string, err error) {
	d.applyState = ApplyState{
		Version: version,
		Error:   err.Error(),
		At:      time.Now().UTC().Format(time.RFC3339),
	}
	path := d.applyStatePath()
	if mkErr := os.MkdirAll(filepath.Dir(path), 0o755); mkErr != nil {
		d.logger.Warnf("deployer: persist apply state mkdir %s failed: %v", filepath.Dir(path), mkErr)
		return
	}
	b, mErr := json.Marshal(d.applyState)
	if mErr != nil {
		d.logger.Warnf("deployer: marshal apply state failed: %v", mErr)
		return
	}
	if wErr := os.WriteFile(path, b, 0o644); wErr != nil {
		d.logger.Warnf("deployer: persist apply state %s failed: %v", path, wErr)
	}
}

// clearApplyState 清空内存中的应用结果并尽力删除落盘文件（清理两个候选路径：current
// 软链目标与网域目录，避免软链切换后残留旧记录）。
func (d *Deployer) clearApplyState() {
	d.applyState = ApplyState{}
	for _, p := range []string{
		filepath.Join(d.CurrentDir(), applyStateFileName),
		filepath.Join(d.DomainDir(), applyStateFileName),
	} {
		if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
			d.logger.Warnf("deployer: remove apply state %s failed: %v", p, err)
		}
	}
}

// loadApplyState 从磁盘恢复上一次应用失败记录（崩溃恢复 / 重启复用，避免重启后丢失
// 诊断信息）。无记录时保持空状态。
func (d *Deployer) loadApplyState() {
	for _, p := range []string{
		filepath.Join(d.CurrentDir(), applyStateFileName),
		filepath.Join(d.DomainDir(), applyStateFileName),
	} {
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		var st ApplyState
		if err := json.Unmarshal(b, &st); err != nil {
			d.logger.Warnf("deployer: read apply state %s failed: %v", p, err)
			continue
		}
		if st.Failed() {
			d.applyState = st
			d.logger.Infof("deployer: restored last apply failure: version=%s", st.Version)
		}
		return
	}
}

// triggerReload 依据 PRD §6.4 判定 reload：
//   - 仅当 prometheus.yml 内容变化才触发采集器 /-/reload（targets 由 file_sd 自动感知）。
//   - 配置包含 blackbox.yml 时触发拨测器 reload。
//
// reload 触发失败不改变已落盘生效结果（配置已可用），仅记 WARN。
func (d *Deployer) triggerReload(ctx context.Context, pkg *Package) {
	promChanged := pkg.PrometheusYML != d.currentPromYML
	d.currentPromYML = pkg.PrometheusYML

	if promChanged && d.promReload != nil {
		if err := d.promReload(ctx, ComponentCollector, pkg.Metadata.ConfigVersion); err != nil {
			d.logger.Warnf("deployer: collector reload failed: %v", err)
		} else {
			d.logger.Infof("deployer: collector reloaded (prometheus.yml changed)")
		}
	}
	if strings.TrimSpace(pkg.BlackboxYML) != "" && d.bbReload != nil {
		if err := d.bbReload(ctx, ComponentBlackbox, pkg.Metadata.ConfigVersion); err != nil {
			d.logger.Warnf("deployer: blackbox reload failed: %v", err)
		} else {
			d.logger.Infof("deployer: blackbox reloaded (blackbox.yml present)")
		}
	}
}

// stagingDir 返回本次暂存目录 <root>/config-<id>/.staging（供原子改名为版本目录）。
func (d *Deployer) stagingDir() string {
	return filepath.Join(d.DomainDir(), ".staging")
}

// writePackage 把 Package 原子写入 staging 目录：
//
//	prometheus.yml  必需
//	metadata.json   必需（回写校验通过的 metadata）
//	targets/<name>  每个 targets 文件
//	rules.yml       有则
//	blackbox.yml    有则
func writePackage(dir string, pkg *Package) error {
	if err := os.MkdirAll(filepath.Join(dir, "targets"), 0o755); err != nil {
		return err
	}
	files := map[string]string{contract.ZipEntryPrometheus: pkg.PrometheusYML}
	if strings.TrimSpace(pkg.RulesYML) != "" {
		files[contract.ZipEntryRules] = pkg.RulesYML
	}
	if strings.TrimSpace(pkg.BlackboxYML) != "" {
		files[contract.ZipEntryBlackbox] = pkg.BlackboxYML
	}
	for _, f := range []string{contract.ZipEntryPrometheus, contract.ZipEntryRules, contract.ZipEntryBlackbox} {
		if c, ok := files[f]; ok {
			if err := os.WriteFile(filepath.Join(dir, f), []byte(c), 0o644); err != nil {
				return err
			}
		}
	}
	for name, content := range pkg.Targets {
		if err := validateTargetName(name); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dir, "targets", name), []byte(content), 0o644); err != nil {
			return err
		}
	}
	if pkg.Metadata != nil {
		b, err := marshalMetadata(pkg.Metadata)
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dir, contract.ZipEntryMetadata), b, 0o644); err != nil {
			return err
		}
	}
	return nil
}

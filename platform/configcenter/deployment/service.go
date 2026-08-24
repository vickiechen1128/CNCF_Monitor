// Package deployment implements Module_09 配置下发与历史（config deployment）：
// confirm 触发 local 写盘 reload、下发记录、重试、回滚，以及成功下发后对 M01
// ScrapeJob.change_status 的回写（决策 31-M2）；agent_pull 通道 MVP 仅登记占位。
// 参见 docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md
//   §3.5 配置下发与历史 / §5.6 ConfigDeployment / §6.6.3 / 决策 42-3、决策 31-M2。
package deployment

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/metriccenter/metriccenter/platform/configcenter/generator"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// Applier 将配置产物投递到目标（local 通道 = 写中心 Prometheus 配置目录并 reload）。
// 抽象为接口以便单元测试注入内存 fake（不真实写盘 / reload）。
type Applier interface {
	// Apply 投递产物；返回错误表示投递失败（记录 failed + error_message）。
	Apply(ca *generator.ConfigArtifacts) error
}

// DefaultApplier 供 HTTP handler 进行 local 下发。默认 no-op（内存 / 测试环境不
// 写盘，保证未显式配置时 confirm 不抛错）；生产由 cmd/metric-center/main.go 在
// 启动时装配为指向中心配置目录 + reload 地址的 *DiskApplier（T09-06 review-fix）。
var DefaultApplier Applier = noopApplier{}

// noopApplier 无副作用投递（默认占位，保证未显式配置时 confirm 不抛错）。
type noopApplier struct{}

func (noopApplier) Apply(*generator.ConfigArtifacts) error { return nil }

// 服务层 sentinel 错误，handler 据此映射 HTTP errorType。
var (
	// ErrNotFound 表示下发记录不存在。
	ErrNotFound = errors.New("config deployment not found")
	// ErrVersionNotFound 表示配置版本不存在。
	ErrVersionNotFound = errors.New("config version not found")
	// ErrDomainNotFound 表示下发关联的网域不存在。
	ErrDomainNotFound = errors.New("network domain not found")
	// ErrDomainRequired 表示列表接口缺少必填的 network_domain_id。
	ErrDomainRequired = errors.New("network_domain_id is required")
	// ErrNotLocal 表示重试 / 回滚仅支持 local 通道（agent_pull 返回 bad_request）。
	ErrNotLocal = errors.New("retry/rollback requires a local channel deployment")
	// ErrNotFailed 表示仅失败的下发记录可重试。
	ErrNotFailed = errors.New("retry requires the original deployment to be failed")
)

// Dispatch 下发一个已确认的 ConfigVersion（confirm 触发，决策 31-M2）。
//
//   - local   通道：经 Applier 写中心 Prometheus 配置目录并 reload；成功后创建
//     ConfigDeployment(status=success) 并回写 M01 ScrapeJob.change_status=deployed；
//     写盘 / reload 失败则记录 status=failed + error_message（不阻断 confirm 的版本生成）。
//   - agent_pull 通道：MVP 占位，仅登记一条 status=pending 下发记录（本地不写盘，
//     由 Edge Sync Agent v0.2 心跳拉包生效）。
func Dispatch(db *gorm.DB, version *models.ConfigVersion, triggeredBy string, app Applier) (*models.ConfigDeployment, error) {
	dom, err := loadDomain(db, version.NetworkDomainID)
	if err != nil {
		return nil, err
	}
	return dispatchVersion(db, version, dom, triggeredBy, app)
}

// DeployConfirmedVersion 经 DefaultApplier 下发已确认版本（供 draft.confirm 集成调用）。
func DeployConfirmedVersion(db *gorm.DB, version *models.ConfigVersion, triggeredBy string) (*models.ConfigDeployment, error) {
	return Dispatch(db, version, triggeredBy, DefaultApplier)
}

// Retry 重试一条失败的 local 下发记录（决策 42-3）：复用该记录对应版本，重新
// 写盘 + reload，生成一条新的 ConfigDeployment。
func Retry(db *gorm.DB, deploymentID, triggeredBy string, app Applier) (*models.ConfigDeployment, error) {
	var orig models.ConfigDeployment
	if err := db.Where("id = ?", deploymentID).First(&orig).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("load deployment %s for retry: %w", deploymentID, err)
	}
	if orig.Channel != models.ChannelTypeLocal {
		return nil, ErrNotLocal
	}
	if orig.Status != models.DeploymentStatusFailed {
		return nil, ErrNotFailed
	}
	version, err := loadVersion(db, orig.ConfigVersionID)
	if err != nil {
		return nil, err
	}
	dom, err := loadDomain(db, version.NetworkDomainID)
	if err != nil {
		return nil, err
	}
	if dom.Channel != models.ChannelTypeLocal {
		return nil, ErrNotLocal
	}
	return dispatchVersion(db, version, dom, triggeredBy, app)
}

// Rollback 回滚到目标 ConfigVersion（契约 §5）：目标版本存在且属于 local 通道网域时，
// 重新写盘 + reload 该版本，生成一条新的 ConfigDeployment（status 按投递结果）。
func Rollback(db *gorm.DB, versionID, triggeredBy string, app Applier) (*models.ConfigDeployment, error) {
	version, err := loadVersion(db, versionID)
	if err != nil {
		return nil, err
	}
	dom, err := loadDomain(db, version.NetworkDomainID)
	if err != nil {
		return nil, err
	}
	if dom.Channel != models.ChannelTypeLocal {
		return nil, ErrNotLocal
	}
	return dispatchVersion(db, version, dom, triggeredBy, app)
}

// dispatchVersion 执行一次版本投递并落记录：
//   - 提取产物 → agent_pull 直接落 pending 占位；
//   - local 经 Applier 投递 → success/failed。
func dispatchVersion(db *gorm.DB, version *models.ConfigVersion, dom *models.NetworkDomain, triggeredBy string, app Applier) (*models.ConfigDeployment, error) {
	now := time.Now()
	dep := &models.ConfigDeployment{
		NetworkDomainID:   version.NetworkDomainID,
		ConfigVersionID:   fmt.Sprint(version.ID),
		SourceChangeNo:    version.ChangeNo,
		Channel:           dom.Channel,
		Status:            models.DeploymentStatusPending,
		ValidationStatus:  string(models.ValidationStatusPassed),
		IncludesBlackbox:  version.BlackboxYml != "",
		TriggeredBy:       triggeredBy,
		TriggeredAt:       &now,
	}

	// agent_pull：MVP 占位，不写盘（v0.2 由 Edge Sync Agent 拉包生效）。
	if dom.Channel != models.ChannelTypeLocal {
		if err := db.Create(dep).Error; err != nil {
			return nil, fmt.Errorf("record placeholder deployment: %w", err)
		}
		return dep, nil
	}

	artifacts, err := artifactsFromVersion(version)
	if err != nil {
		return nil, err
	}
	dep.TargetAddress = localReloadURL(dom)
	if err := applySafe(app, artifacts); err != nil {
		dep.Status = models.DeploymentStatusFailed
		dep.ErrorMessage = err.Error()
		dep.CompletedAt = &now
		if cerr := db.Create(dep).Error; cerr != nil {
			return nil, fmt.Errorf("record failed deployment: %w", cerr)
		}
		return dep, nil
	}

	dep.Status = models.DeploymentStatusSuccess
	dep.CompletedAt = &now
	if err := db.Create(dep).Error; err != nil {
		return nil, fmt.Errorf("record deployment: %w", err)
	}
	// 成功下发后回写 M01 ScrapeJob.change_status=deployed（决策 31-M2）。
	// MEDIUM-1 review-fix：writeback 失败与投递成功解耦——降级记录到 error_message，
	// 不整链 500（避免客户端在部署已成功后因回写失败而重复下发）。
	if err := writebackChangeStatus(db, version.NetworkDomainID); err != nil {
		dep.ErrorMessage = fmt.Sprintf("writeback change_status failed: %v", err)
		if uerr := db.Model(dep).Update("error_message", dep.ErrorMessage).Error; uerr != nil {
			return nil, fmt.Errorf("record writeback failure: %w", uerr)
		}
		return dep, nil
	}
	return dep, nil
}

// applySafe 用非 nil applier 投递；nil 视为 no-op（上层误传 nil 时兜底）。
func applySafe(app Applier, ca *generator.ConfigArtifacts) error {
	if app == nil {
		return nil
	}
	return app.Apply(ca)
}

// localReloadURL 返回 local 通道的 target_address（契约 §5：记录 Prometheus reload URL）。
// MVP 直接复用网域登记的 remote_write/中心地址不可得，回退空（omitempty 不展示）。
func localReloadURL(dom *models.NetworkDomain) string {
	if dom.RemoteWriteURL != "" {
		return dom.RemoteWriteURL
	}
	return ""
}

// loadDomain 读取网域行。
func loadDomain(db *gorm.DB, id string) (*models.NetworkDomain, error) {
	var dom models.NetworkDomain
	if err := db.Where("id = ?", id).First(&dom).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, ErrDomainNotFound
		}
		return nil, fmt.Errorf("load domain %s: %w", id, err)
	}
	return &dom, nil
}

// loadVersion 读取配置版本行。
func loadVersion(db *gorm.DB, id string) (*models.ConfigVersion, error) {
	var v models.ConfigVersion
	if err := db.Where("id = ?", id).First(&v).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, ErrVersionNotFound
		}
		return nil, fmt.Errorf("load config version %s: %w", id, err)
	}
	return &v, nil
}

// artifactsFromVersion 回溯版本已存产物为 generator.ConfigArtifacts（用于下发 / reload）。
func artifactsFromVersion(v *models.ConfigVersion) (*generator.ConfigArtifacts, error) {
	targets := map[string]string{}
	if v.TargetsFiles != "" {
		if err := json.Unmarshal([]byte(v.TargetsFiles), &targets); err != nil {
			return nil, fmt.Errorf("parse version targets_files: %w", err)
		}
	}
	return &generator.ConfigArtifacts{
		PrometheusYML: v.PrometheusYml,
		RulesYML:      v.RulesYml,
		BlackboxYML:   v.BlackboxYml,
		TargetsFiles:  targets,
	}, nil
}

// DiskApplier 将配置产物写入本地中心 Prometheus 配置目录（local 通道）。
// reload 策略分离（决策 31 / PRD §3.5）：
//   - targets/*.json 原子写（临时文件 + rename），由 file_sd 自动感知，不触发 reload；
//   - 仅当 prometheus.yml / rules.yml / blackbox.yml 结构文件发生变化时才重写并触发 reload。
type DiskApplier struct {
	Dir    string       // 中心 Prometheus 配置目录
	Reload func() error // 可选：结构变更后触发 reload（SIGHUP 或 POST /-/reload）
}

// Apply 实现 Applier。
func (d *DiskApplier) Apply(ca *generator.ConfigArtifacts) error {
	if d == nil || d.Dir == "" {
		return fmt.Errorf("disk applier dir not configured")
	}
	if err := d.writeTargets(ca.TargetsFiles); err != nil {
		return fmt.Errorf("write targets files: %w", err)
	}
	changed, err := structuralChanged(ca, d.Dir)
	if err != nil {
		return fmt.Errorf("inspect structural config: %w", err)
	}
	if !changed {
		return nil
	}
	if err := d.writeStructural(ca); err != nil {
		return fmt.Errorf("write structural config: %w", err)
	}
	if d.Reload != nil {
		if err := d.Reload(); err != nil {
			return fmt.Errorf("reload prometheus: %w", err)
		}
	}
	return nil
}

// writeStructural 写结构文件（prometheus.yml 必写，rules/blackbox 非空才写）。
func (d *DiskApplier) writeStructural(ca *generator.ConfigArtifacts) error {
	if err := writeFile(filepath.Join(d.Dir, "prometheus.yml"), ca.PrometheusYML); err != nil {
		return err
	}
	if ca.RulesYML != "" {
		if err := writeFile(filepath.Join(d.Dir, "rules.yml"), ca.RulesYML); err != nil {
			return err
		}
	}
	if ca.BlackboxYML != "" {
		if err := writeFile(filepath.Join(d.Dir, "blackbox.yml"), ca.BlackboxYML); err != nil {
			return err
		}
	}
	return nil
}

// writeTargets 原子写 targets/*.json（临时文件 + rename，避免采集器读到半写文件）。
func (d *DiskApplier) writeTargets(files map[string]string) error {
	targetsDir := filepath.Join(d.Dir, "targets")
	if err := os.MkdirAll(targetsDir, 0o755); err != nil {
		return err
	}
	for name, content := range files {
		tmp, err := os.CreateTemp(targetsDir, ".tmp-*")
		if err != nil {
			return err
		}
		tmpPath := tmp.Name()
		if _, err := tmp.WriteString(content); err != nil {
			tmp.Close()
			os.Remove(tmpPath)
			return err
		}
		if err := tmp.Close(); err != nil {
			os.Remove(tmpPath)
			return err
		}
		if err := os.Rename(tmpPath, filepath.Join(targetsDir, name)); err != nil {
			os.Remove(tmpPath)
			return err
		}
	}
	return nil
}

// structuralChanged 判定结构文件是否发生变化（与磁盘现有内容对比；新文件存在即变化）。
func structuralChanged(ca *generator.ConfigArtifacts, dir string) (bool, error) {
	type item struct{ name, content string }
	pairs := []item{
		{"prometheus.yml", ca.PrometheusYML},
		{"rules.yml", ca.RulesYML},
		{"blackbox.yml", ca.BlackboxYML},
	}
	for _, p := range pairs {
		cur, err := os.ReadFile(filepath.Join(dir, p.name))
		if err != nil {
			if os.IsNotExist(err) {
				if p.content != "" {
					return true, nil
				}
				continue
			}
			return false, err
		}
		if string(cur) != p.content {
			return true, nil
		}
	}
	return false, nil
}

// writeFile 幂等写文件。
func writeFile(path, content string) error {
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	return nil
}
package seed

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// DefaultAlertmanagerConfigContent 是平台内置的默认 alertmanager.yml。
//
// 必须与 deploy/alertmanager/alertmanager.yml 保持一致：后者是 `make run-alertmanager`
// 首次启动时复制到 config-output/ 的磁盘 seed；本常量用于把同一份内容写入数据库，
// 使路由页在「用户尚未保存过任何配置」时也能读到一条真实的默认配置，而不是前端合成占位。
// 两者漂移由 seed 包的单测守卫。
const DefaultAlertmanagerConfigContent = `# MetricCenter local-dev seed for Alertmanager (alert converge / silence proxy)
# Copied by ` + "`make run-alertmanager`" + ` into config-output/alertmanager.yml on first run.
# Bootstrap placeholder; the control plane (决策 60 DiskApplier) overwrites it with
# the mounted alertmanager.yml on the first AM config 下发, then triggers /-/reload.
global:
  resolve_timeout: 5m

route:
  group_by: ['alertname']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  receiver: 'default'

receivers:
  - name: 'default'
`

// EnsureDefaultAlertmanagerConfig 在数据库中没有任何「已生效」告警配置版本时，
// 幂等写入一条默认配置（正文与 deploy/alertmanager/alertmanager.yml 一致）。
//
// 语义：
//   - status=applied：Alertmanager 启动时加载的磁盘 seed 正是这份内容；
//   - applied_at=写入时间：路由页/告警配置页据此显示「已生效」；
//   - applied_by=system：标识这是平台引导数据，不是用户提交；
//   - 已有 applied 版本（用户挂载/保存过配置）时不覆盖、不新增。
func EnsureDefaultAlertmanagerConfig(db *gorm.DB) error {
	if db == nil {
		return nil
	}
	var count int64
	if err := db.Model(&models.AlertmanagerConfigVersion{}).
		Where("status = ?", models.AlertmanagerConfigStatusApplied).
		Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	now := time.Now()
	return db.Create(&models.AlertmanagerConfigVersion{
		Content:   DefaultAlertmanagerConfigContent,
		Checksum:  models.AlertmanagerConfigChecksum(DefaultAlertmanagerConfigContent),
		Status:    models.AlertmanagerConfigStatusApplied,
		AppliedAt: &now,
		AppliedBy: "system",
	}).Error
}

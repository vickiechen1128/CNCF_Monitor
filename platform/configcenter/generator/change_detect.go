package generator

import (
	"database/sql"
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// sourceTableScopes 声明参与源数据版本聚合的源表及其是否按网域过滤。
var sourceTableScopes = []struct {
	model       interface{}
	domainScoped bool
}{
	{&models.ScrapeJob{}, true},
	{&models.Host{}, true},
	{&models.Database{}, true},
	{&models.Middleware{}, true},
	{&models.Application{}, true},
	{&models.GenericTarget{}, true},
	// 第 6 类「接口服务」：资源行变更须推高 SourceDataVersion，否则变更检测静默不触发
	// （见实施计划高危点 H2）。
	{&models.InterfaceService{}, true},
	{&models.MonitoringRule{}, false},
	{&models.LabelTemplate{}, false},
	{&models.CITypeExporterMapping{}, false},
	// 决策 74 定稿：M08 通知渠道 / 模板经 M09 物化进管理域 alertmanager.yml
	// receivers 与桥渲染，纳入源数据版本聚合（渠道/模板变更须触发重算与变更检测）。
	{&models.NotifyChannel{}, false},
	{&models.NotifyTemplate{}, false},
	// 决策 113：M08「最小运行骨架自动布缆」的管理域单例设定（默认接收人）纳入源数据版本
	// 聚合——改本表须能触发管理域（default）重算。domainScoped=true 按网域过滤：仅管理域
	// 版本感知其变化，不对非管理域产生噪声变更（与 alertmanager.yml 恒属 default 一致）。
	{&models.AlertmanagerRouteSetting{}, true},
	// review-fix F3：ExporterInstallationConfirmation 移出源数据版本聚合。决策 47-1 已使其
	// 降级为「可选登记、非生成闸门」——ResolveJobTargets 不读取它，target 内容不受确认
	// 记录影响；登记/删除确认记录不再推高 SourceDataVersion、也不触发无谓变更检测预筛，
	// 从源头消除低频无谓轮询（审计用途由本表自身 updated_at 独立承载）。
}

// sourceVersionRow 是单表源数据版本聚合的一行两列结果。
// 两个字段均用 sql.NullString 承载：SQLite 的 MAX() 对「全表无该值」返回 NULL
// （deleted_at 在从未删除过时恒为 NULL），NullString 显式区分「NULL」与「空串」。
type sourceVersionRow struct {
	MaxUpdatedAt sql.NullString `gorm:"column:max_updated_at"`
	MaxDeletedAt sql.NullString `gorm:"column:max_deleted_at"`
}

// SourceDataVersion 聚合参与配置生成的各源表 max(updated_at) 与 max(deleted_at) 的较大值
// 为「源数据版本」（PRD §3.3.3 版本触发预筛）。无数据时返回空字符串。
//
// deleted_at 必须纳入：GORM 软删只写 deleted_at、不更新 updated_at，若只看 updated_at，
// 删除资源后版本纹丝不动，NeedsRegeneration 恒 false，变更检测永不产草稿（缺陷根因）。
//
// 两列聚合在同一条 SQL 中一次取回（每表仍只查一次，避免查询数翻倍），
// 再取二者的较大值参与全局 max。
//
// Unscoped：参与聚合的源表均内嵌 BaseModel（gorm.DeletedAt），GORM 默认追加
// deleted_at IS NULL 会把软删行整体过滤掉，deleted_at 聚合将恒为 NULL；
// 故此处显式解除软删作用域，使已软删行也进入聚合视野。
//
// SQLite 将时间以固定格式字符串存储，MAX() 亦返回字符串；因该字符串为
// 零填充 ISO 类格式可直接按字典序比较取最大，故这里对 *string 做比较而非
// 解析为 time.Time（避免 driver 类型转换错误）。空串小于任何时间串，天然被忽略。
func SourceDataVersion(db *gorm.DB, domainID string) (string, error) {
	var maxStr string
	for _, t := range sourceTableScopes {
		q := db.Model(t.model).
			Select("MAX(updated_at) AS max_updated_at, MAX(deleted_at) AS max_deleted_at").
			Unscoped()
		if t.domainScoped {
			q = q.Where("network_domain_id = ?", domainID)
		}
		var row sourceVersionRow
		if err := q.Scan(&row).Error; err != nil {
			return "", fmt.Errorf("aggregate source data version: %w", err)
		}
		for _, c := range []sql.NullString{row.MaxUpdatedAt, row.MaxDeletedAt} {
			if c.Valid && c.String > maxStr {
				maxStr = c.String
			}
		}
	}
	return maxStr, nil
}

// NeedsRegeneration 依据源数据版本（含 updated_at 与 deleted_at）是否较上次生成推进
// 来决定是否触发重算（版本未变化则跳过本轮，避免无谓轮询，PRD §3.3.3）。
func NeedsRegeneration(prevSourceVersion, newSourceVersion string) bool {
	if newSourceVersion == "" {
		return false
	}
	return prevSourceVersion == "" || newSourceVersion != prevSourceVersion
}
package generator

import (
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
	{&models.MonitoringRule{}, false},
	{&models.LabelTemplate{}, false},
	{&models.CITypeExporterMapping{}, false},
	// 决策 47-1：ExporterInstallationConfirmation 仍保留在基线表中（domainScoped=false），
	// 但已降级为「可选登记、非生成闸门」——ResolveJobTargets 不读取它，target 内容不受
	// 确认记录影响；登记/删除确认记录不产生配置实质变化（生成物 checksum 不变 → 自动丢弃，
	// 不计入漂移）。
	{&models.ExporterInstallationConfirmation{}, false},
}

// SourceDataVersion 聚合参与配置生成的各源表 max(updated_at) 为「源数据版本」
// （PRD §3.3.3 版本触发预筛）。无数据时返回空字符串。
//
// SQLite 将时间以固定格式字符串存储，MAX() 亦返回字符串；因该字符串为
// 零填充 ISO 类格式可直接按字典序比较取最大，故这里对 *string 做比较而非
// 解析为 time.Time（避免 driver 类型转换错误）。
func SourceDataVersion(db *gorm.DB, domainID string) (string, error) {
	var maxStr string
	for _, t := range sourceTableScopes {
		q := db.Model(t.model).Select("MAX(updated_at)")
		if t.domainScoped {
			q = q.Where("network_domain_id = ?", domainID)
		}
		var s *string
		if err := q.Scan(&s).Error; err != nil {
			return "", fmt.Errorf("aggregate source data version: %w", err)
		}
		if s != nil && *s > maxStr {
			maxStr = *s
		}
	}
	return maxStr, nil
}

// NeedsRegeneration 依据源数据版本是否较上次生成推进来决定是否触发重算
// （版本未变化则跳过本轮，避免无谓轮询，PRD §3.3.3）。
func NeedsRegeneration(prevSourceVersion, newSourceVersion string) bool {
	if newSourceVersion == "" {
		return false
	}
	return prevSourceVersion == "" || newSourceVersion != prevSourceVersion
}
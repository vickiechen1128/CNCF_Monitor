package seed

import (
	"fmt"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// ApplicationDict 首次启动数据种子（决策 92）：仅当 ApplicationDict 表为空时，
// 以存量资源的应用取值为基准生成字典条目——AppCode = 原值归一化（转小写、非
// [a-z0-9-] 字符替换为 -、合并连续 -、去首尾 -），AppName = 原值；之后 DB 为唯一
// 权威，本函数在 DB 非空时直接返回，绝不覆盖（幂等）。
//
// 物理列：Host 取 AppCode（列 app_code）；Middleware/Application/Database/
// GenericTarget 取 AppName（列 app_name，语义已切换为不可变编码）。存量取值已合规
// 时归一化是恒等变换，保证存量 app label 不断、时序不裂。
func ApplicationDict(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("seed application dict: nil database connection")
	}

	if !db.Migrator().HasTable(&models.ApplicationDict{}) {
		return nil // 目标表未建（部分迁移 / 最小化固件）→ 无可 seed，不阻断启动
	}

	var count int64
	if err := db.Model(&models.ApplicationDict{}).Count(&count).Error; err != nil {
		return fmt.Errorf("seed application dict: count: %w", err)
	}
	if count > 0 {
		return nil // DB 非空则不 seed（决策 92：之后不再覆盖）
	}

	// 收集各资源表的非空应用取值（物理列不同，由访问器收敛）。
	// 目标表不存在时跳过该表（部分迁移 / 最小化固件不阻断 seed，决策 92）。
	var rawValues []string
	collect := func(vals []string) {
		for _, v := range vals {
			if strings.TrimSpace(v) != "" {
				rawValues = append(rawValues, strings.TrimSpace(v))
			}
		}
	}

	if db.Migrator().HasTable(&models.Host{}) {
		var hosts []models.Host
		if err := db.Find(&hosts).Error; err != nil {
			return fmt.Errorf("seed application dict: scan hosts: %w", err)
		}
		for _, h := range hosts {
			collect([]string{h.AppCode})
		}
	}
	if db.Migrator().HasTable(&models.Middleware{}) {
		var mws []models.Middleware
		if err := db.Find(&mws).Error; err != nil {
			return fmt.Errorf("seed application dict: scan middlewares: %w", err)
		}
		for _, m := range mws {
			collect([]string{m.AppName})
		}
	}
	if db.Migrator().HasTable(&models.Application{}) {
		var apps []models.Application
		if err := db.Find(&apps).Error; err != nil {
			return fmt.Errorf("seed application dict: scan applications: %w", err)
		}
		for _, a := range apps {
			collect([]string{a.AppName})
		}
	}
	if db.Migrator().HasTable(&models.Database{}) {
		var dbs []models.Database
		if err := db.Find(&dbs).Error; err != nil {
			return fmt.Errorf("seed application dict: scan databases: %w", err)
		}
		for _, d := range dbs {
			if d.AppName != nil {
				collect([]string{*d.AppName})
			}
		}
	}
	if db.Migrator().HasTable(&models.GenericTarget{}) {
		var gts []models.GenericTarget
		if err := db.Find(&gts).Error; err != nil {
			return fmt.Errorf("seed application dict: scan generic targets: %w", err)
		}
		for _, g := range gts {
			if g.AppName != nil {
				collect([]string{*g.AppName})
			}
		}
	}

	// 按归一化后的 AppCode 去重，保留首个原始取值作为展示名。
	type pair struct {
		code string
		name string
	}
	seen := make(map[string]bool)
	entries := make([]pair, 0)
	for _, raw := range rawValues {
		code := models.NormalizeAppCode(raw)
		if code == "" || seen[code] {
			continue
		}
		seen[code] = true
		entries = append(entries, pair{code: code, name: raw})
	}

	for _, e := range entries {
		row := models.ApplicationDict{
			AppCode:     e.code,
			AppName:     e.name,
			Description: "存量迁移自动生成",
			Status:      models.AppStatusEnabled,
		}
		if err := db.Create(&row).Error; err != nil {
			return fmt.Errorf("seed application dict %q: %w", e.code, err)
		}
	}
	return nil
}

package seed

import (
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// runLabelTemplates seeds one default LabelTemplate per resource category,
// using the canonical field→label mappings (resource_id→resource_id,
// biz_code→biz, instance_ip:port→instance).
// Aligned with Module_07 §5.10~§5.13. Idempotent via "name = ?" upsert.
func runLabelTemplates(db *gorm.DB) error {
	categories := models.ValidResourceCategories()
	for _, cat := range categories {
		tmpl := &models.LabelTemplate{
			Name:             "default-" + string(cat),
			ResourceCategory: cat,
			IsDefault:        true,
			Mappings:         models.DefaultMappingBuilders(cat),
		}
		if err := firstOrCreate(db, tmpl, "name = ?", tmpl.Name); err != nil {
			return err
		}
		if err := ensureResourceIDMapping(db, tmpl.Name); err != nil {
			return err
		}
	}
	return nil
}

// ensureResourceIDMapping 是存量库的一次性修正（2026-09-02，决策 47-3 coverage
// 回连前置，Module_07 v2.25 / Module_01 v3.29）：默认模板有只读保护、用户无法经
// UI 补映射，因此种子需把缺失的 resource_id → resource_id 稳定身份映射补进
// 已存在的 default-* 模板；已有该映射时幂等跳过。
func ensureResourceIDMapping(db *gorm.DB, name string) error {
	var tmpl models.LabelTemplate
	if err := db.Where("name = ?", name).First(&tmpl).Error; err != nil {
		return fmt.Errorf("load default label template %q: %w", name, err)
	}
	for _, m := range tmpl.Mappings {
		if m.TargetLabel == "resource_id" {
			return nil
		}
	}
	tmpl.Mappings = append([]models.LabelMapping{{
		SourceField: "resource_id",
		SourceType:  models.LabelSourceTypeResourceField,
		TargetLabel: "resource_id",
		Enabled:     true,
	}}, tmpl.Mappings...)
	if err := db.Save(&tmpl).Error; err != nil {
		return fmt.Errorf("backfill resource_id mapping for %q: %w", name, err)
	}
	return nil
}

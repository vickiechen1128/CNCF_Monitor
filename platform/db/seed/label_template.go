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
		// 决策 115：platform 五类全覆盖；svc 仅 application / generic_target（决策 105）。
		if err := ensurePlatformMapping(db, tmpl.Name); err != nil {
			return err
		}
		if cat == models.ResourceCategoryApplication || cat == models.ResourceCategoryGenericTarget {
			if err := ensureSVCMapping(db, tmpl.Name); err != nil {
				return err
			}
		}
	}
	return nil
}

// ensurePlatformMapping 把 platform_code → platform 映射补进已存在的默认模板
//（决策 110 / 115，PRD §5.12.1）：默认模板只读、用户无法经 UI 补映射，故由种子
// 回填；已有 platform 映射时幂等跳过，既有映射顺序与内容保持不变（仅追加）。
func ensurePlatformMapping(db *gorm.DB, name string) error {
	return ensureLabelMapping(db, name, models.LabelMapping{
		SourceField: "platform_code",
		SourceType:  models.LabelSourceTypeResourceField,
		TargetLabel: "platform",
		Enabled:     true,
	})
}

// ensureSVCMapping 把 service_code → svc 映射补进已存在的默认模板（决策 105 /
// 115，PRD §5.13）。仅对 application / generic_target 调用——host / database /
// middleware 属基础设施，不挂服务维度。语义同 ensurePlatformMapping。
func ensureSVCMapping(db *gorm.DB, name string) error {
	return ensureLabelMapping(db, name, models.LabelMapping{
		SourceField: "service_code",
		SourceType:  models.LabelSourceTypeResourceField,
		TargetLabel: "svc",
		Enabled:     true,
	})
}

// ensureLabelMapping 是默认标签模板映射回填的通用原语（决策 115 通用规约）：
// 按 target_label 判存，缺失时追加到映射末尾并保存；已存在时直接返回，保证幂等。
func ensureLabelMapping(db *gorm.DB, name string, mapping models.LabelMapping) error {
	var tmpl models.LabelTemplate
	if err := db.Where("name = ?", name).First(&tmpl).Error; err != nil {
		return fmt.Errorf("load default label template %q: %w", name, err)
	}
	for _, m := range tmpl.Mappings {
		if m.TargetLabel == mapping.TargetLabel {
			return nil
		}
	}
	tmpl.Mappings = append(tmpl.Mappings, mapping)
	if err := db.Save(&tmpl).Error; err != nil {
		return fmt.Errorf("backfill %s mapping for %q: %w", mapping.TargetLabel, name, err)
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

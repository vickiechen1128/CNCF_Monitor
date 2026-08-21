package seed

import (
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// runLabelTemplates seeds one default LabelTemplate per resource category,
// using the canonical field→label mappings (biz_code→biz, instance_ip:port→instance).
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
	}
	return nil
}
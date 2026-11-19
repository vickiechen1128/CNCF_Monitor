package seed

import (
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// runLabelTemplates 删除预置默认模板；系统注入标签由生成器负责，自定义模板由用户维护。
func runLabelTemplates(db *gorm.DB) error {
	if err := db.Unscoped().Where("is_default = ?", true).Delete(&models.LabelTemplate{}).Error; err != nil {
		return fmt.Errorf("remove default label templates: %w", err)
	}
	return nil
}

package label

import (
	"fmt"
	"reflect"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// MappingBatchRepository 封装整组映射与修改快照的事务写入。
type MappingBatchRepository struct {
	db *gorm.DB
}

// NewMappingBatchRepository 创建整组映射仓储。
func NewMappingBatchRepository(db *gorm.DB) *MappingBatchRepository {
	return &MappingBatchRepository{db: db}
}

func (r *MappingBatchRepository) getTemplate(templateID uint) (*models.LabelTemplate, error) {
	var tmpl models.LabelTemplate
	if err := r.db.First(&tmpl, templateID).Error; err != nil {
		return nil, err
	}
	return &tmpl, nil
}

func (r *MappingBatchRepository) replaceMappings(templateID uint, mappings []models.LabelMapping) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var tmpl models.LabelTemplate
		if err := tx.First(&tmpl, templateID).Error; err != nil {
			return err
		}
		if tmpl.IsDefault {
			return ErrDefaultTemplateMappingReadOnly
		}
		changes := diffMappingChanges(tmpl.Mappings, mappings)
		if len(changes) == 0 {
			return nil
		}
		tmpl.Mappings = mappings
		if err := tx.Save(&tmpl).Error; err != nil {
			return fmt.Errorf("replace mappings of label template %d: %w", templateID, err)
		}
		if err := appendTemplateSnapshot(tx, templateID, changes); err != nil {
			return fmt.Errorf("append label template snapshot: %w", err)
		}
		return nil
	})
}

func diffMappingChanges(oldMappings, newMappings []models.LabelMapping) []models.MappingChange {
	maxLen := len(oldMappings)
	if len(newMappings) > maxLen {
		maxLen = len(newMappings)
	}
	changes := make([]models.MappingChange, 0, maxLen)
	for i := 0; i < maxLen; i++ {
		var oldValue, newValue *models.LabelMapping
		if i < len(oldMappings) {
			old := oldMappings[i]
			oldValue = &old
		}
		if i < len(newMappings) {
			newMapping := newMappings[i]
			newValue = &newMapping
		}
		if oldValue != nil && newValue != nil && reflect.DeepEqual(*oldValue, *newValue) {
			continue
		}
		targetLabel := ""
		if newValue != nil {
			targetLabel = newValue.TargetLabel
		} else {
			targetLabel = oldValue.TargetLabel
		}
		changes = append(changes, models.MappingChange{
			TargetLabel: targetLabel,
			OldValue:    oldValue,
			NewValue:    newValue,
		})
	}
	return changes
}

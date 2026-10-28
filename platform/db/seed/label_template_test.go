package seed

import (
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRunLabelTemplatesRemovesOnlyDefaultTemplates(t *testing.T) {
	db := newTestDB(t)
	for _, cat := range models.ValidResourceCategories() {
		require.NoError(t, db.Create(&models.LabelTemplate{
			Name: "default-" + string(cat), ResourceCategory: cat, IsDefault: true,
			Mappings: models.DefaultMappingBuilders(cat),
		}).Error)
	}
	custom := &models.LabelTemplate{
		Name: "custom-application", ResourceCategory: models.ResourceCategoryApplication,
		IsDefault: false, Mappings: []models.LabelMapping{{
			SourceField: "owner1", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "owner1", Enabled: true,
		}},
	}
	require.NoError(t, db.Create(custom).Error)

	require.NoError(t, runLabelTemplates(db))
	require.NoError(t, runLabelTemplates(db))

	var defaults int64
	require.NoError(t, db.Unscoped().Model(&models.LabelTemplate{}).Where("is_default = ?", true).Count(&defaults).Error)
	assert.Zero(t, defaults)
	var customCount int64
	require.NoError(t, db.Model(&models.LabelTemplate{}).Where("name = ?", custom.Name).Count(&customCount).Error)
	assert.EqualValues(t, 1, customCount)
}

package label

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func mountMappingBatch(t *testing.T, db *gorm.DB) *gin.Engine {
	t.Helper()
	r := newGin()
	svc := NewMappingBatchService(NewMappingBatchRepository(db))
	r.PUT("/api/v2/platform/label-templates/:template_id/mappings", ReplaceLabelMappings(svc))
	return r
}

func TestReplaceLabelMappingsBatchSuccess(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountMappingBatch(t, db)
	tmpl := seedMappingTemplate(t, db)
	tmpl.Mappings = append(tmpl.Mappings, models.LabelMapping{
		SourceField: "env", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "env", Enabled: true,
	})
	require.NoError(t, db.Save(&tmpl).Error)

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings", tmpl.ID)
	body := `{"mappings":[` +
		`{"source_type":"resource_field","source_field":"app_code","target_label":"application","transform_rule":"dict","enabled":false},` +
		`{"source_type":"resource_field","source_field":"biz_code","target_label":"biz","enabled":true},` +
		`{"source_type":"resource_field","source_field":"cluster","target_label":"cluster","enabled":true}` +
		`]}`
	code, mappings := decodeMappings(t, doJSON(t, r, http.MethodPut, path, body))
	require.Equal(t, http.StatusOK, code)
	require.Len(t, mappings, 3)
	assert.Equal(t, "application", mappings[0].TargetLabel)
	assert.False(t, mappings[0].Enabled)
	assert.Equal(t, models.LabelTransformDict, mappings[0].Transform)
	assert.Equal(t, "biz", mappings[1].TargetLabel)
	assert.Equal(t, "cluster", mappings[2].TargetLabel)

	var got models.LabelTemplate
	require.NoError(t, db.First(&got, tmpl.ID).Error)
	require.Len(t, got.Mappings, 3)
	assert.Equal(t, int64(1), countSnapshots(t, db, tmpl.ID))
	snap := lastSnapshot(t, db, tmpl.ID)
	require.Len(t, snap.ChangedMappings, 3)
	assert.Equal(t, "application", snap.ChangedMappings[0].TargetLabel)
	assert.Equal(t, "app", snap.ChangedMappings[0].OldValue.TargetLabel)
	assert.Equal(t, "application", snap.ChangedMappings[0].NewValue.TargetLabel)
	assert.Equal(t, "biz", snap.ChangedMappings[1].TargetLabel)
	assert.Equal(t, "env", snap.ChangedMappings[1].OldValue.TargetLabel)
	assert.Equal(t, "biz", snap.ChangedMappings[1].NewValue.TargetLabel)
	assert.Equal(t, "cluster", snap.ChangedMappings[2].TargetLabel)
	assert.Nil(t, snap.ChangedMappings[2].OldValue)
}

func TestReplaceLabelMappingsAllowsEmptyList(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountMappingBatch(t, db)
	tmpl := seedMappingTemplate(t, db)
	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings", tmpl.ID)

	code, mappings := decodeMappings(t, doJSON(t, r, http.MethodPut, path, `{"mappings":[]}`))
	require.Equal(t, http.StatusOK, code)
	assert.NotNil(t, mappings)
	assert.Empty(t, mappings)

	var got models.LabelTemplate
	require.NoError(t, db.First(&got, tmpl.ID).Error)
	assert.NotNil(t, got.Mappings)
	assert.Empty(t, got.Mappings)
}

func TestReplaceLabelMappingsNoopDoesNotWriteSnapshot(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountMappingBatch(t, db)
	tmpl := seedMappingTemplate(t, db)
	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings", tmpl.ID)

	code, mappings := decodeMappings(t, doJSON(t, r, http.MethodPut, path,
		`{"mappings":[{"source_type":"resource_field","source_field":"app_code","target_label":"app","transform_rule":"","enabled":true}]}`))
	require.Equal(t, http.StatusOK, code)
	require.Len(t, mappings, 1)
	assert.Equal(t, int64(0), countSnapshots(t, db, tmpl.ID))
}

func TestReplaceLabelMappingsValidation(t *testing.T) {
	tests := []struct {
		name string
		body string
		want string
	}{
		{name: "missing mappings", body: `{}`, want: "mappings"},
		{name: "protected label", body: `{"mappings":[{"source_type":"resource_field","source_field":"env","target_label":"job"}]}`, want: "保护"},
		{name: "duplicate label", body: `{"mappings":[{"source_type":"resource_field","source_field":"env","target_label":"same"},{"source_type":"resource_field","source_field":"cluster","target_label":"same"}]}`, want: "重复"},
		{name: "invalid dict source", body: `{"mappings":[{"source_type":"resource_field","source_field":"os_type","target_label":"os","transform_rule":"dict"}]}`, want: "不支持字典翻译"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := openCRUDTestDB(t)
			r := mountMappingBatch(t, db)
			tmpl := seedMappingTemplate(t, db)
			path := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings", tmpl.ID)
			code, e := decodeErr(t, doJSON(t, r, http.MethodPut, path, tt.body))
			assert.Equal(t, http.StatusBadRequest, code)
			assert.Equal(t, response.ErrorTypeBadRequest, e.ErrorType)
			assert.Contains(t, e.Error, tt.want)
			assert.Equal(t, int64(0), countSnapshots(t, db, tmpl.ID))
		})
	}
}

func TestReplaceLabelMappingsDefaultTemplateAndNotFound(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountMappingBatch(t, db)
	def := seedDefaultMappingTemplate(t, db)
	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings", def.ID)
	code, e := decodeErr(t, doJSON(t, r, http.MethodPut, path, `{"mappings":[]}`))
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Contains(t, e.Error, "默认模板")

	code, e = decodeErr(t, doJSON(t, r, http.MethodPut,
		"/api/v2/platform/label-templates/99999/mappings", `{"mappings":[]}`))
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, response.ErrorTypeNotFound, e.ErrorType)
}

func TestReplaceLabelMappingsRollbackOnSnapshotFailure(t *testing.T) {
	db := openRollbackTestDB(t)
	r := mountMappingBatch(t, db)
	tmpl := seedMappingTemplate(t, db)
	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings", tmpl.ID)

	code, _ := decodeErr(t, doJSON(t, r, http.MethodPut, path,
		`{"mappings":[{"source_type":"resource_field","source_field":"env","target_label":"env"}]}`))
	require.Equal(t, http.StatusInternalServerError, code)
	var got models.LabelTemplate
	require.NoError(t, db.First(&got, tmpl.ID).Error)
	require.Len(t, got.Mappings, 1)
	assert.Equal(t, "app", got.Mappings[0].TargetLabel)
}

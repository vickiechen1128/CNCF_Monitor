package seed

import (
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// legacyLabelMappingSet 返回 2026-10-03 之前存量库里 default-* 模板实际持有的
// 旧映射集（决策 115 证据 ①）：无 platform_code→platform、无 service_code→svc。
// application 另有 service_name / health_check_url。
func legacyLabelMappingSet(cat models.ResourceCategory) []models.LabelMapping {
	if cat == models.ResourceCategoryApplication {
		return []models.LabelMapping{
			{SourceField: "resource_id", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "resource_id", Enabled: true},
			{SourceField: "service_name", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "service_name", Enabled: true},
			{SourceField: "app_code", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "app", Enabled: true},
			{SourceField: "env", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "env", Enabled: true},
			{SourceField: "cluster", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "cluster", Enabled: true},
			{SourceField: "biz_code", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "biz", Enabled: true},
			{SourceField: "health_check_url", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "health_check_url", Enabled: true},
		}
	}
	return []models.LabelMapping{
		{SourceField: "instance_ip:port", SourceType: models.LabelSourceTypeComposite, TargetLabel: "instance", Enabled: true},
		{SourceField: "resource_id", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "resource_id", Enabled: true},
		{SourceField: "app_code", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "app", Enabled: true},
		{SourceField: "env", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "env", Enabled: true},
		{SourceField: "cluster", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "cluster", Enabled: true},
		{SourceField: "biz_code", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "biz", Enabled: true},
	}
}

// seedLegacyLabelTemplates 预置「旧版 default-* 模板」模拟存量库（5 条全量，
// 均缺 platform；application / generic_target 另缺 svc）。
func seedLegacyLabelTemplates(t *testing.T, db *gorm.DB) {
	t.Helper()
	for _, cat := range models.ValidResourceCategories() {
		require.NoError(t, db.Create(&models.LabelTemplate{
			Name:             "default-" + string(cat),
			ResourceCategory: cat,
			IsDefault:        true,
			Mappings:         legacyLabelMappingSet(cat),
		}).Error)
	}
}

// loadLabelTemplate 按名称读取模板。
func loadLabelTemplate(t *testing.T, db *gorm.DB, name string) models.LabelTemplate {
	t.Helper()
	var tmpl models.LabelTemplate
	require.NoError(t, db.Where("name = ?", name).First(&tmpl).Error)
	return tmpl
}

// countTargetLabel 统计模板中映射到指定目标标签的条目数。
func countTargetLabel(mappings []models.LabelMapping, target string) int {
	n := 0
	for _, m := range mappings {
		if m.TargetLabel == target {
			n++
		}
	}
	return n
}

// TestRunLabelTemplatesBackfillsPlatformAndSVC 覆盖**存量库路径**（决策 115 防回归）：
// 预置旧版 default-* 模板后跑种子，五类均应补出 platform_code→platform，
// application / generic_target 应补出 service_code→svc，
// 而 host / database / middleware 不得出现 svc（决策 105：基础设施不挂服务维度）。
func TestRunLabelTemplatesBackfillsPlatformAndSVC(t *testing.T) {
	db := newTestDB(t)
	seedLegacyLabelTemplates(t, db)

	require.NoError(t, runLabelTemplates(db))

	for _, cat := range models.ValidResourceCategories() {
		name := "default-" + string(cat)
		tmpl := loadLabelTemplate(t, db, name)
		assert.Equal(t, 1, countTargetLabel(tmpl.Mappings, "platform"),
			"%s 应补出唯一的 platform 映射", name)
	}

	for _, cat := range []models.ResourceCategory{
		models.ResourceCategoryApplication, models.ResourceCategoryGenericTarget,
	} {
		name := "default-" + string(cat)
		tmpl := loadLabelTemplate(t, db, name)
		assert.Equal(t, 1, countTargetLabel(tmpl.Mappings, "svc"),
			"%s 应补出唯一的 svc 映射", name)
	}

	for _, cat := range []models.ResourceCategory{
		models.ResourceCategoryHost, models.ResourceCategoryDatabase, models.ResourceCategoryMiddleware,
	} {
		name := "default-" + string(cat)
		tmpl := loadLabelTemplate(t, db, name)
		assert.Equal(t, 0, countTargetLabel(tmpl.Mappings, "svc"),
			"%s 属基础设施，不应注入 svc 映射", name)
	}
}

// TestRunLabelTemplatesBackfillPreservesLegacyMappings 保证回填是「追加」而非重写：
// 既有映射（application 的 service_name / health_check_url、非 application 的
// composite instance）及其顺序均保留，新增行 Enabled=true。
func TestRunLabelTemplatesBackfillPreservesLegacyMappings(t *testing.T) {
	db := newTestDB(t)
	seedLegacyLabelTemplates(t, db)

	require.NoError(t, runLabelTemplates(db))

	host := loadLabelTemplate(t, db, "default-host")
	legacyHost := legacyLabelMappingSet(models.ResourceCategoryHost)
	require.Equal(t, legacyHost, host.Mappings[:len(legacyHost)],
		"default-host 的旧映射应原样保留在前，新映射追加在后")
	for _, m := range host.Mappings[len(legacyHost):] {
		assert.True(t, m.Enabled, "回填的映射 %s 应默认启用", m.TargetLabel)
	}

	app := loadLabelTemplate(t, db, "default-application")
	legacyApp := legacyLabelMappingSet(models.ResourceCategoryApplication)
	require.Equal(t, legacyApp, app.Mappings[:len(legacyApp)],
		"default-application 的旧映射应原样保留在前")
	for _, target := range []string{"service_name", "health_check_url"} {
		assert.Equal(t, 1, countTargetLabel(app.Mappings, target),
			"default-application 应保留 %s 映射", target)
	}
}

// TestRunLabelTemplatesBackfillIdempotent 保证重复执行种子不会重复追加映射。
func TestRunLabelTemplatesBackfillIdempotent(t *testing.T) {
	db := newTestDB(t)
	seedLegacyLabelTemplates(t, db)

	require.NoError(t, runLabelTemplates(db))
	require.NoError(t, runLabelTemplates(db))
	require.NoError(t, Run(db)) // 完整种子入口同样幂等

	var total int64
	countRows(t, db, &models.LabelTemplate{}, &total)
	assert.Equal(t, int64(len(models.ValidResourceCategories())), total,
		"存量模板不应被重复创建")

	for _, cat := range models.ValidResourceCategories() {
		name := "default-" + string(cat)
		tmpl := loadLabelTemplate(t, db, name)
		assert.Equal(t, 1, countTargetLabel(tmpl.Mappings, "platform"),
			"%s 的 platform 映射重复执行后仍应为 1 条", name)
		switch cat {
		case models.ResourceCategoryApplication, models.ResourceCategoryGenericTarget:
			assert.Equal(t, 1, countTargetLabel(tmpl.Mappings, "svc"),
				"%s 的 svc 映射重复执行后仍应为 1 条", name)
		default:
			assert.Equal(t, 0, countTargetLabel(tmpl.Mappings, "svc"),
				"%s 不应出现 svc 映射", name)
		}
	}
}

// TestEnsurePlatformMappingAndSVCMappingAppendOnce 在单个模板上直接验证两个
// 回填函数的追加语义与源字段 / 源类型契约（PRD §5.12.1 / §5.13）。
func TestEnsurePlatformMappingAndSVCMappingAppendOnce(t *testing.T) {
	db := newTestDB(t)
	require.NoError(t, db.Create(&models.LabelTemplate{
		Name:             "default-middleware",
		ResourceCategory: models.ResourceCategoryMiddleware,
		IsDefault:        true,
		Mappings:         legacyLabelMappingSet(models.ResourceCategoryMiddleware),
	}).Error)

	require.NoError(t, ensurePlatformMapping(db, "default-middleware"))
	require.NoError(t, ensurePlatformMapping(db, "default-middleware")) // 幂等

	tmpl := loadLabelTemplate(t, db, "default-middleware")
	require.Equal(t, 1, countTargetLabel(tmpl.Mappings, "platform"))
	platform := tmpl.Mappings[len(tmpl.Mappings)-1]
	assert.Equal(t, "platform_code", platform.SourceField)
	assert.Equal(t, models.LabelSourceTypeResourceField, platform.SourceType)
	assert.True(t, platform.Enabled)

	// svc 由决策 105 限定为 application / generic_target，此处仅验证函数语义。
	require.NoError(t, ensureSVCMapping(db, "default-middleware"))
	require.NoError(t, ensureSVCMapping(db, "default-middleware"))
	tmpl = loadLabelTemplate(t, db, "default-middleware")
	require.Equal(t, 1, countTargetLabel(tmpl.Mappings, "svc"))
	svc := tmpl.Mappings[len(tmpl.Mappings)-1]
	assert.Equal(t, "service_code", svc.SourceField)
	assert.Equal(t, models.LabelSourceTypeResourceField, svc.SourceType)
	assert.True(t, svc.Enabled)
}

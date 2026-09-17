package label

import (
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// hostDefaultTemplate 构造 Module_07 §5.13 主机默认标签模板的完整映射集。
// 说明：models.DefaultMappingBuilders 仅返回共享的 common 映射（composite→instance
// 与 app/env/cluster/biz），hostname/instance_name/os_type 等主机差异化映射在此显式
// 补齐，用于验证生成器对 legacy 列（hostname/instance_name→InstanceName、
// os_type→Image）的取值。
func hostDefaultTemplate() *models.LabelTemplate {
	return &models.LabelTemplate{
		Name:             "主机默认模板",
		ResourceCategory: models.ResourceCategoryHost,
		IsDefault:        true,
		Mappings: []models.LabelMapping{
			{SourceField: "instance_ip:port", SourceType: models.LabelSourceTypeComposite, TargetLabel: "instance", Enabled: true},
			{SourceField: "app_name", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "app", Enabled: true},
			{SourceField: "env", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "env", Enabled: true},
			{SourceField: "cluster", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "cluster", Enabled: true},
			{SourceField: "biz_code", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "biz", Enabled: true},
			{SourceField: "hostname", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "hostname", Enabled: true},
			{SourceField: "instance_name", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "instance_name", Enabled: true},
			{SourceField: "os_type", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "os_type", Enabled: true},
		},
	}
}

// sampleHost 构造一个 legacy 列齐全的 Host fixture：app_name/env/cluster/hostname/
// os_type 均通过 GetResourceField 的 legacy 映射（AppCode/EnvFlag/SubAppCode/
// InstanceName/Image）读取。
func sampleHost() *models.Host {
	return &models.Host{
		ResourceID:       "host-1",
		ServerID:         "host-1",
		ResourceCategory: models.ResourceCategoryHost,
		NetworkDomainID:  "default",
		BizCode:          "payment",
		SourceType:       models.SourceTypeManual,
		AppCode:          "payment-api",
		SubAppCode:       "cluster-a",
		EnvFlag:          "prod",
		InstanceName:     "web-01.example.com",
		Status:           "online",
		Image:            "linux",
		PrivateIP:        "10.0.0.1",
		Region:           "cn",
		ZoneEnv:          "prod",
		InstanceSpec:     "2c4g",
		VPC:              "vpc-1",
		SecurityGroup:    "sg-1",
	}
}

// labelsByKey 将 []SystemLabel 索引为 key → SystemLabel 便于断言。
func labelsByKey(t *testing.T, labels []SystemLabel) map[string]SystemLabel {
	t.Helper()
	got := make(map[string]SystemLabel, len(labels))
	for _, l := range labels {
		got[l.Key] = l
	}
	return got
}

// TestComputeSystemLabelsHostDefaultTemplate 覆盖 §5.13 主机默认模板计算：
// app/env/cluster/biz/hostname/instance_name/os_type 经 legacy 映射取值，
// composite→instance 为内置默认（本阶段 Value 为空，由 M09 生成配置时拼接）。
func TestComputeSystemLabelsHostDefaultTemplate(t *testing.T) {
	labels := ComputeSystemLabels(hostDefaultTemplate(), sampleHost())
	got := labelsByKey(t, labels)

	assert.Equal(t, "payment-api", got["app"].Value)
	assert.Equal(t, "prod", got["env"].Value)
	assert.Equal(t, "cluster-a", got["cluster"].Value)
	assert.Equal(t, "payment", got["biz"].Value)
	assert.Equal(t, "web-01.example.com", got["hostname"].Value)
	assert.Equal(t, "web-01.example.com", got["instance_name"].Value)
	assert.Equal(t, "linux", got["os_type"].Value)
	assert.Equal(t, "", got["instance"].Value, "composite→instance 本阶段不生成拼接值（§5.12 C）")
}

// TestComputeSystemLabelsSourceMap 覆盖 source_map 标注：resource_field 为
// 「来源字段→目标标签」，composite→instance 附加「内置默认」标注（§5.13/§5.3）。
func TestComputeSystemLabelsSourceMap(t *testing.T) {
	labels := ComputeSystemLabels(hostDefaultTemplate(), sampleHost())
	got := labelsByKey(t, labels)

	assert.Equal(t, "app_name→app", got["app"].SourceMap)
	assert.Equal(t, "env→env", got["env"].SourceMap)
	assert.Equal(t, "cluster→cluster", got["cluster"].SourceMap)
	assert.Equal(t, "biz_code→biz", got["biz"].SourceMap)
	assert.Equal(t, "hostname→hostname", got["hostname"].SourceMap)
	assert.Equal(t, "os_type→os_type", got["os_type"].SourceMap)
	assert.Equal(t, "instance_ip:port→instance（内置默认）", got["instance"].SourceMap)
}

// TestComputeSystemLabelsApplicationTemplate 覆盖 §5.13 应用服务默认模板：
// service_name/biz 等；application 默认模板不含组合字段，不产出 instance。
func TestComputeSystemLabelsApplicationTemplate(t *testing.T) {
	template := &models.LabelTemplate{
		Name:             "应用服务默认模板",
		ResourceCategory: models.ResourceCategoryApplication,
		IsDefault:        true,
		Mappings: []models.LabelMapping{
			{SourceField: "service_name", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "service_name", Enabled: true},
			{SourceField: "app_name", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "app", Enabled: true},
			{SourceField: "env", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "env", Enabled: true},
			{SourceField: "cluster", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "cluster", Enabled: true},
			{SourceField: "biz_code", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "biz", Enabled: true},
			{SourceField: "health_check_url", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "health_check_url", Enabled: true},
		},
	}
	res := &models.Application{
		ResourceID:       "app-1",
		ResourceCategory: models.ResourceCategoryApplication,
		NetworkDomainID:  "default",
		BizCode:          "payment",
		SourceType:       models.SourceTypeManual,
		ServiceName:      "order-svc",
		AppName:          "order-svc",
		Env:              "staging",
		Cluster:          "cluster-b",
		Status:           "online",
		HealthCheckURL:   "http://10.0.0.5:8080/healthz",
	}

	labels := ComputeSystemLabels(template, res)
	got := labelsByKey(t, labels)

	assert.Equal(t, "order-svc", got["service_name"].Value)
	assert.Equal(t, "order-svc", got["app"].Value)
	assert.Equal(t, "staging", got["env"].Value)
	assert.Equal(t, "cluster-b", got["cluster"].Value)
	assert.Equal(t, "payment", got["biz"].Value)
	assert.Equal(t, "http://10.0.0.5:8080/healthz", got["health_check_url"].Value)
	assert.NotContains(t, got, "instance", "application 默认模板不含组合字段（§5.13）")
}

// TestComputeSystemLabelsSeedDefaultMappings 验证 models.DefaultMappingBuilders
// 生成的共享默认映射（seed 实际落库的模板）能正常计算 resource_id/app/env/cluster/biz/instance。
func TestComputeSystemLabelsSeedDefaultMappings(t *testing.T) {
	template := &models.LabelTemplate{
		Name:             "主机默认模板",
		ResourceCategory: models.ResourceCategoryHost,
		IsDefault:        true,
		Mappings:         models.DefaultMappingBuilders(models.ResourceCategoryHost),
	}
	labels := ComputeSystemLabels(template, sampleHost())
	got := labelsByKey(t, labels)

	assert.Equal(t, "payment-api", got["app"].Value)
	assert.Equal(t, "prod", got["env"].Value)
	assert.Equal(t, "cluster-a", got["cluster"].Value)
	assert.Equal(t, "payment", got["biz"].Value)
	assert.Equal(t, "", got["instance"].Value)
	assert.NotEmpty(t, got["resource_id"].Value, "默认模板必须产出 resource_id 稳定身份标签（47-3 回连键）")
	require.Len(t, labels, 6)
}

// TestComputeSystemLabelsSkipsEmptyValues 覆盖空值跳过：host 的 app_name
// （AppCode）与 cluster（SubAppCode）为空时不注入 app/cluster 标签（§5.15 规则 4 /
// §5.2 host 可空），非空字段照常注入。
func TestComputeSystemLabelsSkipsEmptyValues(t *testing.T) {
	host := sampleHost()
	host.AppCode = ""
	host.SubAppCode = ""

	labels := ComputeSystemLabels(hostDefaultTemplate(), host)
	got := labelsByKey(t, labels)

	assert.NotContains(t, got, "app")
	assert.NotContains(t, got, "cluster")
	assert.Equal(t, "payment", got["biz"].Value, "biz 非空仍注入")
	assert.Equal(t, "web-01.example.com", got["hostname"].Value)
}

// TestComputeSystemLabelsSkipsUnknownAndNonProcessedSources 覆盖：未知来源字段
// （GetResourceField 未映射）、disabled 映射、prometheus_builtin / cmdb_field
// 预留来源一律不产出 system 标签。
func TestComputeSystemLabelsSkipsUnknownAndNonProcessedSources(t *testing.T) {
	template := &models.LabelTemplate{
		Name:             "混合模板",
		ResourceCategory: models.ResourceCategoryHost,
		IsDefault:        false,
		Mappings: []models.LabelMapping{
			// 未知来源字段：GetResourceField 未映射 → 跳过。
			{SourceField: "no_such_field", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "unknown", Enabled: true},
			// disabled 映射跳过。
			{SourceField: "biz_code", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "biz", Enabled: false},
			// prometheus_builtin / cmdb_field 本阶段跳过（v0.2+ / v0.4+ 预留，§5.12 B）。
			{SourceField: "__address__", SourceType: models.LabelSourceTypePrometheusBuiltin, TargetLabel: "__address__", Enabled: true},
			{SourceField: "cmdb_business_path", SourceType: models.LabelSourceTypeCMDB, TargetLabel: "cmdb_business_path", Enabled: true},
		},
	}

	labels := ComputeSystemLabels(template, sampleHost())
	assert.Empty(t, labels, "未映射/未启用/预留来源的映射均不产出 system 标签")
}

// TestComputeSystemLabelsNilInputs 覆盖模板或资源为 nil 时返回空切片（不 panic）。
func TestComputeSystemLabelsNilInputs(t *testing.T) {
	assert.Nil(t, ComputeSystemLabels(nil, sampleHost()))
	assert.Nil(t, ComputeSystemLabels(hostDefaultTemplate(), nil))
	assert.Nil(t, ComputeSystemLabels(nil, nil))
}

// TestGetApplicableTemplateReturnsDefault 覆盖「适用模板」查询命中：返回该类型
// is_default=true 模板（名 + ID）。
func TestGetApplicableTemplateReturnsDefault(t *testing.T) {
	db := openTestDB(t)
	tmpl := &models.LabelTemplate{
		Name:             "主机默认模板",
		ResourceCategory: models.ResourceCategoryHost,
		IsDefault:        true,
		Mappings:         models.DefaultMappingBuilders(models.ResourceCategoryHost),
	}
	seedTemplates(t, db, tmpl)

	got, err := GetApplicableTemplate(db, models.ResourceCategoryHost)
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "主机默认模板", got.Name)
	assert.Equal(t, tmpl.ID, got.ID)
	assert.True(t, got.IsDefault)
}

// TestGetApplicableTemplateNone 覆盖无默认模板时返回可读空态错误；同类型仅有非
// 默认模板时同样视为「无默认模板」。
func TestGetApplicableTemplateNone(t *testing.T) {
	db := openTestDB(t)
	seedTemplates(t, db, &models.LabelTemplate{
		Name:             "自定义主机模板",
		ResourceCategory: models.ResourceCategoryHost,
		IsDefault:        false,
	})

	got, err := GetApplicableTemplate(db, models.ResourceCategoryDatabase)
	require.Error(t, err)
	assert.Nil(t, got)
	assert.Contains(t, err.Error(), "暂无默认标签模板")

	// 同类型仅有非默认模板：同样返回空态错误。
	got, err = GetApplicableTemplate(db, models.ResourceCategoryHost)
	require.Error(t, err)
	assert.Nil(t, got)
	assert.Contains(t, err.Error(), "暂无默认标签模板")
}

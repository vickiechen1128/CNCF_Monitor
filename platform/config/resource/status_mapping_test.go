package resource

import (
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestMapStatusDefaultChineseMappings 覆盖 §5.5.1 三种中文状态映射。
func TestMapStatusDefaultChineseMappings(t *testing.T) {
	cases := []struct {
		source string
		want   models.ResourceStatus
	}{
		{"运行中", models.ResourceStatusOnline},
		{"正常", models.ResourceStatusOnline},
		{"已停止", models.ResourceStatusOffline},
		{"停止", models.ResourceStatusOffline},
		{"关机", models.ResourceStatusOffline},
		{"维护中", models.ResourceStatusMaintenance},
		{"维修中", models.ResourceStatusMaintenance},
	}
	for _, tc := range cases {
		got, err := MapStatus(tc.source, models.ResourceCategoryHost, nil)
		require.NoError(t, err, "source=%q 不应报错", tc.source)
		assert.Equal(t, tc.want, got, "source=%q 映射结果", tc.source)
	}
}

// TestMapStatusEnglishValuesAndCaseInsensitive 覆盖英文候选值与不区分大小写
// （§5.5.1 默认映射 case-insensitive）。
func TestMapStatusEnglishValuesAndCaseInsensitive(t *testing.T) {
	cases := []struct {
		source string
		want   models.ResourceStatus
	}{
		{"online", models.ResourceStatusOnline},
		{"ONLINE", models.ResourceStatusOnline},
		{"Up", models.ResourceStatusOnline},
		{"RUNNING", models.ResourceStatusOnline},
		{"Active", models.ResourceStatusOnline},
		{"offline", models.ResourceStatusOffline},
		{"STOPPED", models.ResourceStatusOffline},
		{"Down", models.ResourceStatusOffline},
		{"maintenance", models.ResourceStatusMaintenance},
		{"MAINTENANCE", models.ResourceStatusMaintenance},
		{"Maintaining", models.ResourceStatusMaintenance},
		// 首尾空白应被容忍（Excel 单元格常见）
		{"  运行中  ", models.ResourceStatusOnline},
	}
	for _, tc := range cases {
		got, err := MapStatus(tc.source, models.ResourceCategoryDatabase, nil)
		require.NoError(t, err, "source=%q 不应报错", tc.source)
		assert.Equal(t, tc.want, got, "source=%q 映射结果", tc.source)
	}
}

// TestMapStatusCategoryExactWinsOverGeneric 验证优先级第 1 条：category 精确匹配
// 规则优先于通用规则，即使通用规则 priority 更高（§5.5.4）。
func TestMapStatusCategoryExactWinsOverGeneric(t *testing.T) {
	extra := []Rule{
		{SourceStatus: "运行中", TargetStatus: models.ResourceStatusMaintenance,
			ResourceCategory: models.ResourceCategoryHost, Priority: 10, Enabled: true},
		// 默认内置：运行中→online（通用，priority 100），仍应被 host 精确规则覆盖
	}

	// host：精确匹配规则命中 → maintenance（尽管 priority 更低）
	got, err := MapStatus("运行中", models.ResourceCategoryHost, extra)
	require.NoError(t, err)
	assert.Equal(t, models.ResourceStatusMaintenance, got)

	// database：无精确匹配 → 通用默认 → online
	got, err = MapStatus("运行中", models.ResourceCategoryDatabase, extra)
	require.NoError(t, err)
	assert.Equal(t, models.ResourceStatusOnline, got)
}

// TestMapStatusPriorityDescending 验证同 scope 内按 priority 倒序取最高者
// （§5.5.4 第 2 条）。
func TestMapStatusPriorityDescending(t *testing.T) {
	extra := []Rule{
		{SourceStatus: "运行中", TargetStatus: models.ResourceStatusOffline, Priority: 10, Enabled: true},
		{SourceStatus: "运行中", TargetStatus: models.ResourceStatusMaintenance, Priority: 200, Enabled: true},
	}
	got, err := MapStatus("运行中", models.ResourceCategoryApplication, extra)
	require.NoError(t, err)
	assert.Equal(t, models.ResourceStatusMaintenance, got, "priority 数值大的优先")
}

// TestMapStatusExtraRulesOverrideDefault 验证 extraRules 可覆盖默认映射
// （§5.5.2）：同 source 同 scope 同 priority 时，extraRules（先出现）胜出。
func TestMapStatusExtraRulesOverrideDefault(t *testing.T) {
	// 默认：维护中→maintenance（通用 priority 90）；扩展改为 offline（通用 priority 90）
	extra := []Rule{
		{SourceStatus: "维护中", TargetStatus: models.ResourceStatusOffline, Priority: 90, Enabled: true},
	}
	got, err := MapStatus("维护中", models.ResourceCategoryMiddleware, extra)
	require.NoError(t, err)
	assert.Equal(t, models.ResourceStatusOffline, got, "extraRules 应覆盖默认映射")
}

// TestMapStatusDisabledRuleSkipped 验证 Enabled=false 的规则被跳过，回落到默认。
func TestMapStatusDisabledRuleSkipped(t *testing.T) {
	extra := []Rule{
		{SourceStatus: "运行中", TargetStatus: models.ResourceStatusOffline, Priority: 500, Enabled: false},
	}
	got, err := MapStatus("运行中", models.ResourceCategoryGenericTarget, extra)
	require.NoError(t, err)
	assert.Equal(t, models.ResourceStatusOnline, got, "disabled 规则应被跳过")
}

// TestMapStatusDefaultTargetFallback 验证无命中时 default_target（默认 offline）兜底
// （§5.5.4 第 3 条）。
func TestMapStatusDefaultTargetFallback(t *testing.T) {
	cases := []string{"", "unknown-status", "未知状态", "   "}
	for _, src := range cases {
		got, err := MapStatus(src, models.ResourceCategoryHost, nil)
		require.NoError(t, err, "source=%q 未命中时应走 default_target 而非报错", src)
		assert.Equal(t, models.ResourceStatusOffline, got, "source=%q 应兜底为 offline", src)
	}
}

// TestMapStatusInvalidTargetReturnsError 验证映射目标不在枚举时返回错误
// （§5.5.4 第 4 条，导入层计入 failed 并跳过）。
func TestMapStatusInvalidTargetReturnsError(t *testing.T) {
	extra := []Rule{
		{SourceStatus: "运行中", TargetStatus: models.ResourceStatus("invalid_target"),
			Priority: 200, Enabled: true}, // priority 高于默认(100)，命中后目标非法
	}
	got, err := MapStatus("运行中", models.ResourceCategoryHost, extra)
	require.Error(t, err, "非法目标状态应返回错误")
	assert.Equal(t, models.ResourceStatus(""), got)
	assert.Contains(t, err.Error(), "invalid_target")
}

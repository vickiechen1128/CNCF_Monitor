package domain

import "strings"

// CI 模型内置字段清单（SRS Module_07 v2.2 §5.8 FR-30）。
//
// 内置字段是平台识别、归属、采集与类型推导所必需的最小字段集：
// 用户只读，增删随平台版本发布。本文件是后端唯一的内置字段定义，
// 与前端 resourceFieldSchema.ts 的 key 集合必须保持一致（由测试守护）。
//
// 内置字段不落 m07_attribute_definitions，也不经过 ResourceAttribute；
// 它们的值落在资源表的固定列上。

// FieldValueType is the value shape of a CI field, used by the model viewer
// and by M01 when it reads capability facts.
type FieldValueType string

// Supported CI field value types.
const (
	FieldValueText     FieldValueType = "text"
	FieldValueNumber   FieldValueType = "number"
	FieldValueBoolean  FieldValueType = "boolean"
	FieldValueDateTime FieldValueType = "datetime"
	FieldValueEnum     FieldValueType = "enum"
)

// BuiltinField is one platform-owned field of a CI model.
type BuiltinField struct {
	Key       string
	Label     string
	Group     AttributeGroup
	Order     int
	Required  bool
	ValueType FieldValueType
}

// CategoryLabel returns the Chinese display name of a category.
func CategoryLabel(c Category) string {
	switch c {
	case CategoryHost:
		return "主机"
	case CategoryDatabase:
		return "数据库"
	case CategoryMiddleware:
		return "中间件"
	case CategoryApplication:
		return "应用服务"
	case CategoryInterfaceService:
		return "接口服务"
	case CategoryGenericTarget:
		return "其他监控目标"
	default:
		return string(c)
	}
}

// BuiltinFields returns the built-in field list of one category in display
// order (group order first, then in-group order).
func BuiltinFields(c Category) []BuiltinField {
	switch c {
	case CategoryHost:
		return hostBuiltinFields()
	case CategoryDatabase:
		return databaseBuiltinFields()
	case CategoryMiddleware:
		return middlewareBuiltinFields()
	case CategoryApplication:
		return applicationBuiltinFields()
	case CategoryInterfaceService:
		return interfaceServiceBuiltinFields()
	case CategoryGenericTarget:
		return genericTargetBuiltinFields()
	default:
		return nil
	}
}

// IsBuiltinField reports whether key belongs to the platform-owned field set of
// one category.
//
// Built-in fields never enter the custom field dictionary, so a custom
// registration using the same key would shadow a platform field and split the
// field's meaning across two storage layers (SRS v2.4 §5.8 FR-30 / NFR-24).
func IsBuiltinField(c Category, key string) bool {
	key = strings.TrimSpace(key)
	for _, field := range BuiltinFields(c) {
		if field.Key == key {
			return true
		}
	}
	return false
}

// IsBuiltinFieldKey reports whether key is platform-owned in any category. It
// lets the custom field API reject requests that address a built-in field by
// key while returning an actionable message instead of a generic not-found.
func IsBuiltinFieldKey(key string) bool {
	for _, c := range AllCategories() {
		if IsBuiltinField(c, key) {
			return true
		}
	}
	return false
}

func ownershipFields(withPlatform bool) []BuiltinField {
	fields := []BuiltinField{
		{Key: "network_domain_id", Label: "网域", Group: AttributeGroupOwnership, Order: 0, Required: true, ValueType: FieldValueText},
		{Key: "biz_code", Label: "业务", Group: AttributeGroupOwnership, Order: 1, ValueType: FieldValueText},
		{Key: "app_code", Label: "应用", Group: AttributeGroupOwnership, Order: 2, ValueType: FieldValueText},
	}
	if withPlatform {
		fields = append(fields, BuiltinField{
			Key: "platform_code", Label: "平台", Group: AttributeGroupOwnership, Order: 3, ValueType: FieldValueText,
		})
	}
	fields = append(fields,
		BuiltinField{Key: "cluster", Label: "集群", Group: AttributeGroupOwnership, Order: 4, ValueType: FieldValueText},
		BuiltinField{Key: "env", Label: "环境", Group: AttributeGroupOwnership, Order: 5, Required: true, ValueType: FieldValueEnum},
	)
	return fields
}

func runtimeFields() []BuiltinField {
	return []BuiltinField{
		{Key: "status", Label: "运行状态", Group: AttributeGroupRuntime, Order: 0, Required: true, ValueType: FieldValueEnum},
	}
}

func hostBuiltinFields() []BuiltinField {
	fields := []BuiltinField{
		{Key: "instance_name", Label: "实例名", Group: AttributeGroupIdentity, Order: 0, Required: true, ValueType: FieldValueText},
		{Key: "instance_ip", Label: "IP 地址", Group: AttributeGroupIdentity, Order: 1, Required: true, ValueType: FieldValueText},
		{Key: "os_type", Label: "操作系统", Group: AttributeGroupIdentity, Order: 2, Required: true, ValueType: FieldValueText},
	}
	fields = append(fields, ownershipFields(true)...)
	fields = append(fields, runtimeFields()...)
	fields = append(fields,
		BuiltinField{Key: "scrape_port", Label: "采集端口", Group: AttributeGroupCollection, Order: 0, ValueType: FieldValueNumber},
		BuiltinField{Key: "has_npu", Label: "NPU 芯片", Group: AttributeGroupCapability, Order: 0, ValueType: FieldValueBoolean},
		BuiltinField{Key: "has_gpu", Label: "GPU 芯片", Group: AttributeGroupCapability, Order: 1, ValueType: FieldValueBoolean},
		BuiltinField{Key: "owner", Label: "负责人", Group: AttributeGroupProfile, Order: 0, ValueType: FieldValueText},
		BuiltinField{Key: "activated_at", Label: "开通时间", Group: AttributeGroupProfile, Order: 1, ValueType: FieldValueDateTime},
	)
	return fields
}

func databaseBuiltinFields() []BuiltinField {
	fields := []BuiltinField{
		{Key: "database_type", Label: "数据库类型", Group: AttributeGroupIdentity, Order: 0, Required: true, ValueType: FieldValueEnum},
		{Key: "instance_ip", Label: "IP 地址", Group: AttributeGroupIdentity, Order: 1, Required: true, ValueType: FieldValueText},
		{Key: "port", Label: "端口", Group: AttributeGroupIdentity, Order: 2, Required: true, ValueType: FieldValueNumber},
	}
	fields = append(fields, ownershipFields(true)...)
	fields = append(fields, runtimeFields()...)
	fields = append(fields,
		BuiltinField{Key: "scrape_port", Label: "采集端口", Group: AttributeGroupCollection, Order: 0, ValueType: FieldValueNumber},
		BuiltinField{Key: "version", Label: "版本", Group: AttributeGroupProfile, Order: 0, ValueType: FieldValueText},
		BuiltinField{Key: "owner", Label: "负责人", Group: AttributeGroupProfile, Order: 1, ValueType: FieldValueText},
	)
	return fields
}

func middlewareBuiltinFields() []BuiltinField {
	fields := []BuiltinField{
		{Key: "middleware_type", Label: "中间件类型", Group: AttributeGroupIdentity, Order: 0, Required: true, ValueType: FieldValueEnum},
		{Key: "instance_ip", Label: "IP 地址", Group: AttributeGroupIdentity, Order: 1, Required: true, ValueType: FieldValueText},
		{Key: "port", Label: "端口", Group: AttributeGroupIdentity, Order: 2, Required: true, ValueType: FieldValueNumber},
	}
	fields = append(fields, ownershipFields(true)...)
	fields = append(fields, runtimeFields()...)
	fields = append(fields,
		BuiltinField{Key: "scrape_port", Label: "采集端口", Group: AttributeGroupCollection, Order: 0, ValueType: FieldValueNumber},
		BuiltinField{Key: "version", Label: "版本", Group: AttributeGroupProfile, Order: 0, ValueType: FieldValueText},
		BuiltinField{Key: "owner", Label: "负责人", Group: AttributeGroupProfile, Order: 1, ValueType: FieldValueText},
	)
	return fields
}

func applicationBuiltinFields() []BuiltinField {
	fields := []BuiltinField{
		{Key: "service_name", Label: "服务名", Group: AttributeGroupIdentity, Order: 0, Required: true, ValueType: FieldValueText},
		{Key: "health_check_url", Label: "健康检查 URL", Group: AttributeGroupIdentity, Order: 1, Required: true, ValueType: FieldValueText},
	}
	fields = append(fields, ownershipFields(true)...)
	fields = append(fields, runtimeFields()...)
	fields = append(fields,
		BuiltinField{Key: "endpoint", Label: "端点", Group: AttributeGroupCollection, Order: 0, ValueType: FieldValueText},
		BuiltinField{Key: "port", Label: "端口", Group: AttributeGroupCollection, Order: 1, ValueType: FieldValueNumber},
		BuiltinField{Key: "owner", Label: "负责人", Group: AttributeGroupProfile, Order: 0, ValueType: FieldValueText},
		BuiltinField{Key: "owner1", Label: "负责人1", Group: AttributeGroupProfile, Order: 1, ValueType: FieldValueText},
		BuiltinField{Key: "owner1_contact", Label: "负责人1联系方式", Group: AttributeGroupProfile, Order: 2, ValueType: FieldValueText},
		BuiltinField{Key: "owner2", Label: "负责人2", Group: AttributeGroupProfile, Order: 3, ValueType: FieldValueText},
		BuiltinField{Key: "owner2_contact", Label: "负责人2联系方式", Group: AttributeGroupProfile, Order: 4, ValueType: FieldValueText},
		BuiltinField{Key: "ops_person", Label: "运维人员", Group: AttributeGroupProfile, Order: 5, ValueType: FieldValueText},
		BuiltinField{Key: "ops_person_contact", Label: "运维人员联系方式", Group: AttributeGroupProfile, Order: 6, ValueType: FieldValueText},
		BuiltinField{Key: "go_live_at", Label: "应用上线时间", Group: AttributeGroupProfile, Order: 7, ValueType: FieldValueDateTime},
		BuiltinField{Key: "protocol", Label: "协议", Group: AttributeGroupProfile, Order: 8, ValueType: FieldValueText},
	)
	return fields
}

func interfaceServiceBuiltinFields() []BuiltinField {
	fields := []BuiltinField{
		{Key: "api_name", Label: "接口名", Group: AttributeGroupIdentity, Order: 0, Required: true, ValueType: FieldValueText},
		{Key: "api_url", Label: "接口地址", Group: AttributeGroupIdentity, Order: 1, Required: true, ValueType: FieldValueText},
	}
	fields = append(fields, ownershipFields(false)...)
	fields = append(fields, runtimeFields()...)
	fields = append(fields,
		BuiltinField{Key: "owner", Label: "负责人", Group: AttributeGroupProfile, Order: 0, ValueType: FieldValueText},
	)
	return fields
}

func genericTargetBuiltinFields() []BuiltinField {
	fields := []BuiltinField{
		{Key: "target_name", Label: "目标名称", Group: AttributeGroupIdentity, Order: 0, Required: true, ValueType: FieldValueText},
		{Key: "instance_ip", Label: "端点 IP / 域名", Group: AttributeGroupIdentity, Order: 1, Required: true, ValueType: FieldValueText},
	}
	fields = append(fields, ownershipFields(true)...)
	fields = append(fields, runtimeFields()...)
	fields = append(fields,
		BuiltinField{Key: "port", Label: "端口", Group: AttributeGroupCollection, Order: 0, ValueType: FieldValueNumber},
		BuiltinField{Key: "metrics_path", Label: "采集路径", Group: AttributeGroupCollection, Order: 1, ValueType: FieldValueText},
		BuiltinField{Key: "scheme", Label: "协议", Group: AttributeGroupCollection, Order: 2, ValueType: FieldValueEnum},
		BuiltinField{Key: "exporter_type", Label: "Exporter 类型", Group: AttributeGroupCollection, Order: 3, ValueType: FieldValueText},
		BuiltinField{Key: "owner", Label: "负责人", Group: AttributeGroupProfile, Order: 0, ValueType: FieldValueText},
	)
	return fields
}

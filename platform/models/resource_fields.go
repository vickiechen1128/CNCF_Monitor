package models

import (
	"strconv"
)

// LegacyFieldMap 返回某类型资源「PRD 规范字段名 → 现模型列名」的映射。
// legacy 映射来源：models/host.go 的访问器（Hostname()=InstanceName、
// InstanceIP()=PrivateIP、OSType()=Image、GetAppName()=AppCode、
// GetEnv()=EnvFlag、GetCluster()=SubAppCode），便于 T07-05/06 序列化与
// T07-13 标签生成复用。
func LegacyFieldMap(category ResourceCategory) map[string]string {
	switch category {
	case ResourceCategoryHost:
		return map[string]string{
			"instance_ip":       "private_ip",    // Host.InstanceIP() = PrivateIP
			"hostname":          "instance_name", // Host.Hostname() = InstanceName
			"instance_name":     "instance_name",
			"os_type":           "image",        // Host.OSType() = Image
			"env":               "env_flag",     // Host.GetEnv() = EnvFlag
			"cluster":           "sub_app_code", // Host.GetCluster() = SubAppCode
			"app_name":          "app_code",     // Host.GetAppName() = AppCode
			"biz_code":          "biz_code",
			"network_domain_id": "network_domain_id",
			"status":            "status",
			"resource_id":       "resource_id",
			"source_type":       "source_type",
		}
	case ResourceCategoryDatabase:
		return map[string]string{
			"instance_ip":       "instance_ip",
			"app_name":          "app_name",
			"cluster":           "cluster",
			"env":               "env",
			"biz_code":          "biz_code",
			"network_domain_id": "network_domain_id",
			"status":            "status",
			"owner":             "owner",
			"database_type":     "database_type",
			"port":              "port",
			"version":           "version",
			"resource_id":       "resource_id",
			"source_type":       "source_type",
		}
	case ResourceCategoryMiddleware:
		return map[string]string{
			"instance_ip":       "instance_ip",
			"app_name":          "app_name",
			"cluster":           "cluster",
			"env":               "env",
			"biz_code":          "biz_code",
			"network_domain_id": "network_domain_id",
			"status":            "status",
			"owner":             "owner",
			"middleware_type":   "middleware_type",
			"port":              "port",
			"version":           "version",
			"resource_id":       "resource_id",
			"source_type":       "source_type",
		}
	case ResourceCategoryApplication:
		return map[string]string{
			"service_name":      "service_name",
			"health_check_url":  "health_check_url",
			"protocol":          "protocol",
			"endpoint":          "endpoint",
			"port":              "port",
			"app_name":          "app_name",
			"cluster":           "cluster",
			"env":               "env",
			"biz_code":          "biz_code",
			"network_domain_id": "network_domain_id",
			"status":            "status",
			"owner":             "owner",
			"resource_id":       "resource_id",
			"source_type":       "source_type",
		}
	case ResourceCategoryGenericTarget:
		return map[string]string{
			"target_name":       "target_name",
			"instance_ip":       "instance_ip",
			"port":              "port",
			"metrics_path":      "metrics_path",
			"scheme":            "scheme",
			"exporter_type":     "exporter_type",
			"app_name":          "app_name",
			"cluster":           "cluster",
			"env":               "env",
			"biz_code":          "biz_code",
			"network_domain_id": "network_domain_id",
			"status":            "status",
			"owner":             "owner",
			"resource_id":       "resource_id",
			"source_type":       "source_type",
		}
	}
	return map[string]string{}
}

// GetResourceField 从具体资源模型读取 PRD 规范字段的值（字段名经 LegacyFieldMap
// 映射到 legacy 列），供 T07-05/06 序列化与 T07-13 标签生成复用。字段未映射或
// 模型类型不支持时返回 ("", false)。
func GetResourceField(res any, field string) (string, bool) {
	switch r := res.(type) {
	case *Host:
		return getHostField(r, field)
	case *Database:
		return getDatabaseField(r, field)
	case *Middleware:
		return getMiddlewareField(r, field)
	case *Application:
		return getApplicationField(r, field)
	case *GenericTarget:
		return getGenericTargetField(r, field)
	}
	return "", false
}

func getHostField(h *Host, field string) (string, bool) {
	switch field {
	case "resource_id":
		return h.GetResourceID(), true
	case "network_domain_id":
		return h.NetworkDomainID, true
	case "biz_code":
		return h.BizCode, true
	case "app_name":
		return h.GetAppName(), true // legacy: AppCode
	case "env":
		return h.GetEnv(), true // legacy: EnvFlag
	case "cluster":
		return h.GetCluster(), true // legacy: SubAppCode
	case "status":
		return h.GetStatus(), true
	case "source_type":
		return string(h.SourceType), true
	case "instance_ip":
		return h.InstanceIP(), true // legacy: PrivateIP
	case "hostname", "instance_name":
		return h.Hostname(), true // legacy: InstanceName
	case "os_type":
		return h.OSType(), true // legacy: Image
	}
	return "", false
}

func getDatabaseField(d *Database, field string) (string, bool) {
	switch field {
	case "resource_id":
		return d.GetResourceID(), true
	case "network_domain_id":
		return d.NetworkDomainID, true
	case "biz_code":
		return d.BizCode, true
	case "app_name":
		return d.GetAppName(), true
	case "cluster":
		return d.GetCluster(), true
	case "env":
		return d.GetEnv(), true
	case "status":
		return d.GetStatus(), true
	case "owner":
		return d.Owner, true
	case "source_type":
		return string(d.SourceType), true
	case "instance_ip":
		return d.InstanceIP, true
	case "database_type":
		return d.DatabaseType, true
	case "port":
		return strconv.Itoa(d.Port), true
	case "version":
		return d.Version, true
	}
	return "", false
}

func getMiddlewareField(m *Middleware, field string) (string, bool) {
	switch field {
	case "resource_id":
		return m.GetResourceID(), true
	case "network_domain_id":
		return m.NetworkDomainID, true
	case "biz_code":
		return m.BizCode, true
	case "app_name":
		return m.GetAppName(), true
	case "cluster":
		return m.GetCluster(), true
	case "env":
		return m.GetEnv(), true
	case "status":
		return m.GetStatus(), true
	case "owner":
		return m.Owner, true
	case "source_type":
		return string(m.SourceType), true
	case "instance_ip":
		return m.InstanceIP, true
	case "middleware_type":
		return m.MiddlewareType, true
	case "port":
		return strconv.Itoa(m.Port), true
	case "version":
		return m.Version, true
	}
	return "", false
}

func getApplicationField(a *Application, field string) (string, bool) {
	switch field {
	case "resource_id":
		return a.GetResourceID(), true
	case "network_domain_id":
		return a.NetworkDomainID, true
	case "biz_code":
		return a.BizCode, true
	case "app_name":
		return a.GetAppName(), true
	case "cluster":
		return a.GetCluster(), true
	case "env":
		return a.GetEnv(), true
	case "status":
		return a.GetStatus(), true
	case "owner":
		return a.Owner, true
	case "source_type":
		return string(a.SourceType), true
	case "service_name":
		return a.ServiceName, true
	case "health_check_url":
		return a.HealthCheckURL, true
	case "protocol":
		return a.Protocol, true
	case "endpoint":
		return a.Endpoint, true
	case "port":
		return strconv.Itoa(a.Port), true
	}
	return "", false
}

func getGenericTargetField(g *GenericTarget, field string) (string, bool) {
	switch field {
	case "resource_id":
		return g.GetResourceID(), true
	case "network_domain_id":
		return g.NetworkDomainID, true
	case "biz_code":
		return g.BizCode, true
	case "app_name":
		return g.GetAppName(), true
	case "cluster":
		return g.GetCluster(), true
	case "env":
		return g.GetEnv(), true
	case "status":
		return g.GetStatus(), true
	case "owner":
		return g.Owner, true
	case "source_type":
		return string(g.SourceType), true
	case "target_name":
		return g.TargetName, true
	case "instance_ip":
		return g.InstanceIP, true
	case "metrics_path":
		return g.MetricsPath, true
	case "scheme":
		return g.Scheme, true
	case "exporter_type":
		return g.ExporterType, true
	case "port":
		return strconv.Itoa(g.Port), true
	}
	return "", false
}

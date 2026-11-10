package importer

import "github.com/metriccenter/metriccenter/platform/modules/m07/domain"

// TemplateColumns is the v3 fixed column template for each resource category.
var TemplateColumns = map[domain.Category][]string{
	domain.CategoryHost: {
		"network_domain", "instance_name", "hostname", "instance_ip", "os_type",
		"biz_code", "app_code", "platform_code", "env", "cluster", "owner", "status",
		"scrape_port", "activated_at",
	},
	domain.CategoryDatabase: {
		"network_domain", "database_type", "instance_ip", "port", "version",
		"biz_code", "app_code", "platform_code", "env", "cluster", "owner", "status",
		"scrape_port",
	},
	domain.CategoryMiddleware: {
		"network_domain", "middleware_type", "instance_ip", "port", "version",
		"biz_code", "app_code", "platform_code", "env", "cluster", "owner", "status",
		"scrape_port",
	},
	domain.CategoryApplication: {
		"network_domain", "service_name", "biz_code", "health_check_url", "protocol",
		"endpoint", "port", "app_code", "platform_code", "env", "cluster", "owner", "status",
		"scrape_port", "owner1", "owner1_contact", "owner2", "owner2_contact", "go_live_at",
		"ops_person", "ops_person_contact",
	},
	domain.CategoryGenericTarget: {
		"network_domain", "target_name", "instance_ip", "port", "metrics_path", "scheme",
		"exporter_type", "custom_labels", "biz_code", "app_code", "platform_code", "env", "cluster", "owner", "status",
		"scrape_port",
	},
	domain.CategoryInterfaceService: {
		"network_domain", "api_name", "api_url", "biz_code", "app_code", "env", "status",
	},
}

var optionalColumns = map[string]bool{
	"hostname": true, "version": true, "owner": true, "protocol": true,
	"metrics_path": true, "scheme": true, "exporter_type": true,
	"custom_labels": true, "scrape_port": true, "platform_code": true,
	"owner1": true, "owner1_contact": true, "owner2": true, "owner2_contact": true,
	"go_live_at": true, "activated_at": true, "ops_person": true, "ops_person_contact": true,
}

var removedColumns = map[string]bool{"zone_env": true}

// ColumnsFor returns the fixed template columns for a category.
func ColumnsFor(category domain.Category) ([]string, bool) {
	columns, ok := TemplateColumns[category]
	return columns, ok
}

// list.go 提供资源列表接口（GET /api/v2/platform/resources，T07-05）：
// 按 resource_category 路由到五类资源表，支持 network_domain_id / biz_code /
// status / keyword / is_monitored 筛选与分页，返回 {list,total,page,page_size}
// （03_API_Standard §7.2）。
package resource

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// sharedFields 是五类资源列表 item 的共享字段（Module_07 §5.2），即契约段
// {resource_id, network_domain_id, biz_code, app_code, platform_code, env,
// cluster, owner, status, source_type}。platform_code 为资源行一等字段（决策 110
// 连带项④：资源列表 / 详情暴露）。字段值经 T07-03 GetResourceField 读取，host 的 legacy
// 映射（app_code→AppCode、env→EnvFlag、cluster→SubAppCode 等）已在 helper 内处理
// （决策 92：资源侧只存 app_code，app_name 为应用字典展示名，不落在资源表上）。
//
// resource_id 为跨模块合并键（decision 47-3）：与 M02 `GET /api/v1/health/coverage`
// 的 item.resource_id 同键，前端据此把三态采集状态 badge 合并到列表行。本接口仅
// 稳定透出该键，**不内嵌 up/down 时序字段、不反向查询 ScrapeJob**（M07-M02 边界）。
var sharedFields = []string{
	"resource_id",
	"network_domain_id",
	"biz_code",
	"app_code",
	"platform_code",
	"env",
	"cluster",
	"owner",
	"status",
	"source_type",
}

// ListResources 是 GET /api/v2/platform/resources 的列表 handler。
//
// Query（Module_07 §6.1）：
//   - resource_category 必填（host/database/middleware/application/generic_target），
//     缺失/非法返回 bad_request；按分类路由到对应资源表；
//   - network_domain_id / biz_code / status 等值筛选（PRD §11.1 服务端筛选）；
//   - keyword（名称+IP）模糊筛选（T07-03 BuildListQuery）；
//   - is_monitored 透传预留：M01 维护、M07 只读映射，M01 未实现时不生效
//     （见 monitored.go，§6.5 避免反向依赖 ScrapeJob）；
//   - page/page_size 分页：默认 1/50，上限 100（T07-03 ParsePageParams）。
//
// 响应 data：`{list, total, page, page_size}`，list item 字段对齐 §5.2 与
// §5.6~§5.9。已软删记录由 GORM 自动排除；空结果返回空 list 而非 null。
//
// 本文件只实现 handler，不注册路由（路由收口见 T07-18）。
func ListResources(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		categoryRaw := strings.TrimSpace(c.Query("resource_category"))
		if categoryRaw == "" {
			response.BadRequest(c, fmt.Errorf("resource_category 必填（host/database/middleware/application/generic_target）"))
			return
		}
		category := models.ResourceCategory(categoryRaw)
		if !isValidCategory(category) {
			response.BadRequest(c, fmt.Errorf("resource_category 非法：%q，可选 host/database/middleware/application/generic_target", categoryRaw))
			return
		}

		filter := ParseListFilter(c.Request.URL.Query())

		// is_monitored：M01 维护、M07 只读映射；M01 未实现时透传不生效。
		// 此处仅接受参数并做合法性解析（非法值不报错），不拼 GORM 条件、
		// 不查询 ScrapeJob（§6.5 避免反向依赖），见 monitored.go。
		ParseIsMonitored(c.Query(IsMonitoredKey))

		list, total, err := listCategory(db, category, filter)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}

		response.OK(c, gin.H{
			"list":      list,
			"total":     total,
			"page":      filter.Page,
			"page_size": filter.PageSize,
		})
	}
}

// listCategory 按分类路由到对应资源表执行列表查询：筛选（BuildListQuery）+ 计数 +
// 分页，返回归一化 item 列表与全量总数。已软删记录由 GORM 自动排除。
func listCategory(db *gorm.DB, category models.ResourceCategory, f ListFilter) ([]map[string]interface{}, int64, error) {
	switch category {
	case models.ResourceCategoryHost:
		return listTyped[models.Host](db, category, f)
	case models.ResourceCategoryDatabase:
		return listTyped[models.Database](db, category, f)
	case models.ResourceCategoryMiddleware:
		return listTyped[models.Middleware](db, category, f)
	case models.ResourceCategoryApplication:
		return listTyped[models.Application](db, category, f)
	case models.ResourceCategoryGenericTarget:
		return listTyped[models.GenericTarget](db, category, f)
	}
	return nil, 0, fmt.Errorf("unsupported resource_category: %s", category)
}

// listTyped 泛型执行对类型 T 资源表的列表查询。db.Model(new(T)) 指定查询表，
// 之后拼接筛选（BuildListQuery）；Count 统计全量总数（分页前），Find 取当前页行。
func listTyped[T any](db *gorm.DB, category models.ResourceCategory, f ListFilter) ([]map[string]interface{}, int64, error) {
	q := BuildListQuery(db.Model(new(T)), category, f)

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count %s resources: %w", category, err)
	}

	var rows []T
	if err := q.Order("created_at desc").
		Offset((f.Page - 1) * f.PageSize).
		Limit(f.PageSize).
		Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list %s resources: %w", category, err)
	}

	// 决策 103 scheme-B：cloud_code / zone_type 统一经 network_domain_id 派生，对全部
	// 五类资源注入（批量反查网域避免 N+1；网域缺失时回退空串）。
	domainMap, err := loadDomainCloudZone(db, rows)
	if err != nil {
		return nil, 0, err
	}

	list := make([]map[string]interface{}, 0, len(rows))
	for i := range rows {
		item := buildListItem(&rows[i], category)
		if dom, ok := domainMap[networkDomainIDOf(&rows[i])]; ok {
			item["cloud_code"] = dom.CloudCode
			item["zone_type"] = dom.ZoneType
		} else {
			item["cloud_code"] = ""
			item["zone_type"] = ""
		}
		list = append(list, item)
	}
	return list, total, nil
}

// networkDomainIDOf 从具体资源模型读取其所属 network_domain_id（决策 103 scheme-B
// cloud / zone / network_domain 三标签派生的统一入口）。未识别类型返回空串。
func networkDomainIDOf(res any) string {
	switch r := res.(type) {
	case *models.Host:
		return r.NetworkDomainID
	case *models.Database:
		return r.NetworkDomainID
	case *models.Middleware:
		return r.NetworkDomainID
	case *models.Application:
		return r.NetworkDomainID
	case *models.GenericTarget:
		return r.NetworkDomainID
	}
	return ""
}

// loadDomainCloudZone 按去重后的 network_domain_id 集合批量反查网域，返回
// id -> {cloud_code, zone_type} 映射，供列表/详情派生 cloud / zone 标签（避免 N+1）。
func loadDomainCloudZone[T any](db *gorm.DB, rows []T) (map[string]models.NetworkDomain, error) {
	ids := make([]string, 0, len(rows))
	seen := make(map[string]struct{}, len(rows))
	for i := range rows {
		id := networkDomainIDOf(&rows[i])
		if id == "" {
			continue
		}
		if _, ok := seen[id]; !ok {
			seen[id] = struct{}{}
			ids = append(ids, id)
		}
	}
	out := make(map[string]models.NetworkDomain, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	var doms []models.NetworkDomain
	if err := db.Select("id", "cloud_code", "zone_type").Where("id IN ?", ids).Find(&doms).Error; err != nil {
		return nil, fmt.Errorf("load network domains for cloud_code/zone_type: %w", err)
	}
	for _, d := range doms {
		out[d.ID] = d
	}
	return out, nil
}

// buildListItem 将某类资源行归一化为列表响应 item。
//
// 共享字段（§5.2）经 T07-03 GetResourceField 读取（含 host legacy 映射）；缺失
// 字段（如 Host 模型无 owner 列）以空串补齐，保证五类 item 契约字段稳定。
// 差异化字段（§5.6~§5.9）从具体模型按正确类型读取（如 port 为 int）。
func buildListItem(res any, category models.ResourceCategory) map[string]interface{} {
	item := make(map[string]interface{}, 20)
	item["resource_category"] = string(category)
	for _, f := range sharedFields {
		v, ok := GetResourceField(res, f)
		if !ok {
			v = ""
		}
		item[f] = v
	}

	switch r := res.(type) {
	case *models.Host:
		item["instance_name"] = r.InstanceName
		item["hostname"] = r.Hostname()      // legacy: InstanceName
		item["instance_ip"] = r.InstanceIP() // legacy: PrivateIP
		item["os_type"] = r.OSType()         // legacy: Image
	case *models.Database:
		item["database_type"] = r.DatabaseType
		item["instance_ip"] = r.InstanceIP
		item["port"] = r.Port
		item["version"] = r.Version
	case *models.Middleware:
		item["middleware_type"] = r.MiddlewareType
		item["instance_ip"] = r.InstanceIP
		item["port"] = r.Port
		item["version"] = r.Version
	case *models.Application:
		item["service_name"] = r.ServiceName
		// 决策 105：service_code 仅 application / generic_target 返回（其余三类不挂）。
		item["service_code"] = r.ServiceCode
		item["health_check_url"] = r.HealthCheckURL
		item["protocol"] = r.Protocol
		item["endpoint"] = r.Endpoint
		item["port"] = r.Port
	case *models.GenericTarget:
		item["target_name"] = r.TargetName
		item["service_code"] = r.ServiceCode
		item["instance_ip"] = r.InstanceIP
		item["port"] = r.Port
		item["metrics_path"] = r.MetricsPath
		item["scheme"] = r.Scheme
		item["exporter_type"] = r.ExporterType
		item["custom_labels"] = r.CustomLabels
	}
	return item
}

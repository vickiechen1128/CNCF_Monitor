// update.go 提供资源更新接口（PUT /api/v2/platform/resources/:resource_id，
// T07-06）：按 resource_id 跨五类表定位（GORM 自动排除软删），更新可更新字段；
// resource_id / resource_category / source_type 不可改（resource_category 变更
// 被拒，§5.2）；网域/biz 校验与 POST 一致（复用 T07-03 ValidateResourceInput）。
package resource

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// findResourceByID 跨五类资源表按 resource_id 定位资源（GORM 默认排除软删）。
// 命中返回该资源的类型与其具体模型指针；未命中 found=false。
func findResourceByID(db *gorm.DB, resourceID string) (category models.ResourceCategory, model any, found bool, err error) {
	lookups := []struct {
		category models.ResourceCategory
		dest     any
	}{
		{models.ResourceCategoryHost, &models.Host{}},
		{models.ResourceCategoryDatabase, &models.Database{}},
		{models.ResourceCategoryMiddleware, &models.Middleware{}},
		{models.ResourceCategoryApplication, &models.Application{}},
		{models.ResourceCategoryGenericTarget, &models.GenericTarget{}},
	}
	for _, l := range lookups {
		result := db.Where("resource_id = ?", resourceID).First(l.dest)
		if result.Error == nil {
			return l.category, l.dest, true, nil
		}
		if result.Error != gorm.ErrRecordNotFound {
			return "", nil, false, fmt.Errorf("按 resource_id %q 定位资源：%w", resourceID, result.Error)
		}
	}
	return "", nil, false, nil
}

// sourceTypeOf 读取具体资源模型的当前 source_type。
func sourceTypeOf(model any) models.SourceType {
	switch m := model.(type) {
	case *models.Host:
		return m.SourceType
	case *models.Database:
		return m.SourceType
	case *models.Middleware:
		return m.SourceType
	case *models.Application:
		return m.SourceType
	case *models.GenericTarget:
		return m.SourceType
	}
	return ""
}

// updatableColumns 返回某类型资源 PUT 可更新列（Select 显式列出，含零值也会写入；
// 不含 resource_id/resource_category/source_type/tenant_id 等不可变列）。列名即
// LegacyFieldMap 映射后的模型列（host: app_code/sub_app_code/env_flag/private_ip/image）。
func updatableColumns(category models.ResourceCategory) []string {
	switch category {
	case models.ResourceCategoryHost:
		return []string{
			"network_domain_id", "biz_code", "app_code", "sub_app_code", "env_flag",
			"status", "instance_name", "private_ip", "image",
		}
	case models.ResourceCategoryDatabase:
		return []string{
			"network_domain_id", "biz_code", "app_name", "cluster", "env", "owner", "status",
			"database_type", "instance_ip", "port", "version",
		}
	case models.ResourceCategoryMiddleware:
		return []string{
			"network_domain_id", "biz_code", "app_name", "cluster", "env", "owner", "status",
			"middleware_type", "instance_ip", "port", "version",
		}
	case models.ResourceCategoryApplication:
		return []string{
			"network_domain_id", "biz_code", "app_name", "cluster", "env", "owner", "status",
			"service_name", "health_check_url", "protocol", "endpoint", "port",
		}
	case models.ResourceCategoryGenericTarget:
		return []string{
			"network_domain_id", "biz_code", "app_name", "cluster", "env", "owner", "status",
			"target_name", "instance_ip", "port", "metrics_path", "scheme", "exporter_type", "custom_labels",
		}
	}
	return nil
}

// UpdateResource 是 PUT /api/v2/platform/resources/:resource_id 的更新 handler。
//
// 流程：
//  1. 按 resource_id 定位（不存在/已软删 → not_found）；
//  2. resource_category / source_type 不可改（请求体含不同值 → bad_request）；
//  3. 复用 T07-03 ValidateResourceInput 做网域/biz/字段校验（与 POST 一致）；
//  4. 应用输入到已加载模型（create.go apply*Input）：PUT 为整体替换语义——请求体须
//     携带全量可更新字段（ValidateResourceInput 全量必填校验），空值按零值覆盖写入
//     （updatableColumns 显式 Select，含零值）；个别字段的「空串保留原值」仅存在于
//     apply 层兜底逻辑（如 instance_name 缺省取 hostname），不作为部分更新入口；
//     resource_id/resource_category/source_type/tenant_id 不进入更新列；
//  5. 成功返回更新后的完整对象（复用 T07-05 buildListItem）。
//
// 本文件只实现 handler，不注册路由（路由收口见 T07-18）。
func UpdateResource(db *gorm.DB, bizStore *BusinessDomainStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		resourceID := strings.TrimSpace(c.Param("resource_id"))
		if resourceID == "" {
			response.BadRequest(c, fmt.Errorf("resource_id 必填"))
			return
		}
		var in ResourceInput
		if err := c.ShouldBindJSON(&in); err != nil {
			response.BadRequest(c, fmt.Errorf("请求体解析失败：%w", err))
			return
		}

		category, model, found, err := findResourceByID(db, resourceID)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if !found {
			response.NotFound(c, fmt.Sprintf("资源 %s 不存在或已删除", resourceID))
			return
		}

		// resource_category 创建后不可改（§5.2 / §6.6.1）。
		if in.ResourceCategory != "" && models.ResourceCategory(strings.TrimSpace(in.ResourceCategory)) != category {
			response.BadRequest(c, fmt.Errorf("resource_category 不可修改（当前 %q，请求 %q）", category, in.ResourceCategory))
			return
		}
		// source_type 创建后不可改（§5.2）。
		if in.SourceType != "" && models.SourceType(strings.TrimSpace(in.SourceType)) != sourceTypeOf(model) {
			response.BadRequest(c, fmt.Errorf("source_type 不可修改"))
			return
		}

		if err := ValidateResourceInput(category, &in, bizStore, networkDomainExistsFunc(db)); err != nil {
			response.BadRequest(c, err)
			return
		}

		applyInputToModel(category, model, &in)
		cols := updatableColumns(category)
		if err := db.Model(model).Select(cols).Updates(model).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("更新 %s 资源 %s 失败：%w", category, resourceID, err))
			return
		}
		response.OK(c, buildListItem(model, category))
	}
}

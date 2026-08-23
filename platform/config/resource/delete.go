// delete.go 提供资源删除接口（DELETE /api/v2/platform/resources/:resource_id，
// T07-07）：按 resource_id 软删（DeletedAt 置位，BaseModel 体系），成功返回
// {resource_id}（PRD §6.6.1）；不存在/已软删/二次删除返回 not_found；删除前置
// 物理清理该资源下的 ResourceLabel；被 ScrapeJob 引用的拦截契约预留 M01
// （本阶段直接放行，不反向查询 ScrapeJob，§6.5）。
package resource

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// DeleteResource 是 DELETE /api/v2/platform/resources/:resource_id 的删除 handler。
//
// 流程：
//  1. 按 resource_id 跨五类表定位（复用 T07-06 findResourceByID，GORM 自动排除
//     软删；不存在/已软删 → not_found，二次删除同样 not_found）；
//  2. 删除前置物理清理该资源下的 ResourceLabel（选择物理删除而非随资源软删：
//     资源软删后其 user 标签即孤儿数据，物理删除避免脏数据残留，也避免标签按
//     resource_id 反查命中已删资源；MVP 无恢复/回滚需求，故不采用级联软删）；
//  3. 软删资源本身（BaseModel.DeletedAt 置位，PRD §6.6.1 删除语义）；
//  4. 成功返回 {resource_id}。
//
// 被引用拦截契约（M01 预留）：TODO(M01): ScrapeJob 引用校验，403 data 返回
// 引用 Job 名单 {job_name, network_domain_id, enabled}（PRD §6.6.1，删除被引用
// 资源时附带「查看引用 Job」跳转，§11.2）。M01 未实现，本阶段直接放行，且不
// 反向查询 ScrapeJob（§6.5 避免反向依赖）。
//
// 本文件只实现 handler，不注册路由（路由收口见 T07-18）。
func DeleteResource(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		resourceID := strings.TrimSpace(c.Param("resource_id"))
		if resourceID == "" {
			response.BadRequest(c, fmt.Errorf("resource_id 必填"))
			return
		}

		// TODO(M01): ScrapeJob 引用校验，403 data 返回引用 Job 名单
		// {job_name, network_domain_id, enabled}（PRD §6.6.1 / §11.2）。
		// M01 未实现，本阶段直接放行；不反向查询 ScrapeJob（§6.5 避免反向依赖）。

		category, model, found, err := findResourceByID(db, resourceID)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if !found {
			response.NotFound(c, fmt.Sprintf("资源 %s 不存在或已删除", resourceID))
			return
		}

		// 删除前置清理该资源下的 ResourceLabel：物理删除（Unscoped），不随资源软删。
		// 说明：ResourceLabel 为资源附属元数据，资源软删后即孤儿数据；物理删除可避免
		// 与软删资源关联的脏数据残留（如标签按 resource_id 反查命中已删资源）。MVP 无
		// 恢复/回滚需求，故不采用级联软删（资源软删的 DeletedAt 语义已足够表达删除）。
		if err := db.Unscoped().Where("resource_id = ?", resourceID).Delete(&models.ResourceLabel{}).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("清理资源 %s 的标签失败：%w", resourceID, err))
			return
		}

		if err := db.Delete(model).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("删除 %s 资源 %s 失败：%w", category, resourceID, err))
			return
		}
		response.OK(c, gin.H{"resource_id": resourceID})
	}
}

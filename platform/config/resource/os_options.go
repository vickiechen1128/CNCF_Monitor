// os_options.go 提供操作系统内置字典接口（GET /api/v2/platform/os-options）：
// 返回常用操作系统「规范名 → 家族（linux/windows）」清单，供 M07 资源录入下拉
// 与采集 Job monitor 家族匹配使用（数据权威见 models/os_dict.go）。只读，无参数。
package resource

import (
	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
)

// ListOSOptions 是 GET /api/v2/platform/os-options 的 handler。
// 响应 data：`{list}`，list item 为 {name, family}（OSOption）。
func ListOSOptions() gin.HandlerFunc {
	return func(c *gin.Context) {
		response.OK(c, gin.H{"list": models.ListOSOptions()})
	}
}
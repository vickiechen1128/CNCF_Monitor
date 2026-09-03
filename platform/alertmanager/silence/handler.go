package silence

import (
	"errors"
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
)

// queryPage 解析 page/page_size，带默认与上限（复用控制面约定）。
func queryPage(c *gin.Context) (page, pageSize int) {
	page = 1
	pageSize = 20
	if v := c.Query("page"); v != "" {
		fmt.Sscanf(v, "%d", &page)
	}
	if v := c.Query("page_size"); v != "" {
		fmt.Sscanf(v, "%d", &pageSize)
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return page, pageSize
}

// ListHandler 处理 GET /api/v2/platform/alertmanager/silences
// （契约 §4：分页信封，缺省仅返回活跃静默；空结果返回 []）。
// review-fix E：由 svc.List 全量拉取 AM 静默后在内存分页（MVP 边界，见 Proxy.ListSilences），
// active 过滤仅在服务层完成，未前置到 AM 侧——静默量日后增长时需升级为 AM filter/limit。
func ListHandler(svc *Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		activeOnly := strings.ToLower(c.DefaultQuery("active", "true")) != "false"
		list, err := svc.List(c.Request.Context(), activeOnly)
		if err != nil {
			// 静默列表完全依赖中心 Alertmanager（决策 59 直调、不入 M09 流水线）；
			// AM 未启动/不可达属上游依赖故障，回 502 + 可执行引导，而非掩蔽的 internal error。
			response.BadGateway(c, err, "中心 Alertmanager 服务不可达或未启动，无法加载静默列表，请先启动中心 Alertmanager")
			return
		}
		page, pageSize := queryPage(c)
		total, items := paginate(list, page, pageSize)
		response.OK(c, gin.H{"items": items, "total": total})
	}
}

// CreateHandler 处理 POST /api/v2/platform/alertmanager/silences
// （契约 §4 / 决策 56：服务端校验 matcher 授权收敛，越权 bad_request）。
func CreateHandler(svc *Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		var in CreateInput
		if err := c.ShouldBindJSON(&in); err != nil {
			response.BadRequest(c, fmt.Errorf("解析请求体失败: %w", err))
			return
		}
		// MVP 单租户：授权集合恒全量（决策 56 骨架，未来从认证上下文构建）。
		scope := buildScopeForUser()
		created, err := svc.Create(c.Request.Context(), scope, in)
		if err != nil {
			response.BadRequest(c, err)
			return
		}
		response.OK(c, created)
	}
}

// DeleteHandler 处理 DELETE /api/v2/platform/alertmanager/silences/{silence_id}
// （契约 §4：代理 AM 删除；不存在返回 not_found）。
func DeleteHandler(svc *Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("silence_id")
		deletedID, err := svc.Delete(c.Request.Context(), id)
		if errors.Is(err, ErrSilenceNotFound) {
			response.NotFound(c, err.Error())
			return
		}
		if err != nil {
			// 删除亦依赖中心 Alertmanager（先查询再删除）；AM 未启动/不可达同回 502 引导。
			response.BadGateway(c, err, "中心 Alertmanager 服务不可达或未启动，无法删除静默，请先启动中心 Alertmanager")
			return
		}
		response.OK(c, gin.H{"id": deletedID})
	}
}

// paginate 对已加载列表做内存分页，返回 (total, 当前页切片)。
func paginate(list []Silence, page, pageSize int) (int, []Silence) {
	total := len(list)
	if pageSize <= 0 {
		pageSize = 20
	}
	start := (page - 1) * pageSize
	if start < 0 {
		start = 0
	}
	if start >= total {
		return total, []Silence{}
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	return total, list[start:end]
}
package resource

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
)

// CreateBusinessDomainRequest 是登记业务分组的请求体（决策 48）：code 创建后不可改。
type CreateBusinessDomainRequest struct {
	Code        string `json:"code"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

// UpdateBusinessDomainRequest 是受限编辑业务分组的请求体（决策 48）：仅接受
// name/description/enabled；不接收 code（code 创建后不可改）。
type UpdateBusinessDomainRequest struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	Enabled     *bool   `json:"enabled"`
}

// validateCreateBusinessDomain 纯函数校验登记请求：编码规范（小写字母/数字/连字符
// ≤64）与 name 非空。返回含人读文案的错误，供 handler 包装为 bad_request。
func validateCreateBusinessDomain(req *CreateBusinessDomainRequest) error {
	req.Code = strings.TrimSpace(req.Code)
	req.Name = strings.TrimSpace(req.Name)
	if !models.ValidBizCode.MatchString(req.Code) {
		return fmt.Errorf("编码仅允许小写字母、数字和连字符，长度不超过 64")
	}
	if req.Name == "" {
		return fmt.Errorf("name 必填")
	}
	return nil
}

// CreateBusinessDomain 是 POST /api/v2/platform/business-domains 的登记 handler
// （决策 48）：body {code,name,description}；默认 enabled=true；编码不规范/重名/
// name 为空 → bad_request。
func CreateBusinessDomain(store *BusinessDomainStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateBusinessDomainRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("请求体解析失败：%w", err))
			return
		}
		if err := validateCreateBusinessDomain(&req); err != nil {
			response.BadRequest(c, err)
			return
		}
		_, found, err := store.Lookup(req.Code)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if found {
			response.BadRequest(c, fmt.Errorf("该业务编码已存在：%s", req.Code))
			return
		}
		created, err := store.Create(models.BusinessDomain{
			Code:        req.Code,
			Name:        req.Name,
			Description: req.Description,
			Enabled:     true, // 登记默认启用（决策 48）
		})
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, created)
	}
}

// UpdateBusinessDomain 是 PUT /api/v2/platform/business-domains/:code 的受限编辑
// handler（决策 48）：仅 name/description/enabled 可改；code==infra 且停用(enabled 置
// false) → bad_request；无 DELETE 入口（停用不删除）。
func UpdateBusinessDomain(store *BusinessDomainStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		code := strings.TrimSpace(c.Param("code"))
		if code == "" {
			response.BadRequest(c, fmt.Errorf("code 必填"))
			return
		}
		var req UpdateBusinessDomainRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("请求体解析失败：%w", err))
			return
		}
		if req.Name != nil && strings.TrimSpace(*req.Name) == "" {
			response.BadRequest(c, fmt.Errorf("name 不能为空"))
			return
		}
		_, found, err := store.Lookup(code)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if !found {
			response.NotFound(c, fmt.Sprintf("业务 %s 不存在", code))
			return
		}
		// infra 兜底条目禁止停用（决策 48 红线）。
		if code == models.InfraBizCode && req.Enabled != nil && !*req.Enabled {
			response.BadRequest(c, fmt.Errorf("infra 为无业务归属设备的兜底分组，不可停用"))
			return
		}
		updated, err := store.Update(code, req)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, updated)
	}
}
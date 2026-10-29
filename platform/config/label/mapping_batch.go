package label

import (
	"errors"
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"gorm.io/gorm"
)

// ReplaceLabelMappingsRequest 是一次统一保存的完整映射列表。
type ReplaceLabelMappingsRequest struct {
	Mappings []CreateMappingRequest `json:"mappings"`
}

// ReplaceLabelMappings 处理 PUT /:template_id/mappings，整组校验并原子保存映射。
func ReplaceLabelMappings(svc *MappingBatchService) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseTemplateID(c)
		if !ok {
			response.BadRequest(c, fmt.Errorf("template_id 非法"))
			return
		}
		var req ReplaceLabelMappingsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("invalid mappings payload: %w", err))
			return
		}
		if req.Mappings == nil {
			response.BadRequest(c, fmt.Errorf("mappings 必须提供；保存空列表时请传 []"))
			return
		}
		mappings, err := svc.Replace(id, req.Mappings)
		if err != nil {
			switch {
			case errors.Is(err, gorm.ErrRecordNotFound):
				response.NotFound(c, fmt.Sprintf("label template %d not found", id))
			case errors.Is(err, ErrDefaultTemplateMappingReadOnly):
				response.BadRequest(c, err)
			case errors.Is(err, ErrMappingBatchValidation):
				response.BadRequest(c, err)
			default:
				response.InternalServerError(c, err)
			}
			return
		}
		response.OK(c, mappings)
	}
}

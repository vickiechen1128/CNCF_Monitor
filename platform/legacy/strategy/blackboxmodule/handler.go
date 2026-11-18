package blackboxmodule

import (
	"errors"
	"fmt"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
)

func listModules(svc *Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		items, err := svc.List()
		if err != nil {
			respondError(c, err)
			return
		}
		page, pageSize := pageParams(c)
		total := len(items)
		start := (page - 1) * pageSize
		if start > total {
			start = total
		}
		end := start + pageSize
		if end > total {
			end = total
		}
		response.OK(c, gin.H{"list": items[start:end], "total": total, "page": page, "page_size": pageSize})
	}
}

func createModule(svc *Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		var input struct {
			Name    string `json:"name" binding:"required"`
			Content string `json:"content" binding:"required"`
		}
		if err := c.ShouldBindJSON(&input); err != nil {
			response.BadRequest(c, fmt.Errorf("解析请求体失败: %w", err))
			return
		}
		item, err := svc.Create(input.Name, input.Content)
		if err != nil {
			respondError(c, err)
			return
		}
		response.OK(c, item)
	}
}

func updateModule(svc *Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseUint(c.Param("id"), 10, 64)
		if err != nil {
			response.BadRequest(c, fmt.Errorf("模块 ID 非法"))
			return
		}
		var input struct {
			Content string `json:"content" binding:"required"`
			Enabled bool   `json:"enabled"`
		}
		if err := c.ShouldBindJSON(&input); err != nil {
			response.BadRequest(c, fmt.Errorf("解析请求体失败: %w", err))
			return
		}
		item, err := svc.Update(uint(id), input.Content, input.Enabled)
		if err != nil {
			respondError(c, err)
			return
		}
		response.OK(c, item)
	}
}

func deleteModule(svc *Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseUint(c.Param("id"), 10, 64)
		if err != nil {
			response.BadRequest(c, fmt.Errorf("模块 ID 非法"))
			return
		}
		if err := svc.Delete(uint(id)); err != nil {
			respondError(c, err)
			return
		}
		response.OK(c, gin.H{"deleted": true})
	}
}

func respondError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		response.NotFound(c, err.Error())
	case errors.Is(err, ErrConflict):
		response.Conflict(c, err)
	case errors.Is(err, ErrValidation):
		response.BadRequest(c, err)
	default:
		response.InternalServerError(c, err)
	}
}

func pageParams(c *gin.Context) (int, int) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
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

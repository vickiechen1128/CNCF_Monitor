// Package common 提供 Module_01 监控策略各 strategy 子包共用的列表分页解析。
package common

import (
	"net/url"
	"strconv"
)

// 分页常量：03_API_Standard §7.2 + api-contract-snapshot §1.3 默认 page_size=20，
// 上限 100。
const (
	// DefaultPageSize 是列表分页默认每页条数。
	DefaultPageSize = 20
	// MaxPageSize 是每页条数上限，超出钳制到 100。
	MaxPageSize = 100
)

// PageParams 是解析后的分页参数。
type PageParams struct {
	Page     int
	PageSize int
}

// ParsePageParams 解析 page/page_size 查询参数：page 默认 1、page_size 默认 20
// （上限 100，超出钳制到 100）；非法/负数回退默认值。
func ParsePageParams(values url.Values) PageParams {
	return PageParams{
		Page:     parseIntDefault(values.Get("page"), 1, 1),
		PageSize: parseIntDefaultWithMax(values.Get("page_size"), DefaultPageSize),
	}
}

func parseIntDefaultWithMax(raw string, def int) int {
	v := parseIntDefault(raw, def, 1)
	if v > MaxPageSize {
		return MaxPageSize
	}
	return v
}

// parseIntDefault 解析整型查询参数：空/非法/<min 时返回默认值。
func parseIntDefault(raw string, def, min int) int {
	if raw == "" {
		return def
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < min {
		return def
	}
	return v
}
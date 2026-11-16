package repository

import "gorm.io/gorm"

// DefaultPageSize and MaxPageSize mirror the v3 platform pagination contract.
const (
	DefaultPageSize = 20
	MaxPageSize     = 100
)

// normalizePage clamps page/page_size to the contract range.
func normalizePage(page, pageSize int) (int, int) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = DefaultPageSize
	}
	if pageSize > MaxPageSize {
		pageSize = MaxPageSize
	}
	return page, pageSize
}

// paginate applies the normalized offset/limit to a query.
func paginate(q *gorm.DB, page, pageSize int) *gorm.DB {
	page, pageSize = normalizePage(page, pageSize)
	return q.Offset((page - 1) * pageSize).Limit(pageSize)
}

// keywordFilter applies a case-insensitive contains match when keyword is set.
func keywordFilter(q *gorm.DB, column, keyword string) *gorm.DB {
	if keyword == "" {
		return q
	}
	return q.Where(column+" LIKE ?", "%"+keyword+"%")
}

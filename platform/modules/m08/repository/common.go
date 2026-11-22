package repository

import (
	"errors"
	"fmt"
	"strings"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
)

// mapWriteError converts PostgreSQL uniqueness violations into domain
// conflicts and wraps everything else with context.
func mapWriteError(err error, entity, field, value string) error {
	if err == nil {
		return nil
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "duplicate key value violates unique constraint") {
		return &domain.ConflictError{
			Message: fmt.Sprintf("%s conflict: %s %q already exists", entity, field, value),
		}
	}
	return fmt.Errorf("write %s: %w", entity, err)
}

func isNotFound(err error) bool { return errors.Is(err, gorm.ErrRecordNotFound) }

func notFound(entity, id string) error {
	return &domain.NotFoundError{Entity: entity, ID: id}
}

// paginate applies the shared page/page_size bounds (default 20, max 100).
func paginate(q *gorm.DB, page, pageSize int) *gorm.DB {
	page, pageSize = normalizePage(page, pageSize)
	return q.Offset((page - 1) * pageSize).Limit(pageSize)
}

// keywordLike adds a case-insensitive OR match over the given columns.
func keywordLike(q *gorm.DB, keyword string, columns ...string) *gorm.DB {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" || len(columns) == 0 {
		return q
	}
	pattern := "%" + strings.ToLower(keyword) + "%"
	parts := make([]string, 0, len(columns))
	args := make([]any, 0, len(columns))
	for _, column := range columns {
		parts = append(parts, fmt.Sprintf("LOWER(%s) LIKE ?", column))
		args = append(args, pattern)
	}
	return q.Where("("+strings.Join(parts, " OR ")+")", args...)
}

func normalizePage(page, pageSize int) (int, int) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return page, pageSize
}

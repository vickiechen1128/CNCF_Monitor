package repository

import (
	"errors"
	"fmt"
	"strings"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// mapWriteError converts database uniqueness violations into domain conflicts
// and wraps everything else with context. SQLite and PostgreSQL report
// uniqueness with different messages, so both are recognised.
func mapWriteError(err error, entity, field, value string) error {
	if err == nil {
		return nil
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "unique constraint failed") ||
		strings.Contains(msg, "duplicate key value violates unique constraint") {
		return &domain.ConflictError{Entity: entity, Field: field, Value: value}
	}
	return fmt.Errorf("write %s: %w", entity, err)
}

func isNotFound(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}

func notFound(entity, id string) error {
	return &domain.NotFoundError{Entity: entity, ID: id}
}

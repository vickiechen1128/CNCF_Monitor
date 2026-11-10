// Package domain contains the M07 resource domain model.
//
// It intentionally has no GORM or Gin dependency: persistence and HTTP
// adapters live in sibling packages.
package domain

import (
	"fmt"
	"strings"
)

// Category is the coarse-grained resource category.
type Category string

// Resource categories (authoritative v3 enum).
const (
	CategoryHost             Category = "host"
	CategoryDatabase         Category = "database"
	CategoryMiddleware       Category = "middleware"
	CategoryApplication      Category = "application"
	CategoryGenericTarget    Category = "generic_target"
	CategoryInterfaceService Category = "interface_service"
)

// AllCategories returns categories in contract order.
func AllCategories() []Category {
	return []Category{
		CategoryHost,
		CategoryDatabase,
		CategoryMiddleware,
		CategoryApplication,
		CategoryGenericTarget,
		CategoryInterfaceService,
	}
}

// Valid reports whether c is a known category.
func (c Category) Valid() bool {
	switch c {
	case CategoryHost, CategoryDatabase, CategoryMiddleware,
		CategoryApplication, CategoryGenericTarget, CategoryInterfaceService:
		return true
	default:
		return false
	}
}

// ParseCategory parses a user/API supplied category.
func ParseCategory(raw string) (Category, error) {
	c := Category(strings.TrimSpace(raw))
	if !c.Valid() {
		return "", fmt.Errorf("invalid resource_category %q (want %s)", raw, CategoryHint())
	}
	return c, nil
}

// CategoryHint returns a slash-separated category list for error messages.
func CategoryHint() string {
	cats := AllCategories()
	parts := make([]string, 0, len(cats))
	for _, c := range cats {
		parts = append(parts, string(c))
	}
	return strings.Join(parts, "/")
}

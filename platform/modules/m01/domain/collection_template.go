package domain

import (
	"regexp"
	"strings"
	"time"
)

// CollectionTemplate is one collection recipe (SRS Module_01 v1.5 §3.1).
//
// A template answers "how to collect": exactly one exporter implementation, one
// parameter set and one label template. It deliberately does NOT carry the scope
// of resources it applies to — that lives on the scrape job selector (FR-22) —
// otherwise the removed "monitor object type" layer would come back under a new
// name.
type CollectionTemplate struct {
	Code               string
	Name               string
	ResourceCategory   ResourceCategory
	ExporterTemplateID string
	DefaultPort        int
	MetricsPath        string
	Scheme             Scheme
	ScrapeInterval     string
	ScrapeTimeout      string
	LabelTemplateID    string
	// DefaultSelector is a wizard prefill only. The backend never evaluates it;
	// each job stores its own selector.
	DefaultSelector Selector
	Description     string
	SortOrder       int
	Enabled         bool
	IsBuiltin       bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

var collectionTemplateCodeRegex = regexp.MustCompile(`^[a-z][a-z0-9_]{1,63}$`)

// ValidateCollectionTemplate checks the template shape (FR-21).
//
// Exporter existence and label-template category are resolved by the service;
// this function only enforces the self-contained invariants.
func ValidateCollectionTemplate(t CollectionTemplate) error {
	if err := ValidateCollectionTemplateCode(t.Code); err != nil {
		return err
	}
	if strings.TrimSpace(t.Name) == "" {
		return NewValidationError("name", "is required")
	}
	if !t.ResourceCategory.Valid() {
		return NewValidationErrorf("resource_category", "unknown category %q", t.ResourceCategory)
	}
	if err := ValidatePort(t.DefaultPort); err != nil {
		return err
	}
	if t.MetricsPath == "" {
		return NewValidationError("metrics_path", "is required")
	}
	if err := ValidateMetricsPath(t.MetricsPath); err != nil {
		return err
	}
	if !t.Scheme.Valid() {
		return NewValidationError("scheme", "must be http or https")
	}
	if err := ValidateScrapeTiming(t.ScrapeInterval, t.ScrapeTimeout); err != nil {
		return err
	}
	return ValidateSelector(t.DefaultSelector, t.ResourceCategory)
}

// ValidateCollectionTemplateCode checks the immutable template code shape.
func ValidateCollectionTemplateCode(code string) error {
	if !collectionTemplateCodeRegex.MatchString(strings.TrimSpace(code)) {
		return NewValidationErrorf("code",
			"must match %s (lowercase letters, digits and underscore)", collectionTemplateCodeRegex.String())
	}
	return nil
}

// NormalizeCollectionTemplate trims user input and applies parameter defaults.
func NormalizeCollectionTemplate(t *CollectionTemplate) {
	t.Code = strings.TrimSpace(t.Code)
	t.Name = strings.TrimSpace(t.Name)
	t.ExporterTemplateID = strings.TrimSpace(t.ExporterTemplateID)
	t.LabelTemplateID = strings.TrimSpace(t.LabelTemplateID)
	t.MetricsPath = strings.TrimSpace(t.MetricsPath)
	t.Description = strings.TrimSpace(t.Description)
	t.DefaultSelector = t.DefaultSelector.Normalize()
	if t.MetricsPath == "" {
		t.MetricsPath = DefaultMetricsPath
	}
	if t.Scheme == "" {
		t.Scheme = SchemeHTTP
	}
	if t.ScrapeInterval == "" {
		t.ScrapeInterval = DefaultScrapeInterval
	}
	if t.ScrapeTimeout == "" {
		t.ScrapeTimeout = DefaultScrapeTimeout
	}
	if t.SortOrder == 0 {
		t.SortOrder = 500
	}
}

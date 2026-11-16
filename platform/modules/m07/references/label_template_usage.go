package references

import "context"

// LabelTemplateUsageChecker reports how many M01 source records still reference
// a label template. M07 owns templates but must not import M01, so the counter
// is injected by the v3 composition root (D23-style port).
type LabelTemplateUsageChecker interface {
	CountReferences(ctx context.Context, templateID string) (int64, error)
}

// NoopLabelTemplateUsageChecker allows deletion. It is used by tests and by
// early startup wiring; production injects M01's counter.
type NoopLabelTemplateUsageChecker struct{}

// CountReferences implements LabelTemplateUsageChecker.
func (NoopLabelTemplateUsageChecker) CountReferences(context.Context, string) (int64, error) {
	return 0, nil
}

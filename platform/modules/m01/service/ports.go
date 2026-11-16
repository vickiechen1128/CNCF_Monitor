package service

import (
	"context"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// LabelTemplateResolver resolves a label template id into its read-only
// projection. M01 only reads templates owned by M07 (D-3).
type LabelTemplateResolver interface {
	Resolve(ctx context.Context, id string) (domain.LabelTemplateRef, bool, error)
}

// NoopLabelTemplateResolver accepts any non-empty template id and returns an
// empty projection. It is the fallback when no M07 reader is wired.
type NoopLabelTemplateResolver struct{}

// Resolve implements LabelTemplateResolver.
func (NoopLabelTemplateResolver) Resolve(_ context.Context, id string) (domain.LabelTemplateRef, bool, error) {
	return domain.LabelTemplateRef{ID: id}, true, nil
}

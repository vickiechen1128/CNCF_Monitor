package service

import "context"

// LabelTemplateResolver resolves a label template id into its display name and
// existence. M01 only reads templates owned by M07 (D-3); until that API lands
// the default implementation accepts ids without verification.
type LabelTemplateResolver interface {
	Resolve(ctx context.Context, id string) (name string, found bool, err error)
}

// NoopLabelTemplateResolver accepts any non-empty template id and returns an
// empty name. It is the D-3 placeholder: FR-03 name/preview degrades until M07
// exposes label templates in v3.
type NoopLabelTemplateResolver struct{}

// Resolve implements LabelTemplateResolver.
func (NoopLabelTemplateResolver) Resolve(context.Context, string) (string, bool, error) {
	return "", true, nil
}

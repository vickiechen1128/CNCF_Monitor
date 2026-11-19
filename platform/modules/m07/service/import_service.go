package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m07/dictionary"
	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m07/importer"
	"github.com/metriccenter/metriccenter/platform/modules/m07/references"
	"github.com/metriccenter/metriccenter/platform/modules/m07/repository"
)

// ImportService implements Excel import use cases.
type ImportService struct {
	resources    repository.ResourceRepository
	imports      repository.ImportRepository
	dict         DictionaryResolver
	declarations dictionary.DeclarationWriter
	// 能力属性写入端口（SRS Module_07 v2.1 FR-31）。未接入时 attributes 列会被拒绝，
	// 避免导入「看起来成功但属性被静默丢弃」。
	attributeDefs  repository.AttributeDefinitionRepository
	attributeStore repository.ResourceAttributeRepository
	notifier       references.ResourceChangeNotifier
}

// NewImportService constructs an import service.
func NewImportService(resources repository.ResourceRepository, imports repository.ImportRepository, dict DictionaryResolver, declarations ...dictionary.DeclarationWriter) *ImportService {
	svc := &ImportService{resources: resources, imports: imports, dict: dict, notifier: references.NoopChangeNotifier{}}
	if len(declarations) > 0 {
		svc.declarations = declarations[0]
	}
	return svc
}

// SetChangeNotifier wires the best-effort M01/M09 change notification port.
func (s *ImportService) SetChangeNotifier(notifier references.ResourceChangeNotifier) {
	if notifier != nil {
		s.notifier = notifier
	}
}

// SetAttributeWriter wires the capability dictionary and value store used by the
// optional "attributes" column (FR-31).
func (s *ImportService) SetAttributeWriter(defs repository.AttributeDefinitionRepository, store repository.ResourceAttributeRepository) {
	s.attributeDefs = defs
	s.attributeStore = store
}

// Import parses, validates and applies an Excel import.
func (s *ImportService) Import(ctx context.Context, category domain.Category, mode domain.ImportMode, fileBytes []byte, operator string) (*domain.ImportRecord, error) {
	if !category.Valid() {
		return nil, &domain.UnsupportedCategoryError{Category: string(category)}
	}
	if mode != domain.ImportModeCreateOnly && mode != domain.ImportModeUpsert {
		return nil, &domain.ValidationError{Field: "mode", Message: "must be create_only or upsert"}
	}

	rows, err := importer.ParseExcel(fileBytes, category)
	if err != nil {
		return nil, &domain.ValidationError{Field: "file", Message: err.Error()}
	}
	declarations, err := importer.ParseDeclareSheets(fileBytes)
	if err != nil {
		return nil, &domain.ValidationError{Field: "file", Message: err.Error()}
	}
	if err := importer.ValidateDeclarations(declarations); err != nil {
		return nil, &domain.ValidationError{Field: "declarations", Message: err.Error()}
	}
	if !declarations.Empty() {
		if s.declarations == nil {
			return nil, &domain.ValidationError{Field: "declarations", Message: "declaration sheets are not supported by this importer"}
		}
		if err := s.declarations.EnsureDeclarations(ctx, toDeclared(declarations.Biz), toDeclared(declarations.App), toDeclared(declarations.Platform)); err != nil {
			return nil, &domain.ValidationError{Field: "declarations", Message: err.Error()}
		}
	}

	valid, errs := importer.ValidateRows(rows)
	record := &domain.ImportRecord{
		ImportNo:         newImportNo(),
		ResourceCategory: category,
		Mode:             mode,
		Total:            len(rows),
		Errors:           errs,
		Operator:         operator,
	}

	for _, item := range valid {
		resource := item.Resource
		resource.SourceType = domain.SourceImport
		if err := s.resolvePlatform(ctx, resource); err != nil {
			record.Failed++
			record.Errors = append(record.Errors, importDetail(item.RowNumber, resource, "", err))
			continue
		}
		if err := s.dict.ValidateResource(ctx, resource); err != nil {
			record.Failed++
			record.Errors = append(record.Errors, importDetail(item.RowNumber, resource, "", err))
			continue
		}
		if err := resource.Validate(); err != nil {
			record.Failed++
			record.Errors = append(record.Errors, importDetail(item.RowNumber, resource, "", err))
			continue
		}
		if err := resource.EnsureDedupKey(); err != nil {
			record.Failed++
			record.Errors = append(record.Errors, importDetail(item.RowNumber, resource, "", err))
			continue
		}
		// 能力属性先校验再落资源：字典不认识的 key 或非法取值直接判本行失败，
		// 避免「资源已建、属性被静默丢弃」（FR-31）。
		attributes, err := s.validateImportAttributes(ctx, category, item.Attributes)
		if err != nil {
			record.Failed++
			record.Errors = append(record.Errors, domain.ImportErrorDetail{
				Row: item.RowNumber, ResourceCategory: string(category),
				Field: "attributes", Value: formatAttributePairs(item.Attributes), Reason: err.Error(),
			})
			continue
		}

		existing, found, err := s.resources.FindByDedupKey(ctx, resource.TenantID, category, resource.DedupKey)
		if err != nil {
			return nil, err
		}
		if found {
			if mode == domain.ImportModeCreateOnly {
				record.Failed++
				record.Errors = append(record.Errors, domain.ImportErrorDetail{
					Row:              item.RowNumber,
					ResourceCategory: string(category),
					Field:            "dedup_key",
					Value:            resource.DedupKey,
					Reason:           fmt.Sprintf("resource %s already exists (create_only does not overwrite)", existing.ResourceID),
				})
				continue
			}
			resource.ResourceID = existing.ResourceID
			if err := s.resources.Update(ctx, resource); err != nil {
				return nil, err
			}
			if len(attributes) > 0 {
				if err := s.mergeImportAttributes(ctx, resource.ResourceID, attributes); err != nil {
					return nil, err
				}
			}
			record.Updated++
			continue
		}
		if err := s.resources.Create(ctx, resource); err != nil {
			if conflict, ok := err.(*domain.ConflictError); ok {
				record.Failed++
				record.Errors = append(record.Errors, domain.ImportErrorDetail{
					Row:              item.RowNumber,
					ResourceCategory: string(category),
					Field:            "dedup_key",
					Value:            conflict.DedupKey,
					Reason:           conflict.Error(),
				})
				continue
			}
			return nil, err
		}
		if len(attributes) > 0 {
			if err := s.mergeImportAttributes(ctx, resource.ResourceID, attributes); err != nil {
				return nil, err
			}
		}
		record.Success++
	}

	record.Status = domain.ImportStatusSuccess
	if record.Failed > 0 {
		record.Status = domain.ImportStatusPartial
	}
	if record.Success == 0 && record.Updated == 0 && record.Failed > 0 {
		record.Status = domain.ImportStatusFailed
	}
	if err := s.imports.Create(ctx, record); err != nil {
		return nil, err
	}
	if record.Success > 0 || record.Updated > 0 {
		s.notifier.AllResourcesChanged(ctx)
	}
	return record, nil
}

// List returns import records.
func (s *ImportService) List(ctx context.Context, category, status string) ([]*domain.ImportRecord, error) {
	return s.imports.List(ctx, category, status)
}

// Get returns one import record.
func (s *ImportService) Get(ctx context.Context, importID string) (*domain.ImportRecord, error) {
	return s.imports.Get(ctx, importID)
}

func (s *ImportService) resolvePlatform(ctx context.Context, resource *domain.Resource) error {
	return resolvePlatformFor(ctx, s.dict, resource)
}

func importDetail(rowNumber int, resource *domain.Resource, field string, err error) domain.ImportErrorDetail {
	detail := domain.ImportErrorDetail{
		Row:              rowNumber,
		ResourceCategory: string(resource.Category),
		Field:            field,
		Reason:           err.Error(),
	}
	if validation, ok := err.(*domain.ValidationError); ok && field == "" {
		detail.Field = validation.Field
	}
	return detail
}

func toDeclared(entries []importer.DeclareEntry) []dictionary.DeclaredEntry {
	out := make([]dictionary.DeclaredEntry, 0, len(entries))
	for _, entry := range entries {
		out = append(out, dictionary.DeclaredEntry{
			Code: entry.Code, Name: entry.Name, Description: entry.Description,
		})
	}
	return out
}

func newImportNo() string {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("IMP%s", time.Now().UTC().Format("20060102150405"))
	}
	return fmt.Sprintf("IMP%s%s", time.Now().UTC().Format("20060102150405"), hex.EncodeToString(b))
}

// validateImportAttributes checks the parsed "attributes" column against the
// capability dictionary of the resource category. It returns only the values
// that should be stored (empty optional values are dropped).
func (s *ImportService) validateImportAttributes(ctx context.Context, category domain.Category, pairs map[string]string) ([]*domain.ResourceAttribute, error) {
	if len(pairs) == 0 {
		return nil, nil
	}
	if s.attributeStore == nil {
		return nil, &domain.ValidationError{Field: "attributes", Message: "this importer does not support capability attributes"}
	}
	definitions, err := s.attributeDefs.List(ctx, category)
	if err != nil {
		return nil, err
	}
	byKey := make(map[string]*domain.AttributeDefinition, len(definitions))
	for _, def := range definitions {
		byKey[def.Key] = def
	}
	out := make([]*domain.ResourceAttribute, 0, len(pairs))
	for key, raw := range pairs {
		def, ok := byKey[key]
		if !ok {
			return nil, &domain.ValidationError{
				Field:   "attributes",
				Message: fmt.Sprintf("attribute %q is not registered for category %q", key, category),
			}
		}
		if def.EffectiveStatus() != domain.AttributeStatusActive {
			return nil, &domain.ValidationError{
				Field: "attributes", Message: fmt.Sprintf("attribute %q is removed from the model", key),
			}
		}
		value, err := def.ValidateValue(raw)
		if err != nil {
			return nil, err
		}
		if value == "" {
			continue
		}
		out = append(out, &domain.ResourceAttribute{Key: key, Value: value})
	}
	return out, nil
}

// mergeImportAttributes upserts the imported keys without dropping capability
// values that are maintained through the UI and are absent from the sheet.
func (s *ImportService) mergeImportAttributes(ctx context.Context, resourceID string, incoming []*domain.ResourceAttribute) error {
	existing, err := s.attributeStore.ListByResource(ctx, resourceID)
	if err != nil {
		return err
	}
	merged := make(map[string]*domain.ResourceAttribute, len(existing)+len(incoming))
	for _, attr := range existing {
		merged[attr.Key] = &domain.ResourceAttribute{Key: attr.Key, Value: attr.Value}
	}
	for _, attr := range incoming {
		merged[attr.Key] = &domain.ResourceAttribute{Key: attr.Key, Value: attr.Value}
	}
	out := make([]*domain.ResourceAttribute, 0, len(merged))
	for _, attr := range merged {
		out = append(out, attr)
	}
	return s.attributeStore.Replace(ctx, resourceID, out)
}

// formatAttributePairs renders pairs for the import error report.
func formatAttributePairs(pairs map[string]string) string {
	keys := make([]string, 0, len(pairs))
	for key := range pairs {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, key+"="+pairs[key])
	}
	return strings.Join(parts, ";")
}

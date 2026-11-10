package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m07/dictionary"
	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m07/importer"
	"github.com/metriccenter/metriccenter/platform/modules/m07/repository"
)

// ImportService implements Excel import use cases.
type ImportService struct {
	resources    repository.ResourceRepository
	imports      repository.ImportRepository
	dict         DictionaryResolver
	declarations dictionary.DeclarationWriter
}

// NewImportService constructs an import service.
func NewImportService(resources repository.ResourceRepository, imports repository.ImportRepository, dict DictionaryResolver, declarations ...dictionary.DeclarationWriter) *ImportService {
	svc := &ImportService{resources: resources, imports: imports, dict: dict}
	if len(declarations) > 0 {
		svc.declarations = declarations[0]
	}
	return svc
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

		existing, found, err := s.resources.FindByDedupKey(ctx, category, resource.DedupKey)
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
	if strings.TrimSpace(resource.PlatformCode) != "" || strings.TrimSpace(resource.AppCode) == "" {
		return nil
	}
	platform, ok, err := s.dict.PrimaryPlatformOfApp(ctx, resource.AppCode)
	if err != nil {
		return err
	}
	if ok {
		resource.PlatformCode = platform
	}
	return nil
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

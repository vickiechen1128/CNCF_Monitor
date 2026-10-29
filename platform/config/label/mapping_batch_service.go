package label

import (
	"errors"
	"fmt"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
)

var (
	// ErrDefaultTemplateMappingReadOnly 表示默认模板不允许修改映射。
	ErrDefaultTemplateMappingReadOnly = errors.New("默认模板只读保护，映射变更请基于默认模板克隆后操作")
	// ErrMappingBatchValidation 表示整组映射校验失败。
	ErrMappingBatchValidation = errors.New("mapping batch validation failed")
)

// MappingBatchService 编排整组映射校验与统一保存。
type MappingBatchService struct {
	repo *MappingBatchRepository
}

// NewMappingBatchService 创建整组映射服务。
func NewMappingBatchService(repo *MappingBatchRepository) *MappingBatchService {
	return &MappingBatchService{repo: repo}
}

// Replace 校验并替换模板的完整映射列表。
func (s *MappingBatchService) Replace(templateID uint, inputs []CreateMappingRequest) ([]models.LabelMapping, error) {
	tmpl, err := s.repo.getTemplate(templateID)
	if err != nil {
		return nil, err
	}
	if tmpl.IsDefault {
		return nil, ErrDefaultTemplateMappingReadOnly
	}
	mappings, err := normalizeBatchMappings(inputs)
	if err != nil {
		return nil, err
	}
	if err := s.repo.replaceMappings(templateID, mappings); err != nil {
		return nil, err
	}
	return mappings, nil
}

func normalizeBatchMappings(inputs []CreateMappingRequest) ([]models.LabelMapping, error) {
	mappings := make([]models.LabelMapping, 0, len(inputs))
	for i, input := range inputs {
		sourceField := strings.TrimSpace(input.SourceField)
		targetLabel, err := resolveCreateTargetLabel(input.SourceType, sourceField, input.TargetLabel)
		if err != nil {
			return nil, fmt.Errorf("%w: mappings[%d]: %v", ErrMappingBatchValidation, i, err)
		}
		transform := ""
		if input.TransformRule != nil {
			transform = strings.TrimSpace(*input.TransformRule)
		}
		enabled := true
		if input.Enabled != nil {
			enabled = *input.Enabled
		}
		mappings = append(mappings, models.LabelMapping{
			SourceField: sourceField,
			SourceType:  input.SourceType,
			TargetLabel: targetLabel,
			Enabled:     enabled,
			Transform:   transform,
		})
	}
	if err := validateMappings(mappings); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrMappingBatchValidation, err)
	}
	return mappings, nil
}

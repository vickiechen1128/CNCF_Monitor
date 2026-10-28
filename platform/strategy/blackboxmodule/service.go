package blackboxmodule

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"gopkg.in/yaml.v3"
)

var (
	// ErrNotFound 表示模块不存在。
	ErrNotFound = errors.New("blackbox module not found")
	// ErrConflict 表示模块重名或被 Job 引用。
	ErrConflict = errors.New("blackbox module conflict")
	// ErrValidation 表示模块名或 YAML 内容不合法。
	ErrValidation = errors.New("blackbox module validation failed")
)

var moduleNamePattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)

// ModuleView 是模块及其 Job 引用情况。
type ModuleView struct {
	models.BlackboxModule
	Prober         string `json:"prober"`
	ReferencedJobs int64  `json:"referenced_jobs"`
}

// Service 编排拨测模块管理规则。
type Service struct {
	repo *Repository
}

// NewService 创建拨测模块服务。
func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// List 返回全部模块及引用计数。
func (s *Service) List() ([]ModuleView, error) {
	items, err := s.repo.list()
	if err != nil {
		return nil, err
	}
	views := make([]ModuleView, 0, len(items))
	for _, item := range items {
		prober, err := validateModule(item.Name, item.Content)
		if err != nil {
			prober = "-"
		}
		references, err := s.repo.referencedJobs(item.Name)
		if err != nil {
			return nil, err
		}
		views = append(views, ModuleView{BlackboxModule: item, Prober: prober, ReferencedJobs: references})
	}
	return views, nil
}

// Create 创建启用的模块。
func (s *Service) Create(name, content string) (*ModuleView, error) {
	name = strings.TrimSpace(name)
	if _, err := validateModule(name, content); err != nil {
		return nil, err
	}
	if _, err := s.repo.getByName(name); err == nil {
		return nil, fmt.Errorf("%w: 模块名 %s 已存在", ErrConflict, name)
	} else if !isNotFound(err) {
		return nil, fmt.Errorf("query blackbox module: %w", err)
	}
	item := &models.BlackboxModule{Name: name, Content: strings.TrimSpace(content) + "\n", Enabled: true}
	if err := s.repo.create(item); err != nil {
		return nil, fmt.Errorf("create blackbox module: %w", err)
	}
	return s.view(*item)
}

// Update 更新模块内容与启停状态，模块名不可修改。
func (s *Service) Update(id uint, content string, enabled bool) (*ModuleView, error) {
	item, err := s.repo.getByID(id)
	if err != nil {
		if isNotFound(err) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if _, err := validateModule(item.Name, content); err != nil {
		return nil, err
	}
	item.Content = strings.TrimSpace(content) + "\n"
	item.Enabled = enabled
	if err := s.repo.update(item); err != nil {
		return nil, fmt.Errorf("update blackbox module: %w", err)
	}
	return s.view(*item)
}

// Delete 软删除未被 Job 引用的模块。
func (s *Service) Delete(id uint) error {
	item, err := s.repo.getByID(id)
	if err != nil {
		if isNotFound(err) {
			return ErrNotFound
		}
		return err
	}
	references, err := s.repo.referencedJobs(item.Name)
	if err != nil {
		return err
	}
	if references > 0 {
		return fmt.Errorf("%w: %d 个采集 Job 仍引用模块 %s", ErrConflict, references, item.Name)
	}
	if err := s.repo.delete(id); err != nil {
		return fmt.Errorf("delete blackbox module: %w", err)
	}
	return nil
}

func (s *Service) view(item models.BlackboxModule) (*ModuleView, error) {
	prober, _ := validateModule(item.Name, item.Content)
	references, err := s.repo.referencedJobs(item.Name)
	if err != nil {
		return nil, err
	}
	return &ModuleView{BlackboxModule: item, Prober: prober, ReferencedJobs: references}, nil
}

func validateModule(name, content string) (string, error) {
	if !moduleNamePattern.MatchString(name) {
		return "", fmt.Errorf("%w: 模块名需以小写字母开头，且只含小写字母、数字、下划线", ErrValidation)
	}
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(content), &doc); err != nil {
		return "", fmt.Errorf("%w: YAML 格式错误: %v", ErrValidation, err)
	}
	if len(doc.Content) != 1 || doc.Content[0].Kind != yaml.MappingNode || len(doc.Content[0].Content) != 2 {
		return "", fmt.Errorf("%w: 内容必须且只能包含一个模块节点", ErrValidation)
	}
	root := doc.Content[0]
	if root.Content[0].Value != name || root.Content[1].Kind != yaml.MappingNode {
		return "", fmt.Errorf("%w: YAML 根键必须与模块名 %s 一致", ErrValidation, name)
	}
	prober, timeout := "", ""
	for i := 0; i+1 < len(root.Content[1].Content); i += 2 {
		key, value := root.Content[1].Content[i], root.Content[1].Content[i+1]
		switch key.Value {
		case "prober":
			prober = value.Value
		case "timeout":
			timeout = value.Value
		}
	}
	switch prober {
	case "http", "tcp", "icmp", "dns":
	default:
		return "", fmt.Errorf("%w: prober 仅支持 http、tcp、icmp、dns", ErrValidation)
	}
	if timeout != "" {
		if _, err := time.ParseDuration(timeout); err != nil {
			return "", fmt.Errorf("%w: timeout 格式非法", ErrValidation)
		}
	}
	return prober, nil
}

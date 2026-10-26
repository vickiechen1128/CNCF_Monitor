// Package panelmount implements Grafana dashboard mounting for Module 05.
package panelmount

import (
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
)

var (
	// ErrInvalidPanel indicates an invalid name or Grafana dashboard URL.
	ErrInvalidPanel = errors.New("面板配置不合法")
	// ErrNameConflict indicates that the display name is already mounted.
	ErrNameConflict = errors.New("面板名称已存在")
	// ErrPanelNotFound indicates that no panel exists for the requested ID.
	ErrPanelNotFound = errors.New("面板不存在")
)

// Service validates and coordinates dashboard panel persistence.
type Service struct {
	repo *Repository
}

// NewService constructs a dashboard panel service.
func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// Create validates and stores a dashboard panel.
func (s *Service) Create(name, rawURL string) (*models.DashboardPanel, error) {
	name = strings.TrimSpace(name)
	rawURL = strings.TrimSpace(rawURL)
	if name == "" || len([]rune(name)) > 100 {
		return nil, fmt.Errorf("%w：名称必填且不超过 100 个字符", ErrInvalidPanel)
	}
	if err := validateGrafanaURL(rawURL); err != nil {
		return nil, err
	}
	panel := &models.DashboardPanel{Name: name, URL: rawURL}
	if err := s.repo.Create(panel); err != nil {
		return nil, err
	}
	return panel, nil
}

// List returns mounted panels for the requested page.
func (s *Service) List(page, pageSize int) ([]models.DashboardPanel, int64, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return s.repo.List(page, pageSize)
}

// Get returns one mounted panel.
func (s *Service) Get(id uint) (*models.DashboardPanel, error) {
	return s.repo.Get(id)
}

func validateGrafanaURL(rawURL string) error {
	if rawURL == "" || len(rawURL) > 2048 {
		return fmt.Errorf("%w：Grafana URL 必填且不超过 2048 个字符", ErrInvalidPanel)
	}
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return fmt.Errorf("%w：仅支持有效的 http/https 地址", ErrInvalidPanel)
	}
	if !strings.HasPrefix(u.Path, "/d/") || len(u.Path) <= len("/d/") {
		return fmt.Errorf("%w：请输入 Grafana 仪表盘 /d/ 地址", ErrInvalidPanel)
	}
	return nil
}

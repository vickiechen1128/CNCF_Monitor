package service

import (
	"context"
	"errors"
	"net/url"
	"strings"

	"github.com/metriccenter/metriccenter/platform/foundation/apierror"
	"github.com/metriccenter/metriccenter/platform/modules/m05/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m05/repository"
)

// panelNameMaxRunes mirrors the v2 panel name limit (100 runes): the name is a
// menu label in the "自定义大屏" group, not free-form text.
const panelNameMaxRunes = 100

// panelURLMaxLen mirrors the v2 panel URL limit.
const panelURLMaxLen = 2048

// PanelPage is one page of mounted panels plus the normalized paging echo.
type PanelPage struct {
	Items    []domain.Panel
	Total    int64
	Page     int
	PageSize int
}

// PanelService implements the mounted-panel rules (M05 FR-08): authenticated
// users list/read, only admins create or edit, names are unique.
//
// URL validation keeps v2 parity (`platform/dashboard/panelmount`): panels are
// Grafana dashboards embedded in kiosk mode, so only http/https URLs pointing at
// a /d/<uid> dashboard are accepted. That also keeps user-supplied URLs from
// being rendered as arbitrary schemes (SSRF / XSS boundary).
type PanelService struct {
	repo repository.PanelRepository
}

// NewPanelService constructs the panel service.
func NewPanelService(repo repository.PanelRepository) *PanelService {
	return &PanelService{repo: repo}
}

// List returns one page ordered by updated_at DESC, id DESC. page defaults to 1,
// page_size to 20 and is capped at 100 (platform-wide paging contract).
func (s *PanelService) List(ctx context.Context, page, pageSize int) (PanelPage, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	items, total, err := s.repo.List(ctx, page, pageSize)
	if err != nil {
		return PanelPage{}, err
	}
	if items == nil {
		items = []domain.Panel{}
	}
	return PanelPage{Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}

// Get returns one mounted panel; an unknown ID is a 404.
func (s *PanelService) Get(ctx context.Context, id uint) (domain.Panel, error) {
	panel, found, err := s.repo.Get(ctx, id)
	if err != nil {
		return domain.Panel{}, err
	}
	if !found {
		return domain.Panel{}, errPanelNotFound()
	}
	return panel, nil
}

// Create validates and stores a new panel; a duplicate name is a 409.
func (s *PanelService) Create(ctx context.Context, input domain.CreatePanelInput) (domain.Panel, error) {
	name, rawURL, err := normalizePanelInput(input.Name, input.URL)
	if err != nil {
		return domain.Panel{}, err
	}
	exists, err := s.repo.ExistsByName(ctx, name, 0)
	if err != nil {
		return domain.Panel{}, err
	}
	if exists {
		return domain.Panel{}, errPanelNameConflict()
	}
	panel, err := s.repo.Create(ctx, domain.CreatePanelInput{Name: name, URL: rawURL})
	if err != nil {
		if errors.Is(err, domain.ErrNameTaken) {
			return domain.Panel{}, errPanelNameConflict()
		}
		return domain.Panel{}, err
	}
	return panel, nil
}

// Update rewrites name / url of an existing panel (id and created_at stay); an
// unknown ID is a 404 and a name used by another panel is a 409.
func (s *PanelService) Update(ctx context.Context, id uint, input domain.UpdatePanelInput) (domain.Panel, error) {
	name, rawURL, err := normalizePanelInput(input.Name, input.URL)
	if err != nil {
		return domain.Panel{}, err
	}
	// 404 wins over 409: editing a missing panel never reports a name clash.
	if _, found, err := s.repo.Get(ctx, id); err != nil {
		return domain.Panel{}, err
	} else if !found {
		return domain.Panel{}, errPanelNotFound()
	}
	exists, err := s.repo.ExistsByName(ctx, name, id)
	if err != nil {
		return domain.Panel{}, err
	}
	if exists {
		return domain.Panel{}, errPanelNameConflict()
	}
	panel, found, err := s.repo.Update(ctx, id, domain.UpdatePanelInput{Name: name, URL: rawURL})
	if err != nil {
		if errors.Is(err, domain.ErrNameTaken) {
			return domain.Panel{}, errPanelNameConflict()
		}
		return domain.Panel{}, err
	}
	if !found {
		return domain.Panel{}, errPanelNotFound()
	}
	return panel, nil
}

// normalizePanelInput trims and validates the create/update payload.
func normalizePanelInput(name, rawURL string) (string, string, error) {
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > panelNameMaxRunes {
		return "", "", apierror.New(apierror.BadRequest, "面板名称必填且不超过 100 个字符")
	}
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" || len(rawURL) > panelURLMaxLen {
		return "", "", apierror.New(apierror.BadRequest, "Grafana URL 必填且不超过 2048 个字符")
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", "", apierror.New(apierror.BadRequest, "仅支持有效的 http/https 地址")
	}
	if !strings.HasPrefix(parsed.Path, "/d/") || len(parsed.Path) <= len("/d/") {
		return "", "", apierror.New(apierror.BadRequest, "请输入 Grafana 仪表盘 /d/ 地址")
	}
	return name, rawURL, nil
}

func errPanelNotFound() error {
	return apierror.New(apierror.NotFound, "面板不存在")
}

func errPanelNameConflict() error {
	return apierror.New(apierror.Conflict, "面板名称已存在")
}

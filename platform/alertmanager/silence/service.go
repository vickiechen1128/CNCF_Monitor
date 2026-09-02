package silence

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
)

// Silence 是契约 §4 的静默视图（silence service 对外 JSON），字段 snake_case。
type Silence struct {
	ID        string                    `json:"id"`
	Matchers  []models.SilenceMatcher   `json:"matchers"`
	StartsAt  time.Time                 `json:"starts_at"`
	EndsAt    time.Time                 `json:"ends_at"`
	CreatedBy string                    `json:"created_by"`
	Comment   string                    `json:"comment"`
	Status    models.SilenceStatus      `json:"status"`
}

// Service 编排静默读写：列表映射、创建（含授权校验）、删除（not_found 语义）。
type Service struct {
	proxy *Proxy
}

// NewService 创建静默服务，绑定 Alertmanager 代理。
func NewService(proxy *Proxy) *Service {
	return &Service{proxy: proxy}
}

// CreateInput 是创建静默的入参（契约 §4 POST body：matchers/starts_at/ends_at/comment，
// created_by 可选）。
type CreateInput struct {
	Matchers  []models.SilenceMatcher `json:"matchers"`
	StartsAt  time.Time               `json:"starts_at"`
	EndsAt    time.Time               `json:"ends_at"`
	Comment   string                  `json:"comment"`
	CreatedBy string                  `json:"created_by"`
}

// Validate 校验创建入参（契约 §7：matchers 非空、starts_at/ends_at 必填且 ends_at > starts_at、
// comment 必填）。
func (in *CreateInput) Validate() error {
	if len(in.Matchers) == 0 {
		return fmt.Errorf("silence matchers are required")
	}
	if in.StartsAt.IsZero() || in.EndsAt.IsZero() {
		return fmt.Errorf("silence starts_at and ends_at are required")
	}
	if !in.EndsAt.After(in.StartsAt) {
		return fmt.Errorf("silence ends_at must be later than starts_at")
	}
	if in.Comment == "" {
		return fmt.Errorf("silence comment is required")
	}
	return nil
}

// List 拉取并映射 Alertmanager 全部静默，可选仅返回活跃（active）静默
// （契约 §4：服务端可追加 active 过滤）。空结果返回空切片。
func (s *Service) List(ctx context.Context, activeOnly bool) ([]Silence, error) {
	list, err := s.proxy.ListSilences(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Silence, 0, len(list))
	for _, am := range list {
		if activeOnly && am.Status.State != string(models.SilenceStatusActive) {
			continue
		}
		out = append(out, toSilence(am))
	}
	return out, nil
}

// Create 校验入参并做写路径 matcher 授权收敛（决策 56）后代理创建静默，即时生效。
func (s *Service) Create(ctx context.Context, scope *models.AuthorizedMatcherScope, in CreateInput) (*Silence, error) {
	if err := in.Validate(); err != nil {
		return nil, err
	}
	if err := AuthorizeMatchers(scope, in.Matchers); err != nil {
		return nil, err
	}
	body, err := buildCreateBody(in)
	if err != nil {
		return nil, err
	}
	id, err := s.proxy.CreateSilence(ctx, body)
	if err != nil {
		return nil, err
	}
	return &Silence{
		ID:        id,
		Matchers:  in.Matchers,
		StartsAt:  in.StartsAt,
		EndsAt:    in.EndsAt,
		CreatedBy: in.CreatedBy,
		Comment:   in.Comment,
		Status:    silenceStatusAt(in.StartsAt, in.EndsAt),
	}, nil
}

// Delete 删除静默（代理 AM）；目标不存在返回 ErrSilenceNotFound（契约 §4 not_found）。
func (s *Service) Delete(ctx context.Context, id string) (string, error) {
	if id == "" {
		return "", ErrSilenceNotFound
	}
	if err := s.proxy.DeleteSilence(ctx, id); err != nil {
		return "", err
	}
	return id, nil
}

// toSilence 将 Alertmanager 原生载体映射为契约视图。
func toSilence(am amSilence) Silence {
	matchers := make([]models.SilenceMatcher, 0, len(am.Matchers))
	for _, m := range am.Matchers {
		isEqual, isRegex := false, false
		if m.IsEqual != nil {
			isEqual = *m.IsEqual
		}
		if m.IsRegex != nil {
			isRegex = *m.IsRegex
		}
		matchers = append(matchers, models.SilenceMatcher{Name: m.Name, Value: m.Value, IsEqual: isEqual, IsRegex: isRegex})
	}
	return Silence{
		ID:        am.ID,
		Matchers:  matchers,
		StartsAt:  am.StartsAt,
		EndsAt:    am.EndsAt,
		CreatedBy: am.CreatedBy,
		Comment:   am.Comment,
		Status:    silenceStatusAt(am.StartsAt, am.EndsAt),
	}
}

// silenceStatusAt 依据起止时间推导运行时状态（对齐 AM status.state 语义，
// 兜底计算保证 map 结果稳健）。
func silenceStatusAt(starts, ends time.Time) models.SilenceStatus {
	now := time.Now()
	switch {
	case ends.Before(now):
		return models.SilenceStatusExpired
	case starts.After(now):
		return models.SilenceStatusPending
	default:
		return models.SilenceStatusActive
	}
}

// buildCreateBody 构造 Alertmanager POST /api/v1/silences 原始 JSON（matcher camelCase）。
func buildCreateBody(in CreateInput) ([]byte, error) {
	matchers := make([]amMatcher, 0, len(in.Matchers))
	for _, m := range in.Matchers {
		isEqual, isRegex := m.IsEqual, m.IsRegex
		matchers = append(matchers, amMatcher{Name: m.Name, Value: m.Value, IsEqual: &isEqual, IsRegex: &isRegex})
	}
	mr, err := json.Marshal(matchers)
	if err != nil {
		return nil, err
	}
	req := amCreateSilenceRequest{
		Matchers:  json.RawMessage(mr),
		StartsAt:  in.StartsAt,
		EndsAt:    in.EndsAt,
		CreatedBy: in.CreatedBy,
		Comment:   in.Comment,
	}
	return json.Marshal(req)
}
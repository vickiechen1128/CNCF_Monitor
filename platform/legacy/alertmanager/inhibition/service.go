// Package inhibition implements Module 08 alert inhibition rule management.
package inhibition

import (
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/metriccenter/metriccenter/platform/alertmanager/route"
	"github.com/metriccenter/metriccenter/platform/configcenter/generator"
)

// ErrInvalidRule indicates invalid inhibition rule input.
var ErrInvalidRule = errors.New("抑制规则校验未通过")

// View is the read model for the inhibition editor.
type View struct {
	Items             []generator.InhibitionRule `json:"items"`
	EffectiveChecksum string                     `json:"effective_checksum"`
	Pending           any                        `json:"pending"`
}

// Service validates and coordinates inhibition persistence.
type Service struct {
	repo *Repository
}

// NewService constructs an inhibition service.
func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// List returns the current inhibition rules.
func (s *Service) List() (*View, error) {
	return s.repo.List()
}

// Save validates and saves inhibition rules while preserving the current routes.
func (s *Service) Save(baseChecksum string, rules []generator.InhibitionRule, uploadedBy string) (*route.SaveRoutesResult, error) {
	for i := range rules {
		rules[i].ID = fmt.Sprintf("inhibit-%d", i+1)
		rules[i].Name = strings.TrimSpace(rules[i].Name)
		if err := validateRule(rules[i]); err != nil {
			return nil, fmt.Errorf("%w：第 %d 条，%v", ErrInvalidRule, i+1, err)
		}
	}
	return s.repo.Save(baseChecksum, rules, uploadedBy)
}

func validateRule(rule generator.InhibitionRule) error {
	if len(rule.SourceMatchers) == 0 || len(rule.TargetMatchers) == 0 {
		return errors.New("源告警和目标告警匹配条件均不能为空")
	}
	for _, matchers := range [][]generator.RouteEditMatcher{rule.SourceMatchers, rule.TargetMatchers} {
		for _, m := range matchers {
			if strings.TrimSpace(m.Name) == "" || strings.TrimSpace(m.Value) == "" {
				return errors.New("匹配条件的标签名和标签值不能为空")
			}
			if m.IsRegex {
				if _, err := regexp.Compile(m.Value); err != nil {
					return fmt.Errorf("正则表达式 %q 不合法", m.Value)
				}
			}
		}
	}
	seen := map[string]bool{}
	for _, label := range rule.Equal {
		label = strings.TrimSpace(label)
		if label == "" || seen[label] {
			return errors.New("等同标签不能为空或重复")
		}
		seen[label] = true
	}
	return nil
}

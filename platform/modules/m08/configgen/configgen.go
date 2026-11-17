// Package configgen renders alertmanager.yml from the platform-owned route
// tree, inhibition rules and referenced channels. It is pure: no database, no
// filesystem, no HTTP, so the generated artifact is deterministic and testable
// with golden files.
//
// Invariants:
//   - the route section has exactly one author: the platform tree (NFR-01);
//   - receivers materialise `default` plus only the channels referenced by
//     enabled route nodes, named `notify-<channel-id>` (FR-11);
//   - every receiver also posts to the built-in alert-event webhook (FR-21);
//   - templates never appear in the YAML (FR-10).
package configgen

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
)

// DefaultReceiver is the always-present empty receiver.
const DefaultReceiver = "default"

// Input carries everything needed to render one configuration.
type Input struct {
	RouteTree []domain.RouteNode
	// InhibitRules are the enabled rules from the m08_inhibition_rules table.
	InhibitRules []*domain.InhibitionRule
	// Channels are the live channels; only referenced ones become receivers.
	Channels []*domain.Channel
	// BridgeBaseURL is the absolute base of the platform webhook bridge, e.g.
	// http://127.0.0.1:8080. It must not end with a slash.
	BridgeBaseURL string
	// ResolveTimeout is the global resolve timeout (default 5m).
	ResolveTimeout string
}

// Output is the generated artifact.
type Output struct {
	Content  string
	Checksum string
}

// Generate renders the configuration and its sha256 checksum.
func Generate(input Input) (*Output, error) {
	if len(input.RouteTree) != 1 {
		return nil, fmt.Errorf("configgen: exactly one root route is required, got %d", len(input.RouteTree))
	}
	base := strings.TrimRight(strings.TrimSpace(input.BridgeBaseURL), "/")
	if base == "" {
		return nil, fmt.Errorf("configgen: bridge base URL is required")
	}
	referenced := domain.CollectReceivers(input.RouteTree)
	channels := make(map[string]*domain.Channel, len(input.Channels))
	for _, channel := range input.Channels {
		channels[channel.ReceiverName()] = channel
	}
	for name := range referenced {
		if name == DefaultReceiver {
			continue
		}
		if _, ok := channels[name]; !ok {
			return nil, fmt.Errorf("configgen: route references unknown receiver %q", name)
		}
	}

	cfg := alertmanagerConfig{
		Global: globalConfig{ResolveTimeout: orDefault(input.ResolveTimeout, "5m")},
		Route:  toRoute(input.RouteTree[0]),
	}
	cfg.Receivers = buildReceivers(base, referenced, channels)
	cfg.InhibitRules = buildInhibitRules(input.InhibitRules)

	raw, err := yaml.Marshal(cfg)
	if err != nil {
		return nil, fmt.Errorf("configgen: marshal: %w", err)
	}
	sum := sha256.Sum256(raw)
	return &Output{Content: string(raw), Checksum: hex.EncodeToString(sum[:])}, nil
}

// NewVersion returns a snapshot version like 20261116-0a1b (UTC date + random
// suffix supplied by the caller).
func NewVersion(now time.Time, suffix string) string {
	return now.UTC().Format("20060102") + "-" + suffix
}

type globalConfig struct {
	ResolveTimeout string `yaml:"resolve_timeout"`
}

type alertmanagerConfig struct {
	Global       globalConfig    `yaml:"global"`
	Route        *routeConfig    `yaml:"route"`
	InhibitRules []inhibitRule   `yaml:"inhibit_rules,omitempty"`
	Receivers    []receiverConfig `yaml:"receivers"`
}

type routeConfig struct {
	Receiver       string        `yaml:"receiver"`
	GroupBy        []string      `yaml:"group_by,omitempty"`
	GroupWait      string        `yaml:"group_wait,omitempty"`
	GroupInterval  string        `yaml:"group_interval,omitempty"`
	RepeatInterval string        `yaml:"repeat_interval,omitempty"`
	Matchers       []string      `yaml:"matchers,omitempty"`
	Continue       bool          `yaml:"continue,omitempty"`
	Routes         []routeConfig `yaml:"routes,omitempty"`
}

type inhibitRule struct {
	SourceMatchers []string `yaml:"source_matchers"`
	TargetMatchers []string `yaml:"target_matchers"`
	Equal          []string `yaml:"equal,omitempty"`
}

type receiverConfig struct {
	Name           string          `yaml:"name"`
	WebhookConfigs []webhookConfig `yaml:"webhook_configs"`
}

type webhookConfig struct {
	URL          string `yaml:"url"`
	SendResolved bool   `yaml:"send_resolved"`
	MaxAlerts    int    `yaml:"max_alerts,omitempty"`
}

func toRoute(node domain.RouteNode) *routeConfig {
	route := &routeConfig{
		Receiver:       node.Receiver,
		GroupBy:        groupBy(node.GroupBy),
		GroupWait:      node.GroupWait,
		GroupInterval:  node.GroupInterval,
		RepeatInterval: node.RepeatInterval,
		Matchers:       renderMatchers(node.Matchers),
		Continue:       node.Continue,
	}
	for _, child := range node.Children {
		if !child.Enabled {
			continue
		}
		route.Routes = append(route.Routes, *toRoute(child))
	}
	return route
}

func groupBy(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

// renderMatchers emits Alertmanager matcher strings: name="value" for exact
// matches and name=~"value" for regex matches.
func renderMatchers(matchers []domain.Matcher) []string {
	out := make([]string, 0, len(matchers))
	for _, matcher := range matchers {
		op := "="
		switch {
		case matcher.IsRegex && matcher.IsEqualMatch():
			op = "=~"
		case matcher.IsRegex && !matcher.IsEqualMatch():
			op = "!~"
		case !matcher.IsRegex && !matcher.IsEqualMatch():
			op = "!="
		}
		out = append(out, fmt.Sprintf("%s%s%s", matcher.Name, op, strconv.Quote(matcher.Value)))
	}
	return out
}

func buildInhibitRules(rules []*domain.InhibitionRule) []inhibitRule {
	out := make([]inhibitRule, 0, len(rules))
	for _, rule := range rules {
		if !rule.Enabled || len(rule.SourceMatchers) == 0 || len(rule.TargetMatchers) == 0 {
			continue
		}
		out = append(out, inhibitRule{
			SourceMatchers: renderMatchers(rule.SourceMatchers),
			TargetMatchers: renderMatchers(rule.TargetMatchers),
			Equal:          rule.Equal,
		})
	}
	return out
}

func buildReceivers(base string, referenced map[string]bool, channels map[string]*domain.Channel) []receiverConfig {
	eventsURL := base + "/api/v3/platform/webhooks/alerts"
	out := []receiverConfig{{
		Name:           DefaultReceiver,
		WebhookConfigs: []webhookConfig{{URL: eventsURL, SendResolved: true}},
	}}
	names := make([]string, 0, len(referenced))
	for name := range referenced {
		if name != DefaultReceiver {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	for _, name := range names {
		channel := channels[name]
		out = append(out, receiverConfig{
			Name: name,
			WebhookConfigs: []webhookConfig{
				{URL: eventsURL, SendResolved: true},
				{
					URL:          base + "/api/v3/platform/webhooks/notify?id=" + channel.ID,
					SendResolved: true,
				},
			},
		})
	}
	return out
}

func orDefault(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

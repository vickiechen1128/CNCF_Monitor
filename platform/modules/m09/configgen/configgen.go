// Package configgen is the M09 v3 pure config generator. It renders the
// per-domain artifacts (prometheus.yml / targets / rules / blackbox / metadata)
// from a source view with no database side effects, reusing the shared rendering
// and checksum logic in platform/configcenter/generator.
//
// B5-1 scope: pure functions only. Draft / change / deployment orchestration is
// intentionally not reused (D25 removed confirmation and rollback).
package configgen

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/configcenter/generator"
	"github.com/metriccenter/metriccenter/platform/models"
)

const (
	// DefaultInterval is the scrape interval (matches models.DefaultScrapeInterval).
	DefaultInterval = models.DefaultScrapeInterval
	// DefaultTimeout is the scrape timeout (matches models.DefaultScrapeTimeout).
	DefaultTimeout = models.DefaultScrapeTimeout
	// DefaultMetricsPath is the default metrics endpoint.
	DefaultMetricsPath = models.DefaultMetricsPath
	// DefaultScheme is the default scrape scheme.
	DefaultScheme = models.DefaultScheme
	// ModelAgentType is written into metadata.json for edge config packages.
	ModelAgentType = "vmagent"
)

// Target is one scrape target with optional labels.
type Target struct {
	Instance string            `json:"instance"`
	Labels   map[string]string `json:"labels,omitempty"`
}

// Job is one scrape job in the source view.
type Job struct {
	Name           string
	MetricsPath    string
	Scheme         string
	Interval       string
	Timeout        string
	BlackboxModule string
	Targets        []Target
}

// Source is the pure input to the generator.
type Source struct {
	NetworkDomainID string
	ZoneType        string
	Replica         string
	Jobs            []Job
}

// Artifacts is the rendered result. Checksum covers every artifact except
// Metadata (matching generator.ConfigArtifacts.Checksum).
type Artifacts struct {
	Version       string
	Checksum      string
	PrometheusYML string
	RulesYML      string
	BlackboxYML   string
	TargetsFiles  map[string]string
	Metadata      string
}

// Metadata is the metadata.json payload inside the package.
type Metadata struct {
	ConfigVersion string `json:"config_version"`
	GeneratedAt   string `json:"generated_at"`
	AgentType     string `json:"agent_type"`
	Checksum      string `json:"checksum"`
}

// Generate renders the artifacts deterministically. Edge domains carry empty
// rules and no alerting section (D25 / contract §2); alertmanager.yml is owned
// by M08 and never generated here.
func Generate(src Source, version string, generatedAt time.Time) (*Artifacts, error) {
	if strings.TrimSpace(src.NetworkDomainID) == "" {
		return nil, fmt.Errorf("configgen: network domain id is required")
	}
	if strings.TrimSpace(version) == "" {
		return nil, fmt.Errorf("configgen: version is required")
	}

	builds := make([]generator.JobBuild, 0, len(src.Jobs))
	for _, job := range src.Jobs {
		if len(job.Targets) == 0 {
			continue
		}
		builds = append(builds, generator.JobBuild{
			Job:     toScrapeJob(src.NetworkDomainID, job),
			Targets: groupTargets(job.Targets),
		})
	}
	sort.SliceStable(builds, func(i, j int) bool { return builds[i].Job.JobName < builds[j].Job.JobName })

	rendered, err := generator.AssembleWithModules(
		src.NetworkDomainID, src.ZoneType, src.Replica,
		builds, nil, "", "", false, nil,
	)
	if err != nil {
		return nil, fmt.Errorf("configgen: assemble domain %q: %w", src.NetworkDomainID, err)
	}

	checksum := rendered.Checksum()
	meta := Metadata{
		ConfigVersion: version,
		GeneratedAt:   generatedAt.UTC().Format(time.RFC3339),
		AgentType:     ModelAgentType,
		Checksum:      checksum,
	}
	metaRaw, err := json.Marshal(meta)
	if err != nil {
		return nil, fmt.Errorf("configgen: marshal metadata: %w", err)
	}

	return &Artifacts{
		Version:       version,
		Checksum:      checksum,
		PrometheusYML: rendered.PrometheusYML,
		RulesYML:      rendered.RulesYML,
		BlackboxYML:   rendered.BlackboxYML,
		TargetsFiles:  rendered.TargetsFiles,
		Metadata:      string(metaRaw),
	}, nil
}

func toScrapeJob(domainID string, job Job) models.ScrapeJob {
	jobType := models.JobTypeStandard
	if strings.TrimSpace(job.BlackboxModule) != "" {
		jobType = models.JobTypeBlackbox
	}
	return models.ScrapeJob{
		JobName:         job.Name,
		JobType:         jobType,
		NetworkDomainID: domainID,
		ScrapeInterval:  defaultIfEmpty(job.Interval, DefaultInterval),
		ScrapeTimeout:   defaultIfEmpty(job.Timeout, DefaultTimeout),
		MetricsPath:     defaultIfEmpty(job.MetricsPath, DefaultMetricsPath),
		Scheme:          defaultIfEmpty(job.Scheme, DefaultScheme),
		BlackboxModule:  job.BlackboxModule,
		Enabled:         true,
	}
}

// groupTargets groups targets sharing identical labels into file_sd groups.
func groupTargets(targets []Target) []generator.TargetGroup {
	grouped := map[string]*generator.TargetGroup{}
	keys := make([]string, 0)
	for _, target := range targets {
		instance := strings.TrimSpace(target.Instance)
		if instance == "" {
			continue
		}
		key, labels := labelKey(target.Labels)
		group, ok := grouped[key]
		if !ok {
			group = &generator.TargetGroup{Labels: labels}
			grouped[key] = group
			keys = append(keys, key)
		}
		group.Targets = append(group.Targets, instance)
	}
	sort.Strings(keys)
	groups := make([]generator.TargetGroup, 0, len(keys))
	for _, key := range keys {
		group := grouped[key]
		sort.Strings(group.Targets)
		groups = append(groups, *group)
	}
	return groups
}

func labelKey(labels map[string]string) (string, map[string]string) {
	if len(labels) == 0 {
		return "", map[string]string{}
	}
	keys := make([]string, 0, len(labels))
	for k := range labels {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	normalized := make(map[string]string, len(labels))
	for _, k := range keys {
		b.WriteString(k)
		b.WriteString("=")
		b.WriteString(labels[k])
		b.WriteString(";")
		normalized[k] = labels[k]
	}
	return b.String(), normalized
}

func defaultIfEmpty(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

// ValidationResult is the normalized outcome persisted on a snapshot. Status is
// always passed/failed (pending is folded into failed + platform_fault so it
// matches the domain_config_snapshots CHECK constraint).
type ValidationResult struct {
	Status  string
	Cause   string
	Message string
	Details string // JSON array
}

// Validate runs the shared promtool / blackbox / targets checks. An unavailable
// external tool is a platform fault (matching generator's attribution rules).
func Validate(artifacts *Artifacts) ValidationResult {
	ca := &generator.ConfigArtifacts{
		PrometheusYML: artifacts.PrometheusYML,
		RulesYML:      artifacts.RulesYML,
		BlackboxYML:   artifacts.BlackboxYML,
		TargetsFiles:  artifacts.TargetsFiles,
	}
	status, cause, details, message := generator.ValidateArtifacts(ca, false, nil)

	normalizedStatus := "failed"
	if status == models.ValidationStatusPassed {
		normalizedStatus = "passed"
	}
	normalizedCause := "none"
	if normalizedStatus != "passed" {
		switch cause {
		case models.ValidationCauseUserConfig:
			normalizedCause = "user_config"
		default:
			normalizedCause = "platform_fault"
		}
	}
	rawDetails, err := json.Marshal(details)
	if err != nil {
		rawDetails = []byte("[]")
	}
	return ValidationResult{
		Status:  normalizedStatus,
		Cause:   normalizedCause,
		Message: message,
		Details: string(rawDetails),
	}
}

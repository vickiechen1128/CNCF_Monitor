package generator

import (
	"fmt"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
	"gopkg.in/yaml.v3"
)

// ---- YAML 结构（Prometheus 配置产物） ----

type cfgGlobal struct {
	ScrapeInterval  string            `yaml:"scrape_interval,omitempty"`
	ExternalLabels  map[string]string `yaml:"external_labels,omitempty"`
}

type cfgFile struct {
	Global        cfgGlobal    `yaml:"global,omitempty"`
	ScrapeConfigs []scrapeConf `yaml:"scrape_configs,omitempty"`
}

type scrapeConf struct {
	JobName        string              `yaml:"job_name"`
	MetricsPath    string              `yaml:"metrics_path,omitempty"`
	Params         map[string][]string `yaml:"params,omitempty"`
	Scheme         string              `yaml:"scheme,omitempty"`
	BasicAuth      *basicAuthConf      `yaml:"basic_auth,omitempty"`
	Authorization  *authorizationConf  `yaml:"authorization,omitempty"`
	TLSConfig      *tlsConf            `yaml:"tls_config,omitempty"`
	FileSDConfigs  []fileSDConf        `yaml:"file_sd_configs,omitempty"`
	RelabelConfigs []relabelConf       `yaml:"relabel_configs,omitempty"`
}

type basicAuthConf struct {
	Username string `yaml:"username"`
	Password string `yaml:"password,omitempty"`
}

type authorizationConf struct {
	Type        string `yaml:"type,omitempty"`
	Credentials string `yaml:"credentials,omitempty"`
}

type tlsConf struct {
	InsecureSkipVerify bool   `yaml:"insecure_skip_verify,omitempty"`
	CAFile             string `yaml:"ca_file,omitempty"`
}

type fileSDConf struct {
	Files []string `yaml:"files"`
}

type relabelConf struct {
	SourceLabels []string `yaml:"source_labels,omitempty"`
	TargetLabel  string   `yaml:"target_label,omitempty"`
	Replacement  string   `yaml:"replacement,omitempty"`
}

// JobBuild 是一次生成中某个 Job 的配置输入（Job 结构 + 已解析目标组）。
type JobBuild struct {
	Job     models.ScrapeJob
	Targets []TargetGroup
}

// Assemble 按网域组装配置产物：
//   - prometheus.yml：global.external_labels（仅 network_domain_id/zone_type/replica）
//     + scrape_configs 骨架（file_sd_configs 引用 targets/<job>.json 不内联）；
//   - targets/<job>.json：由调用方预解析的 Targets 生成；
//   - rules.yml：scope=central 且 content_mode=yaml_passthrough 的规则原样并入；
//   - blackbox.yml：存在 blackbox job 时按所用模块生成。
func Assemble(domainID, zoneType, replica string, jobs []JobBuild, rules []models.MonitoringRule) (*ConfigArtifacts, error) {
	ext := buildExternalLabels(domainID, zoneType, replica)

	cfg := &cfgFile{Global: cfgGlobal{ExternalLabels: ext}}
	targets := map[string]string{}
	modules := map[string]struct{}{}

	for _, jb := range jobs {
		sc, err := jobScrapeConfig(jb.Job)
		if err != nil {
			return nil, fmt.Errorf("render scrape config for %s: %w", jb.Job.JobName, err)
		}
		fname := normalizeJobFilename(jb.Job.JobName)
		sc.FileSDConfigs = []fileSDConf{{Files: []string{"targets/" + fname}}}
		if jb.Job.JobType == models.JobTypeBlackbox && jb.Job.BlackboxModule != "" {
			modules[jb.Job.BlackboxModule] = struct{}{}
		}
		cfg.ScrapeConfigs = append(cfg.ScrapeConfigs, sc)

		content, err := MarshalTargetGroups(jb.Targets)
		if err != nil {
			return nil, err
		}
		targets[fname] = content
	}

	promYAML, err := yaml.Marshal(cfg)
	if err != nil {
		return nil, fmt.Errorf("marshal prometheus.yml: %w", err)
	}

	rulesYAML := renderRules(rules)
	blackboxYAML := renderBlackbox(modules)

	return &ConfigArtifacts{
		PrometheusYML: string(promYAML),
		RulesYML:      rulesYAML,
		BlackboxYML:   blackboxYAML,
		TargetsFiles:  targets,
	}, nil
}

// jobScrapeConfig 将 ScrapeJob 结构映射为 scrape_config 骨架
// （metrics_path/scheme/认证/TLS 最小集透传，决策 31）。
func jobScrapeConfig(job models.ScrapeJob) (scrapeConf, error) {
	sc := scrapeConf{JobName: job.JobName}
	if job.MetricsPath != "" {
		sc.MetricsPath = job.MetricsPath
	}
	if job.Scheme != "" {
		sc.Scheme = job.Scheme
	}

	if job.AuthType == models.AuthTypeBasic {
		sc.BasicAuth = &basicAuthConf{Username: job.Username, Password: job.Password}
	}
	if job.AuthType == models.AuthTypeBearer {
		sc.Authorization = &authorizationConf{Type: "Bearer", Credentials: job.Token}
	}
	if job.TLSSkipVerify || job.CAFile != "" {
		sc.TLSConfig = &tlsConf{InsecureSkipVerify: job.TLSSkipVerify, CAFile: job.CAFile}
	}

	if job.JobType == models.JobTypeBlackbox {
		sc.MetricsPath = "/probe"
		sc.Params = map[string][]string{"module": {job.BlackboxModule}}
		sc.RelabelConfigs = []relabelConf{
			{SourceLabels: []string{"__address__"}, TargetLabel: "__param_target"},
			{SourceLabels: []string{"__param_target"}, TargetLabel: "instance"},
			{TargetLabel: "__address__", Replacement: "127.0.0.1:9115"},
		}
	}
	return sc, nil
}

// renderRules 将 yaml_passthrough 规则原样并入 rules.yml（不解析不重排）。
func renderRules(rules []models.MonitoringRule) string {
	var b strings.Builder
	for _, r := range rules {
		if r.ContentMode != models.RuleContentModeYAMLPassthrough {
			continue
		}
		if strings.TrimSpace(r.RuleContent) == "" {
			continue
		}
		if b.Len() > 0 {
			b.WriteString("\n")
		}
		b.WriteString(strings.TrimRight(r.RuleContent, "\n"))
	}
	return b.String()
}

// renderBlackbox 按用到的模块名生成最小 blackbox.yml（仅写实际引用模块，
// 避免下发无关配置，PRD §3.3.2）。
func renderBlackbox(modules map[string]struct{}) string {
	if len(modules) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("modules:\n")
	for mod := range modules {
		b.WriteString(renderBlackboxModule(mod))
	}
	return b.String()
}

// renderBlackboxModule 生成单个探测模块定义（按模块名前缀推导 prober）。
func renderBlackboxModule(module string) string {
	prober := "http"
	switch {
	case strings.HasPrefix(module, "icmp"):
		prober = "icmp"
	case strings.HasPrefix(module, "dns"):
		prober = "dns"
	case strings.HasPrefix(module, "tcp"):
		prober = "tcp"
	}
	return fmt.Sprintf("  %s:\n    prober: %s\n    timeout: 5s\n", module, prober)
}
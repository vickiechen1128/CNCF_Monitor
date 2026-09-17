package generator

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
	"gopkg.in/yaml.v3"
)

// ---- YAML 结构（Prometheus 配置产物） ----

type cfgGlobal struct {
	ScrapeInterval  string            `yaml:"scrape_interval,omitempty"`
	ExternalLabels  map[string]string `yaml:"external_labels,omitempty"`
}

// cfgAlerting 是 prometheus.yml 的 alerting 段（决策 68-2）：把中心求值器产生的告警
// 投递到 Alertmanager。仅中心求值器（channel=local）且存在 alertmanager.yml 挂载内容、
// 且 AM 地址已注入时生成；边缘通道（agent_pull）的 vmagent / prometheus-agent 不支持
// 该段，永不生成（tech-feasibility §4.2）。
type cfgAlerting struct {
	Alertmanagers []cfgAlertmanager `yaml:"alertmanagers"`
}

type cfgAlertmanager struct {
	StaticConfigs []cfgStaticConfig `yaml:"static_configs"`
}

type cfgStaticConfig struct {
	Targets []string `yaml:"targets"`
}

type cfgFile struct {
	Global        cfgGlobal    `yaml:"global,omitempty"`
	Alerting      *cfgAlerting `yaml:"alerting,omitempty"`
	RuleFiles     []string     `yaml:"rule_files,omitempty"`
	ScrapeConfigs []scrapeConf `yaml:"scrape_configs,omitempty"`
}

type scrapeConf struct {
	JobName        string              `yaml:"job_name"`
	ScrapeInterval string              `yaml:"scrape_interval,omitempty"`
	ScrapeTimeout  string              `yaml:"scrape_timeout,omitempty"`
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
//     中心求值器额外注入 rule_files 与 alerting（见 alertmanagerAddr / centerEvaluator）；
//   - targets/<job>.json：由调用方预解析的 Targets 生成；
//   - rules.yml：scope=central 且 content_mode=yaml_passthrough 的规则解析合并 groups
//     为单文档（renderRules）；
//   - blackbox.yml：存在 blackbox job 时按所用模块生成；
//   - alertmanager.yml：决策 60，由调用方按「管理域 default 范围」透传 M08 已留痕
//     源配置内容（无告警配置时传空串，不产生空产物）。
//
// 决策 68-2：alertmanagerAddr 是 alerting.alertmanagers[].static_configs[].targets 的
// 投递目标（host:port，由 --alertmanager.url 解析注入，禁止硬编码）；centerEvaluator
// 表示该产物是否属中心求值器（channel=local）。**rule_files 与 alerting 必须由同一个
// centerEvaluator 判定驱动**（约定纪律：禁止各自 if，否则 v0.2 会出现「一段生成了、
// 另一段没生成」的半残配置）。alerting 另有前置条件：alertmanagerYML 非空且地址非空，
// 避免指向不存在的 Alertmanager。
func Assemble(domainID, zoneType, replica string, jobs []JobBuild, rules []models.MonitoringRule, alertmanagerYML, alertmanagerAddr string, centerEvaluator bool) (*ConfigArtifacts, error) {
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

	// 规则文件与 prometheus.yml 同目录下发（deployment/service.go writeStructural），
	// 有规则内容时才注入 rule_files 引用 rules.yml；无规则时不引用，避免指向不存在的文件。
	//
	// 决策 68-2 / 68-3：rule_files 与 alerting 只进中心求值器（channel=local）的
	// prometheus.yml，边缘通道（agent_pull）永不生成——两者由同一个 centerEvaluator
	// 判定驱动，禁止各自 if（约定纪律，否则 v0.2 会出现「一段生成了、另一段没生成」
	// 的半残配置）。
	rulesYAML := renderRules(rules)
	if centerEvaluator {
		if strings.TrimSpace(rulesYAML) != "" {
			cfg.RuleFiles = []string{"rules.yml"}
		}
		// 与 rule_files 对称：仅有 AM 挂载内容且地址已注入时才生成 alerting 段，
		// 避免指向不存在的 Alertmanager（决策 68-2）。
		if strings.TrimSpace(alertmanagerYML) != "" && strings.TrimSpace(alertmanagerAddr) != "" {
			cfg.Alerting = &cfgAlerting{
				Alertmanagers: []cfgAlertmanager{{
					StaticConfigs: []cfgStaticConfig{{Targets: []string{alertmanagerAddr}}},
				}},
			}
		}
	}
	promYAML, err := yaml.Marshal(cfg)
	if err != nil {
		return nil, fmt.Errorf("marshal prometheus.yml: %w", err)
	}

	blackboxYAML := renderBlackbox(modules)

	return &ConfigArtifacts{
		PrometheusYML:   string(promYAML),
		RulesYML:        rulesYAML,
		BlackboxYML:     blackboxYAML,
		TargetsFiles:    targets,
		AlertmanagerYML: alertmanagerYML,
	}, nil
}

// AlertmanagerTargetFromURL 把 --alertmanager.url（如 http://localhost:9093）转换为
// Prometheus `alerting.alertmanagers[].static_configs[].targets` 所需的 host:port
// （如 localhost:9093，决策 68-2）。
//
// Prometheus 的 alertmanager target 只接受 host:port，不接受 scheme；故此处剥离
// scheme 与路径。未带 scheme 时按原值返回（容忍已是 host:port 的入参）；空串或解析
// 失败返回空串，调用方据此不生成 alerting 段，避免写出非法/悬空目标。
func AlertmanagerTargetFromURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if !strings.Contains(raw, "://") {
		return strings.Trim(raw, "/")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	return u.Host
}

// jobScrapeConfig 将 ScrapeJob 结构映射为 scrape_config 骨架
// （scrape_interval/scrape_timeout/metrics_path/scheme/认证/TLS 最小集透传，决策 31）。
// F-28：Job 参数字段自 F-28 起可稀疏留空（留空=继承），保存时已被
// resolveJobScrapeParams 解析为生效快照；此处对空值再按全局兜底常量回填，
// 作为存量/异常数据的防线，保证写出的 scrape_config 参数完整且显式。
func jobScrapeConfig(job models.ScrapeJob) (scrapeConf, error) {
	sc := scrapeConf{
		JobName:       job.JobName,
		ScrapeInterval: orDefault(job.ScrapeInterval, models.DefaultScrapeInterval),
		ScrapeTimeout:  orDefault(job.ScrapeTimeout, models.DefaultScrapeTimeout),
		MetricsPath:    orDefault(job.MetricsPath, models.DefaultMetricsPath),
		Scheme:         orDefault(job.Scheme, models.DefaultScheme),
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

// orDefault 返回 v，v 为空时返回兜底值 d（F-28 层叠默认链末端的全局兜底）。
func orDefault(v, d string) string {
	if strings.TrimSpace(v) == "" {
		return d
	}
	return v
}

// ruleGroupsFile 是 rules.yml 的顶层结构（仅 groups 键，节点级保留各 group 内容）。
type ruleGroupsFile struct {
	Groups []yaml.Node `yaml:"groups"`
}

// renderRules 将 yaml_passthrough 规则解析合并为单文档 rules.yml：
// 逐条解析各规则内容的 groups 节点，按顺序追加到同一个顶层 groups 下，
// 避免多记录各带顶层 groups 键拼接出非法 YAML（重复顶层键）。
// 组名全局唯一由保存时校验保证（strategy/rule.validateGroupNamesAvailable），
// 渲染期不做重名合并；解析失败的存量脏数据跳过，避免中断整体生成。
func renderRules(rules []models.MonitoringRule) string {
	var groups []yaml.Node
	for _, r := range rules {
		if r.ContentMode != models.RuleContentModeYAMLPassthrough {
			continue
		}
		if strings.TrimSpace(r.RuleContent) == "" {
			continue
		}
		var f ruleGroupsFile
		if err := yaml.Unmarshal([]byte(r.RuleContent), &f); err != nil {
			continue
		}
		groups = append(groups, f.Groups...)
	}
	if len(groups) == 0 {
		return ""
	}
	out, err := yaml.Marshal(ruleGroupsFile{Groups: groups})
	if err != nil {
		return ""
	}
	return string(out)
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
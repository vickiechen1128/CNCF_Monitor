package generator

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/strategy/rule/jobref"
)

// ToolCheckStatus 是外部校验工具（promtool / blackbox_exporter / amtool）执行结果三态。
// ValidateArtifacts 据此映射校验结果：
//   - ToolCheckPassed     —— 工具已执行且判定配置合法，继续后续门禁；
//   - ToolCheckUserConfig —— 工具已执行并判定配置非法（failed + user_config，可回 M01 修复）；
//   - ToolCheckUnavailable —— 工具**存在但无法执行**（pending + platform_fault，环境未就绪）。
//
// 第 3 态为 M09 dev-feedback F-35 建议 a 引入：此前「工具存在但不可执行」（如把 Linux ELF
// 放到 macOS 上的 `exec format error`）被归成 failed + user_config，会把环境问题误报成用户
// 配置错误、并误导用户回 M01 改一份本就正确的配置。现与「工具缺失」同口径归 pending +
// platform_fault，待运维环境就绪后重校即可。
type ToolCheckStatus int

const (
	// ToolCheckPassed 全部外部校验通过。
	ToolCheckPassed ToolCheckStatus = iota
	// ToolCheckUserConfig 工具已成功启动，并以配置非法为由返回非零退出码。
	ToolCheckUserConfig
	// ToolCheckUnavailable 工具存在但无法执行（平台/架构不匹配、无执行权限等）。
	ToolCheckUnavailable
)

// ToolLookPath / ToolChecker 可注入，便于测试（含跨包测试，如 configcenter/draft）
// 模拟外部校验工具（promtool / blackbox_exporter / amtool）的可用性与执行结果。
// 测试替换后须用 t.Cleanup 恢复；包级变量非并发安全，勿与 t.Parallel 混用。
var (
	ToolLookPath = exec.LookPath
	ToolChecker  = runToolChecks
	// errToolMissing 表示外部校验工具（promtool / blackbox_exporter）不可调用，
	// 此时中心内容校验返回 validation_status=pending（决策 42-2）。
	errToolMissing = errors.New("external validation tool not found")
)

// ValidateTargetGroups 对 file_sd 目标文件做 schema 校验（弥补 promtool 不校验
// SD 内容的缺口，PRD §3.3 / §3.5.1）：
//   - **空数组非法**：零组即无任何有效采集目标，与边缘 Agent ValidateTargetsJSON
//     的 `empty array` 同口径拒收（C-2，config-sync-stall-and-empty-targets-guard
//     设计提案 §3.2）。空 file_sd 数组语义上无意义，放行会让「资源地址缺失」这类
//     用户配置缺陷静默通过、并在数据面以「在线数 0」暴露，掩盖归因；
//   - 每组必须有 targets；
//   - 地址格式合法（URL 或 host / host:port）；
//   - labels 命名合法（禁止覆盖 __address__ 等内置标签）。
//
// 该判定属**确定性用户配置缺陷**，调用侧（ValidateArtifacts）必须置于外部工具
// （promtool/amtool）可用性检查之前，不得因工具缺失退化为 pending。
func ValidateTargetGroups(groups []TargetGroup) error {
	if len(groups) == 0 {
		return fmt.Errorf("targets 文件为空：未解析出任何有效采集目标")
	}
	for _, g := range groups {
		if len(g.Targets) == 0 {
			return fmt.Errorf("target group 缺少 targets")
		}
		for _, t := range g.Targets {
			if err := validateTargetAddress(t); err != nil {
				return err
			}
		}
		for k := range g.Labels {
			if err := validateLabelName(k); err != nil {
				return err
			}
		}
	}
	return nil
}

// validateTargetAddress 校验单个目标地址：允许 URL（blackbox），否则 host / host:port。
func validateTargetAddress(addr string) error {
	if addr == "" {
		return fmt.Errorf("目标地址为空")
	}
	if strings.Contains(addr, "://") {
		return nil // blackbox 拨测 URL
	}
	host := addr
	if i := strings.LastIndex(addr, ":"); i != -1 {
		h, _, err := net.SplitHostPort(addr)
		if err != nil {
			// 不含端口的裸 host（仅一个冒号在最后）也接受；否则视为非法。
			if strings.Count(addr, ":") == 1 {
				host = addr[:i]
			} else {
				return fmt.Errorf("目标地址 %q 非法", addr)
			}
		} else {
			host = h
		}
	}
	if strings.TrimSpace(host) == "" {
		return fmt.Errorf("目标地址 %q 缺少 host", addr)
	}
	if !validTargetHost(host) {
		return fmt.Errorf("目标地址 %q 含非法字符", addr)
	}
	return nil
}

// validTargetHost 校验 host 仅含合法主机名/地址字符（字母数字、点、连字符、冒号），
// 用于拒绝 `__bad__` 这类含下划线的非法目标（PRD §3.3 targets schema 校验）。
func validTargetHost(host string) bool {
	if host == "" {
		return false
	}
	for _, r := range host {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9',
			r == '.', r == '-', r == ':':
		default:
			return false
		}
	}
	return true
}

// validateLabelName 校验标签名合法且不覆盖内置标签。
// instance 单独放行：它是 Prometheus 约定标签（非 `__` 前缀保留标签），
// 在 static_configs[].labels 中写入 instance 是标准用法；系统默认模板按
// PRD M07 §5.12C 组合字段生成 instance_ip:port → instance，与此保持一致。
// M09 PRD §3.5.1 仅禁止覆盖 `__address__` 等内置标签，不含 instance。
func validateLabelName(name string) error {
	if name == "" {
		return fmt.Errorf("标签名为空")
	}
	if name == "instance" {
		return nil
	}
	if models.IsProtectedLabel(name) {
		return fmt.Errorf("禁止覆盖内置标签 %q", name)
	}
	return nil
}

// ValidateArtifacts 对配置产物做中心内容校验，返回：
//   - status：passed/failed/pending（PRD §3.5.1 / 决策 42-2）；
//   - cause：故障归因（user_config 用户配置可修复 / platform_fault 平台技术故障，决策 45-3）；
//   - details：结构化校验失败定位（对齐原型 validation_details）；passed/pending 为空；
//   - message：人类可读说明。
//
// platformJobs 是发布期规则 job 引用校验（决策 66）的生效 Job 集合：由调用侧
// （configcenter/draft）经 rule.EffectiveJobNames 计算为 central 全域并集（全库
// enabled + draft_status=ready 的 job_name，跨 local/edge 域，F-14 改动 Y）。
// generator 包保持无 gorm 依赖（纯产物校验），不做 DB 查询。
//
// 归因规则（决策 42-2 / 45-3）：targets schema / 内容校验失败 → user_config；
// 外部校验工具**不可调用或存在但不可执行** → platform_fault（pending）。
func ValidateArtifacts(ca *ConfigArtifacts, includeBlackbox bool, platformJobs []string) (models.ValidationStatus, models.ValidationCause, []models.ValidationDetail, string) {
	// 决策 74 定稿第 1 条：平台物化通知 receiver 与用户手写 receiver 重名 → 行级错误。
	// 该判定属**确定性用户配置缺陷**，须置于外部工具（amtool）可用性检查之前，
	// 不得因工具缺失退化为 pending。NotifyReceiverConflicts 为**非产物字段**，
	// 由 draft.buildArtifacts 在物化时填充（无物化 / 无冲突时为空）。
	if len(ca.NotifyReceiverConflicts) > 0 {
		details := make([]models.ValidationDetail, 0, len(ca.NotifyReceiverConflicts))
		for _, c := range ca.NotifyReceiverConflicts {
			msg := fmt.Sprintf("通知 receiver 名 %q 与已有 receiver 冲突：平台渠道按名称自动生成该 receiver，请重命名渠道或手写 receiver 以消除重名（平台绝不静默覆盖或合并）", c.Name)
			if c.Line > 0 {
				msg = fmt.Sprintf("通知 receiver 名 %q 与第 %d 行手写 receiver 冲突：请重命名渠道或手写 receiver 以消除重名（平台绝不静默覆盖或合并）", c.Name, c.Line)
			}
			details = append(details, models.ValidationDetail{File: "alertmanager.yml", Line: c.Line, Message: msg})
		}
		return models.ValidationStatusFailed, models.ValidationCauseUserConfig, details,
			fmt.Sprintf("存在 %d 条通知 receiver 重名冲突：请重命名冲突渠道或删除同名手写 receiver，再重校确认", len(details))
	}

	// 归因索引（C-1/C-2）：FileName 与 TargetsFiles 的 key 同源（normalizeJobFilename），
	// 按 basename 对齐。归因仅用于增强失败文案，**不参与判定**——判定结果与归因无关，
	// 保证无归因路径（如「重新校验」从 DB 重建产物）仍产出完全一致的 failed + user_config。
	diagByFile := make(map[string]*TargetDiagnostics, len(ca.TargetDiagnostics))
	for i := range ca.TargetDiagnostics {
		d := &ca.TargetDiagnostics[i]
		diagByFile[filepath.Base(d.FileName)] = d
	}
	for name, content := range ca.TargetsFiles {
		var groups []TargetGroup
		if err := json.Unmarshal([]byte(content), &groups); err != nil {
			return models.ValidationStatusFailed, models.ValidationCauseUserConfig,
				[]models.ValidationDetail{{File: name, Message: fmt.Sprintf("解析失败: %v", err), Source: models.ValidationSourceTargets}},
				fmt.Sprintf("targets 文件 %s 解析失败: %v", name, err)
		}
		if err := ValidateTargetGroups(groups); err != nil {
			// 空 targets：优先用归因（Job / 资源级定位）拼更精确文案；无归因时回落通用文案。
			msg := err.Error()
			if len(groups) == 0 {
				msg = emptyTargetsMessage(name, diagByFile[name])
			}
			return models.ValidationStatusFailed, models.ValidationCauseUserConfig,
				[]models.ValidationDetail{{File: name, Message: msg, Source: models.ValidationSourceTargets}},
				fmt.Sprintf("targets 文件 %s 非法: %s", name, msg)
		}
	}
	if _, err := ToolLookPath("promtool"); err != nil {
		return models.ValidationStatusPending, models.ValidationCausePlatformFault, nil, "promtool 不可调用，待运维环境就绪后重校"
	}
	if includeBlackbox && ca.BlackboxYML != "" {
		if _, err := ToolLookPath("blackbox_exporter"); err != nil {
			return models.ValidationStatusPending, models.ValidationCausePlatformFault, nil, "blackbox_exporter 不可调用，待环境就绪后重校"
		}
	}
	// 决策 60：存在 alertmanager.yml 时需 amtool 校验（管理域 default 范围）。
	if ca.AlertmanagerYML != "" {
		if _, err := ToolLookPath("amtool"); err != nil {
			return models.ValidationStatusPending, models.ValidationCausePlatformFault, nil, "amtool 不可调用，待环境就绪后重校"
		}
	}
	// F-35 建议 a：工具**存在但不可执行**（`ToolLookPath` 找得到、exec 却失败，典型为
	// 二进制与当前平台/架构不匹配的 `exec format error`）视同「工具缺失」——属环境未就绪，
	// 归 pending + platform_fault。归因不得落到 user_config：那会把环境问题误报成用户配置
	// 错误并引导用户去 M01 改配置（本函数上方三处 ToolLookPath 门禁即为此口径）。
	switch st, msg := ToolChecker(ca, includeBlackbox); st {
	case ToolCheckUnavailable:
		return models.ValidationStatusPending, models.ValidationCausePlatformFault, nil,
			fmt.Sprintf("外部校验工具无法执行（环境未就绪）：%s；待运维环境就绪后重校", msg)
	case ToolCheckUserConfig:
		return models.ValidationStatusFailed, models.ValidationCauseUserConfig,
			[]models.ValidationDetail{{File: "prometheus.yml", Message: msg, Source: models.ValidationSourceScrapeJob}},
			fmt.Sprintf("外部校验未通过: %s", msg)
	}
	// 决策 66：发布期规则 job 引用门禁。判定逻辑与 M01 编辑期同源（rule/jobref，
	// 单一实现 + 同一输入集，决策 67-4）：生效 Job 集合 = central 全域并集（F-14 改动 Y，
	// 由调用侧经 rule.EffectiveJobNames 计算传入，不再解析本域产物 scrape_configs）：
	//   - error 级（存活类缺 job）→ failed（user_config），阻断确认，前端展示前往 M01 修改；
	//   - warning 级 → passed + 告警 details，允许确认但高亮提示。
	if ca.RulesYML != "" {
		issues := jobref.Validate(ca.RulesYML, platformJobs)
		var fatal, warn []models.ValidationDetail
		for _, it := range issues {
			// 决策 67-3：标记来源为规则，配置确认页「前往修改」据此跳 /rules 而非 /scrape-jobs。
			d := models.ValidationDetail{
				File:    string(models.AffectedFileRules),
				Message: it.Message,
				Source:  models.ValidationSourceRule,
			}
			if it.Severity == jobref.SeverityError {
				fatal = append(fatal, d)
			} else {
				warn = append(warn, d)
			}
		}
		if len(fatal) > 0 {
			return models.ValidationStatusFailed, models.ValidationCauseUserConfig, fatal,
				fmt.Sprintf("存在 %d 条规则 job 引用错误：请先在 Module_01 创建对应采集 Job 或修正规则，再重校确认", len(fatal))
		}
		if len(warn) > 0 {
			return models.ValidationStatusPassed, "", warn,
				fmt.Sprintf("配置校验通过，但存在 %d 条规则 job 引用告警（允许确认，建议核对）", len(warn))
		}
	}
	return models.ValidationStatusPassed, "", nil, ""
}

// emptyTargetsMessage 为空 targets 文件拼装可操作的失败文案（C-2 归因增强）。
//
// 有归因时给出 Job + 资源级定位，并区分两类成因（决策 2）：
//   - 全部实例 offline（设计预期排除）→ 引导「移除该 Job 或恢复实例」；
//   - 存在采集地址为空 / 资源缺失（用户配置缺陷）→ 引导「补齐采集地址」。
//
// 无归因时（如「重新校验」从 DB 重建产物，TargetDiagnostics 为空）回落通用文案；
// 判定结果（failed + user_config）与归因无关，两条路径完全一致。
func emptyTargetsMessage(name string, diag *TargetDiagnostics) string {
	if diag == nil || len(diag.Skipped) == 0 {
		return fmt.Sprintf("targets 文件 %s 为空：未解析出任何有效采集目标，请检查该 Job 已选实例的采集地址", name)
	}
	parts := make([]string, 0, len(diag.Skipped))
	for _, s := range diag.Skipped {
		loc := s.ResourceID
		if loc == "" {
			loc = "未知资源"
		}
		if s.Category != "" {
			loc = fmt.Sprintf("%s（%s）", loc, s.Category)
		}
		parts = append(parts, fmt.Sprintf("%s：%s", loc, s.Detail))
	}
	head := fmt.Sprintf("targets 文件 %s 为空：Job %s 未解析出任何有效采集目标", name, diag.JobName)
	if diag.anyOfflineOnly() {
		return head + "——所有已选实例均已下线，请移除该 Job 或恢复实例；明细：" + strings.Join(parts, "；")
	}
	return head + "——实例采集地址为空，请补齐采集地址；明细：" + strings.Join(parts, "；")
}

// runToolChecks 实际调用 promtool check config 与 blackbox --config.check。
// 返回工具执行结果三态与人类可读摘要（通过时摘要为空）。
func runToolChecks(ca *ConfigArtifacts, includeBlackbox bool) (ToolCheckStatus, string) {
	if err := runPromtoolCheck(ca); err != nil {
		return toolCheckStatus(err), fmt.Sprintf("promtool check config 失败: %v", err)
	}
	if includeBlackbox && ca.BlackboxYML != "" {
		if err := runBlackboxCheck(ca.BlackboxYML); err != nil {
			return toolCheckStatus(err), fmt.Sprintf("blackbox --config.check 失败: %v", err)
		}
	}
	// 决策 60：存在 alertmanager.yml 时用 amtool 校验。
	if ca.AlertmanagerYML != "" {
		if err := runAmmtoolCheck(ca.AlertmanagerYML); err != nil {
			return toolCheckStatus(err), fmt.Sprintf("amtool check-config 失败: %v", err)
		}
	}
	return ToolCheckPassed, ""
}

// toolCheckStatus 把工具调用失败的底层错误归因成校验结果状态：
// 「工具存在但不可执行」→ ToolCheckUnavailable（platform_fault）；
// 其余（工具已成功启动、判定配置非法）→ ToolCheckUserConfig。
//
// 两个判定条件都保留：前者匹配经 toolCheckError 组装后的错误，后者兜住**未经组装**的
// 原始错误（校验前置步骤失败，如临时目录不可写时的 EACCES——同属环境故障，非用户配置缺陷）。
func toolCheckStatus(err error) ToolCheckStatus {
	var notExec *toolNotExecutableError
	if errors.As(err, &notExec) || isToolNotExecutable(err) {
		return ToolCheckUnavailable
	}
	return ToolCheckUserConfig
}

// runPromtoolCheck 将配置产物按真实下发目录结构写入临时目录
// （prometheus.yml + rules.yml + targets/*.json，与 deployment.writeStructural 一致），
// 再执行 promtool check config。prometheus.yml 通过 rule_files 引用同目录 rules.yml、
// file_sd_configs 引用 targets/*.json，缺文件会导致校验误报
// 「does not point to an existing file」，因此必须先把被引用文件写齐。
func runPromtoolCheck(ca *ConfigArtifacts) error {
	dir, err := os.MkdirTemp("", "promcheck-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	if err := os.WriteFile(filepath.Join(dir, "prometheus.yml"), []byte(ca.PrometheusYML), 0o644); err != nil {
		return err
	}
	if ca.RulesYML != "" {
		if err := os.WriteFile(filepath.Join(dir, "rules.yml"), []byte(ca.RulesYML), 0o644); err != nil {
			return err
		}
	}
	if len(ca.TargetsFiles) > 0 {
		targetsDir := filepath.Join(dir, "targets")
		if err := os.MkdirAll(targetsDir, 0o755); err != nil {
			return err
		}
		for name, content := range ca.TargetsFiles {
			// review-fix F6：落盘前二次断言纯文件名（写入点复用 map key 的防御纵深）。
			if err := EnsureTargetsFilename(name); err != nil {
				return err
			}
			if err := os.WriteFile(filepath.Join(targetsDir, name), []byte(content), 0o644); err != nil {
				return err
			}
		}
	}
	cmd := exec.Command("promtool", "check", "config", filepath.Join(dir, "prometheus.yml"))
	out, err := cmd.CombinedOutput()
	if err != nil {
		return toolCheckError("promtool", string(out), err)
	}
	return nil
}

// toolNotExecutableError 表示外部校验工具**存在但无法执行**（环境未就绪）。
// 经 toolCheckStatus 提升为 ToolCheckUnavailable → pending + platform_fault
// （M09 dev-feedback F-35 建议 a）。
type toolNotExecutableError struct {
	tool string
	err  error
}

func (e *toolNotExecutableError) Error() string {
	return fmt.Sprintf("无法执行 %s（二进制可能与当前平台/架构不匹配）: %v", e.tool, e.err)
}

func (e *toolNotExecutableError) Unwrap() error { return e.err }

// isToolNotExecutable 判定工具调用失败是否属于「工具存在但不可执行」（环境未就绪）：
//   - 二进制与当前平台/架构不匹配 → fork/exec 报 ENOEXEC（`exec format error`）；
//   - 二进制无执行权限 → EACCES；
//   - exec 期解析工具失败（LookPath 级）→ *exec.Error / exec.ErrNotFound。
//
// 三者都说明外部校验工具在此环境不可用，应归 platform_fault。而工具**已成功启动**、
// 仅以非零退出码返回（*exec.ExitError，典型为配置非法）不属于此类，仍归 user_config。
func isToolNotExecutable(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, syscall.ENOEXEC) || errors.Is(err, syscall.EACCES) || errors.Is(err, exec.ErrNotFound) {
		return true
	}
	var ee *exec.Error
	return errors.As(err, &ee)
}

// toolCheckError 组装外部校验工具（promtool / blackbox_exporter / amtool）失败的错误信息：
//   - 工具自身 stdout/stderr 非空（如 yaml 语法错、配置项非法）→ 原样采用，这是真正可定位的
//     用户配置错误，归 user_config；
//   - 输出为空 → 说明工具**存在但无法执行**（典型：二进制与当前平台/架构不匹配的
//     `exec format error`，如把 Linux ELF 放到 macOS 上），必须回带底层 exec 错误，
//     否则会产出「blackbox --config.check 失败: 」这类**空消息**、无法定位；此类归
//     platform_fault（F-35 建议 a）。
//
// 背景（M09 现场）：`upstream/blackbox_exporter/blackbox_exporter` 为部署目标交叉编译的
// Linux x86-64 ELF，在 macOS 开发机上 `exec.LookPath` 能找到、但执行即 exec format error，
// 原实现只取 out（空）而丢弃 err，导致校验失败原因不可见。
func toolCheckError(tool, out string, err error) error {
	if msg := strings.TrimSpace(out); msg != "" {
		return fmt.Errorf("%s", msg)
	}
	if isToolNotExecutable(err) {
		return &toolNotExecutableError{tool: tool, err: err}
	}
	return fmt.Errorf("无法执行 %s，且无错误输出: %v", tool, err)
}

func runBlackboxCheck(blackboxYAML string) error {
	f, err := os.CreateTemp("", "bbcheck-*.yml")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err := f.WriteString(blackboxYAML); err != nil {
		f.Close()
		return err
	}
	f.Close()
	cmd := exec.Command("blackbox_exporter", "--config.check", "--config.file="+f.Name())
	out, err := cmd.CombinedOutput()
	if err != nil {
		return toolCheckError("blackbox_exporter", string(out), err)
	}
	return nil
}

// runAmmtoolCheck 用 amtool check-config 校验 alertmanager.yml 内容
// （决策 60：amtool 对应 amtool 随 Alertmanager 附带的校验入口，管理域 default 范围）。
func runAmmtoolCheck(alertmanagerYAML string) error {
	f, err := os.CreateTemp("", "amcheck-*.yml")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err := f.WriteString(alertmanagerYAML); err != nil {
		f.Close()
		return err
	}
	f.Close()
	cmd := exec.Command("amtool", "check-config", f.Name())
	out, err := cmd.CombinedOutput()
	if err != nil {
		return toolCheckError("amtool", string(out), err)
	}
	return nil
}
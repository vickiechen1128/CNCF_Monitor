package rule

// promtool 规则语义校验（2026-10-13，P0 补齐）。
//
// 背景：M01 规则编辑的「检查」原本只覆盖 YAML 语法、groups 结构、组名唯一性与 job 引用，
// **不做 PromQL 语义校验**（validate.go 包注释曾写「PromQL 语义校验由 v0.3（M02）承担」，
// 但 M02 是查询中心，语义校验的正确位置是规则保存前）。仓库里 promtool 已被 M09 草稿校验
// 链路使用（configcenter/generator.ValidateArtifacts），此处复用同一工具补齐编辑期缺口：
// 可抓出 PromQL 语法错误、重复告警名、非法标签名、`for` / `keep_firing_for` 结构错误等。
//
// 归因纪律与 M09 一致（决策 67-4 / F-35）：
//   - promtool 缺失或不可执行（Linux 二进制放到 macOS 等）→ unavailable，
//     **只提示不阻断**（编辑期硬阻断会让用户无路可走；发布期 M09 仍会按 platform_fault 拦截）；
//   - promtool 成功启动并判定规则非法 → failed，属不可覆盖的硬失败，写进 valid=false。

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

// promQLCheckStatus 是 promtool 语义校验的三态结论。
type promQLCheckStatus string

const (
	// PromQLCheckPassed 表示 promtool 可用且规则通过语义校验。
	PromQLCheckPassed promQLCheckStatus = "passed"
	// PromQLCheckFailed 表示 promtool 判定规则非法（PromQL 语法等），属硬失败。
	PromQLCheckFailed promQLCheckStatus = "failed"
	// PromQLCheckUnavailable 表示 promtool 缺失或不可执行，只提示不阻断。
	PromQLCheckUnavailable promQLCheckStatus = "unavailable"
)

// promQLCheckResult 是语义校验结论 + 面向用户的原因说明。
type promQLCheckResult struct {
	Status  promQLCheckStatus `json:"status"`
	Message string            `json:"message,omitempty"`
}

// checkPromQLSyntax 用 promtool check rules 校验整份规则文件的 PromQL 语义。
//
// 与 M09 的差别（有意为之）：M09 把工具不可用升级为 pending + platform_fault，因为发布是
// 不可逆动作；编辑期检查是**辅助反馈**，工具不可用时不应阻断用户编辑，故降级为
// unavailable + 说明，由前端展示为提示条。
func checkPromQLSyntax(content string) promQLCheckResult {
	if _, err := exec.LookPath("promtool"); err != nil {
		return promQLCheckResult{
			Status:  PromQLCheckUnavailable,
			Message: "未找到 promtool，已跳过 PromQL 语义校验（YAML 语法与 job 引用校验仍然生效）",
		}
	}
	dir, err := os.MkdirTemp("", "rulepromcheck-*")
	if err != nil {
		return promQLCheckResult{Status: PromQLCheckUnavailable, Message: "创建临时目录失败：" + err.Error()}
	}
	defer os.RemoveAll(dir)

	// promtool check rules 按文件名后缀识别格式，扩展名必须是 .yml / .yaml。
	path := filepath.Join(dir, "rules.yml")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return promQLCheckResult{Status: PromQLCheckUnavailable, Message: "写入临时规则文件失败：" + err.Error()}
	}

	out, err := exec.Command("promtool", "check", "rules", path).CombinedOutput()
	if err == nil {
		return promQLCheckResult{Status: PromQLCheckPassed}
	}
	// 工具存在但无法执行（架构不匹配 ENOEXEC / 无执行权限 EACCES / LookPath 级失败）
	// → 归环境问题，不阻断编辑。
	if isToolNotExecutable(err) {
		return promQLCheckResult{
			Status:  PromQLCheckUnavailable,
			Message: "promtool 无法执行（二进制可能与当前平台/架构不匹配）：" + err.Error(),
		}
	}
	msg := strings.TrimSpace(string(out))
	if msg == "" {
		msg = err.Error()
	}
	return promQLCheckResult{Status: PromQLCheckFailed, Message: msg}
}

// isToolNotExecutable 判定工具调用失败是否属于「存在但不可执行」（环境未就绪）。
// 与 generator.isToolNotExecutable 同判定条件，此处独立实现以避免跨模块依赖。
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

// promQLCheckMessage 把校验结论组织成面向用户的一句话（failed 时进 valid=false 的 error）。
func promQLCheckMessage(r promQLCheckResult) string {
	if r.Status == PromQLCheckFailed {
		return fmt.Sprintf("PromQL 语义校验未通过：%s", r.Message)
	}
	return ""
}
// Package config 实现 Module_08 告警配置（alertmanager.yml）文件挂载服务：
// 校验（amtool check-config 等价）+ 版本留痕落库 + 触发 M09 管理域变更检测。
// 参见 docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md
//   §5.1（文件挂载契约）/ §6.6 / §9.1 / §9.2；design-decisions.md 决策 59/60。
package config

import (
	"errors"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
)

// amtoolUnavailableMsg 是 amtool 不可调用时的行级错误文案（可观测、不落库）。
const amtoolUnavailableMsg = "amtool check-config 不可调用，无法完成校验；请确保部署环境已提供 Alertmanager CLI（amtool）"

// validateNote 是校验失败响应 data 的 note（契约 §3）。
const validateNote = "校验失败未保存、未生效；修改后请重新挂载"

// 外部校验工具调用点可注入（便于测试模拟 amtool 可用性与输出，复用 M09 promtool 约定）。
var (
	// lookPathAmtool 判定 amtool 是否在 PATH。
	lookPathAmtool = exec.LookPath
	// runAmtoolCheckCmd 执行 amtool check-config（name 为解析后的绝对路径或 "amtool"）。
	runAmtoolCheckCmd = func(amtool, cfgPath string) (string, error) {
		cmd := exec.Command(amtool, "check-config", cfgPath)
		out, err := cmd.CombinedOutput()
		return string(out), err
	}
	// devfeedback 登记钩子：amtool 不可调用时记录可观测反馈（默认写日志，可由部署注入持久化）。
	devfeedback = func(msg string) {
		log.Printf("[alertmanager-config] dev-feedback: %s", msg)
	}
)

// linePattern 尝试从校验输出行中提取行号（如 `alertmanager.yml:14:` 或 `(line 14)`）。
var linePattern = regexp.MustCompile(`:\s*(\d+)\s*:|\bline\s+(\d+)\b|\((\d+)\)`)

// validateAlertmanagerConfig 对完整 alertmanager.yml 做 amtool check-config 等价校验
// （YAML 语法 + route/receiver 引用闭合）。校验失败返回 *ErrValidation（行级错误，
// 不落库、不进 M09 流水线，决策 60）；amtool 不可调用时同样视为校验失败并在
// dev-feedback 登记（复用 M09 promtool 调用约定，不硬编码路径）。
func validateAlertmanagerConfig(content string) error {
	items, checkErr := runCheckConfig(content)
	if checkErr != nil {
		// amtool 不可调用：可观测校验失败（不落库）+ dev-feedback 登记。
		devfeedback(checkErr.Error())
		return &ErrValidation{Items: items, Note: validateNote}
	}
	if len(items) > 0 {
		return &ErrValidation{Items: items, Note: validateNote}
	}
	return nil
}

// runCheckConfig 调用 amtool check-config 校验并解析行级错误。
// 返回 (错误项, 工具不可用错误)。工具可用且校验通过时 items 为空、checkErr 为 nil。
func runCheckConfig(content string) ([]models.ValidateErrorItem, error) {
	amtool, err := lookPathAmtool("amtool")
	if err != nil {
		return []models.ValidateErrorItem{{File: "alertmanager.yml", Line: 0, Message: amtoolUnavailableMsg}},
			errors.New(amtoolUnavailableMsg)
	}
	// 写入临时 alertmanager.yml（amtool check-config 以文件路径为参，缺省返回 FAILED）。
	dir, err := os.MkdirTemp("", "amcheck-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	cfgPath := filepath.Join(dir, "alertmanager.yml")
	if err := os.WriteFile(cfgPath, []byte(content), 0o644); err != nil {
		return nil, err
	}
	output, _ := runAmtoolCheckCmd(amtool, cfgPath)
	if isSuccess(output) && err == nil {
		return nil, nil
	}
	return parseCheckErrors(output), nil
}

// isSuccess 依据 amtool check-config 输出中的 SUCCESS 标记判定校验通过。
func isSuccess(output string) bool {
	return strings.Contains(output, "SUCCESS")
}

// parseCheckErrors 解析 amtool 校验输出为行级错误集合。尽力提取 file/line/message：
//   - 跳过 "Checking 'alertmanager.yml'" 简报行；
//   - 其余非空行作为一条错误（message 为去空白/冒号修饰的行内容）；
//   - 用 linePattern 尽力提取行号，无法提取时 line=0；
//   - 无有效错误行时补一条通用失败项，保证前端可展示「校验失败」。
func parseCheckErrors(output string) []models.ValidateErrorItem {
	items := make([]models.ValidateErrorItem, 0)
	for _, raw := range strings.Split(strings.TrimSpace(output), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.Contains(line, "Checking '") {
			continue
		}
		item := models.ValidateErrorItem{
			File:    "alertmanager.yml",
			Line:    extractLine(line),
			Message: strings.TrimRight(strings.TrimLeft(line, ": "), " :"),
		}
		if item.Message == "" {
			continue
		}
		items = append(items, item)
	}
	if len(items) == 0 {
		items = append(items, models.ValidateErrorItem{
			File:    "alertmanager.yml",
			Line:    0,
			Message: "amtool check-config 校验失败",
		})
	}
	return items
}

// extractLine 从一行校验输出中提取行号；提取不到返回 0。
func extractLine(line string) int {
	m := linePattern.FindStringSubmatch(line)
	if m == nil {
		return 0
	}
	for _, g := range m[1:] {
		if g == "" {
			continue
		}
		if n, err := strconv.Atoi(g); err == nil {
			return n
		}
	}
	return 0
}
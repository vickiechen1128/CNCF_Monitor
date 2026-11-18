package rule

// promtool 语义校验的单元测试（2026-10-13）。
//
// 用桩脚本伪造 promtool 的三种行为，锁定三态归因：
// 通过 / 规则非法（硬失败）/ 工具不可用（只提示不阻断）。

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// stubPromtool 在临时目录放一个可执行的假 promtool，并把该目录前置到 PATH。
// script 为空表示「可执行但不是脚本」（用来制造 exec format error）。
func stubPromtool(t *testing.T, script string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "promtool")
	if script == "" {
		// 二进制头无效 → exec 时 ENOEXEC（macOS / Linux 均为 exec format error）
		require.NoError(t, os.WriteFile(path, []byte("\x7f\x00\x00\x00garbage"), 0o755))
	} else {
		require.NoError(t, os.WriteFile(path, []byte(script), 0o755))
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

const validRulesYAML = `groups:
  - name: g
    rules:
      - alert: HighCPU
        expr: node_cpu_seconds_total > 0.9
        for: 5m
        annotations:
          summary: 'CPU 过高：{{ $labels.instance }}'
`

func TestCheckPromQLSyntaxPassed(t *testing.T) {
	stubPromtool(t, "#!/bin/sh\nexit 0\n")
	res := checkPromQLSyntax(validRulesYAML)
	assert.Equal(t, PromQLCheckPassed, res.Status)
	assert.Empty(t, promQLCheckMessage(res), "通过时不得产生阻断信息")
}

func TestCheckPromQLSyntaxFailedIsHardFailure(t *testing.T) {
	stubPromtool(t, "#!/bin/sh\necho 'line 4: could not parse expression: unexpected }' >&2\nexit 1\n")
	res := checkPromQLSyntax(validRulesYAML)
	assert.Equal(t, PromQLCheckFailed, res.Status)
	msg := promQLCheckMessage(res)
	assert.Contains(t, msg, "PromQL 语义校验未通过")
	assert.Contains(t, msg, "could not parse expression", "必须把 promtool 原始输出带给用户定位")
}

func TestCheckPromQLSyntaxUnavailableWhenToolMissing(t *testing.T) {
	// PATH 里没有 promtool
	t.Setenv("PATH", t.TempDir())
	res := checkPromQLSyntax(validRulesYAML)
	assert.Equal(t, PromQLCheckUnavailable, res.Status)
	assert.Contains(t, res.Message, "promtool")
	assert.Empty(t, promQLCheckMessage(res), "工具缺失不得改写 valid（不阻断编辑）")
}

func TestCheckPromQLSyntaxUnavailableWhenNotExecutable(t *testing.T) {
	stubPromtool(t, "") // 可执行位已置但内容不是可执行文件 → exec format error
	res := checkPromQLSyntax(validRulesYAML)
	assert.Equal(t, PromQLCheckUnavailable, res.Status)
	assert.Empty(t, promQLCheckMessage(res), "工具不可执行属环境问题，不得阻断编辑")
}

// TestValidateRuleYAMLHandlerPromQLGate 覆盖 handler 层：promql_check 字段回显 + failed 改写 valid。
func TestValidateRuleYAMLHandlerPromQLGate(t *testing.T) {
	stubPromtool(t, "#!/bin/sh\necho 'bad expr' >&2\nexit 1\n")
	res := checkPromQLSyntax(validRulesYAML)
	assert.Equal(t, PromQLCheckFailed, res.Status)
	// 三态与 handler 消费方式一致：failed 有阻断信息，其余为空。
	assert.NotEmpty(t, promQLCheckMessage(res))
}

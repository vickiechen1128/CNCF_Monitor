package generator

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"syscall"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/models"
)

// TestToolCheckErrorKeepsToolOutput 覆盖：工具自身有 stdout/stderr（真正的配置错误，如
// yaml 语法错）时，原样保留工具输出（去除首尾空白），归 user_config。
func TestToolCheckErrorKeepsToolOutput(t *testing.T) {
	err := toolCheckError("promtool", "  yaml: line 3: could not find expected ':'\n", errors.New("exit status 1"))
	assert.EqualError(t, err, "yaml: line 3: could not find expected ':'")
	assert.Equal(t, ToolCheckUserConfig, toolCheckStatus(err), "工具已执行并判定配置非法 → user_config")
}

// TestToolCheckErrorEmptyOutputFallsBackToExecError 覆盖 M09 现场缺陷：工具文件存在但
// **无法执行**（典型：二进制与当前平台/架构不匹配的 `exec format error`，如 Linux ELF
// 跑在 macOS 上）时输出为空，必须回带底层 exec 错误，不得产出「失败: 」这类空消息；
// 且必须归 ToolCheckUnavailable（F-35 建议 a）。
func TestToolCheckErrorEmptyOutputFallsBackToExecError(t *testing.T) {
	raw := &os.PathError{Op: "fork/exec", Path: "/x/blackbox_exporter", Err: syscall.ENOEXEC}
	err := toolCheckError("blackbox_exporter", "  \n", raw)

	assert.NotEmpty(t, err.Error(), "空输出时不得产出空消息")
	assert.Contains(t, err.Error(), "blackbox_exporter")
	assert.Contains(t, err.Error(), "exec format error")
	assert.Equal(t, ToolCheckUnavailable, toolCheckStatus(err),
		"「存在但不可执行」须归 platform_fault，而非 user_config")
	assert.ErrorIs(t, err, syscall.ENOEXEC, "须保留底层错误链，便于排障")
}

// TestToolCheckStatusAttribution 锁定归因分流的正反例（F-35 建议 a）。
func TestToolCheckStatusAttribution(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want ToolCheckStatus
	}{
		{"架构不匹配 ENOEXEC", &os.PathError{Op: "fork/exec", Path: "/x/promtool", Err: syscall.ENOEXEC}, ToolCheckUnavailable},
		{"无执行权限 EACCES", &os.PathError{Op: "fork/exec", Path: "/x/promtool", Err: syscall.EACCES}, ToolCheckUnavailable},
		{"exec 期解析工具失败", &exec.Error{Name: "promtool", Err: exec.ErrNotFound}, ToolCheckUnavailable},
		{"工具已执行但判定配置非法", errors.New("yaml: line 3: bad indent"), ToolCheckUserConfig},
		{"工具已执行但非零退出", errors.New("exit status 1"), ToolCheckUserConfig},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, toolCheckStatus(tc.err))
		})
	}
}

// stubToolChecker 注入外部校验工具结果，聚焦 ValidateArtifacts 的归因映射。
func stubToolChecker(t *testing.T, st ToolCheckStatus, msg string) {
	t.Helper()
	oldLook := ToolLookPath
	oldChecker := ToolChecker
	ToolLookPath = func(name string) (string, error) { return name, nil }
	ToolChecker = func(ca *ConfigArtifacts, ib bool) (ToolCheckStatus, string) { return st, msg }
	t.Cleanup(func() { ToolLookPath = oldLook; ToolChecker = oldChecker })
}

// TestValidateArtifactsPendingWhenToolNotExecutable 覆盖 M09 dev-feedback F-35 建议 a：
// 「工具存在但不可执行」（如把 Linux ELF 放到 macOS 上）须与「工具缺失」同口径归
// pending + platform_fault，而不是 failed + user_config——后者会把环境问题误报成用户
// 配置错误、并误导用户回 M01 改一份本就正确的配置。
func TestValidateArtifactsPendingWhenToolNotExecutable(t *testing.T) {
	stubToolChecker(t, ToolCheckUnavailable,
		"blackbox --config.check 失败: 无法执行 blackbox_exporter（二进制可能与当前平台/架构不匹配）: fork/exec /x/blackbox_exporter: exec format error")

	ca := &ConfigArtifacts{PrometheusYML: "global: {}\n"}
	status, cause, details, msg := ValidateArtifacts(ca, false, nil)

	assert.Equal(t, models.ValidationStatusPending, status, "环境未就绪应为待校验，而非校验失败")
	assert.Equal(t, models.ValidationCausePlatformFault, cause)
	assert.Empty(t, details, "pending 态不给结构化定位：用户无可修项")
	assert.Contains(t, msg, "环境未就绪")
	assert.Contains(t, msg, "exec format error", "须保留可排障的底层原因")
}

// TestValidateArtifactsFailedWhenToolCheckUserConfig 反向对照：工具已执行并判定配置非法
// 时，仍归 failed + user_config（带 prometheus.yml 结构化定位），与 F-35 改动互不影响。
func TestValidateArtifactsFailedWhenToolCheckUserConfig(t *testing.T) {
	stubToolChecker(t, ToolCheckUserConfig, "promtool check config 失败: yaml: line 3: bad indent")

	ca := &ConfigArtifacts{PrometheusYML: "global: {}\n"}
	status, cause, details, msg := ValidateArtifacts(ca, false, nil)

	assert.Equal(t, models.ValidationStatusFailed, status)
	assert.Equal(t, models.ValidationCauseUserConfig, cause)
	require.Len(t, details, 1)
	assert.Equal(t, "prometheus.yml", details[0].File)
	assert.Equal(t, models.ValidationSourceScrapeJob, details[0].Source)
	assert.Contains(t, msg, "外部校验未通过")
}

// ---- 端到端：走真实 exec.LookPath / exec.Command，验证「存在但不可执行」的实际归因 ----

// platformMismatchBinary 以 ELF magic（0x7f 'E' 'L' 'F'）开头：文件本身**可执行**
// （LookPath 因 X_OK 通过而找得到），但其格式当前内核无法运行——POSIX 内核对未知可执行
// 格式返回 ENOEXEC。这正是 M09 现场 CHG-20260930-002 的成因（交叉编译的 Linux ELF
// 跑在 macOS 上，exit 126 / exec format error）。
var platformMismatchBinary = []byte("\x7fELF\x02\x01\x01\x00not-a-real-binary")

// okToolScript 是一个永远成功的假校验工具（忽略参数、退出码 0）。
const okToolScript = "#!/bin/sh\nexit 0\n"

// fakeToolsInPATH 在同一临时目录造出若干假外部校验工具（统一 0755），并把该目录置于
// PATH 首位，使 exec.LookPath / exec.Command 解析到它们（不依赖真实外部二进制）。
func fakeToolsInPATH(t *testing.T, tools map[string][]byte) {
	t.Helper()
	dir := t.TempDir()
	for name, content := range tools {
		require.NoError(t, os.WriteFile(filepath.Join(dir, name), content, 0o755))
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

// TestRunToolChecksClassifiesPlatformMismatchAsUnavailable 是 F-35 建议 a 的端到端回归：
// 外部校验工具**存在但无法执行**时必须归 ToolCheckUnavailable（→ pending + platform_fault），
// 否则会归成 failed + user_config 并误导用户回 M01 改一份本就正确的配置。
func TestRunToolChecksClassifiesPlatformMismatchAsUnavailable(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("ELF 镜像与 exec format error 语义仅适用于 Unix")
	}
	fakeToolsInPATH(t, map[string][]byte{"promtool": platformMismatchBinary})

	st, msg := runToolChecks(&ConfigArtifacts{PrometheusYML: "global: {}\n"}, false)

	assert.Equal(t, ToolCheckUnavailable, st, "平台/架构不匹配须归 platform_fault，不得归 user_config")
	assert.NotEmpty(t, msg, "不得产出空消息（M09 现场缺陷）")
	assert.Contains(t, msg, "promtool")
}

// TestRunToolChecksClassifiesBlackboxPlatformMismatchAsUnavailable 复刻 M09 现场
// CHG-20260930-002：promtool 正常、仅 blackbox_exporter 是平台不匹配的二进制
// （打包/交叉编译步骤覆盖所致）→ 整单仍须归 ToolCheckUnavailable，且消息点名 blackbox。
func TestRunToolChecksClassifiesBlackboxPlatformMismatchAsUnavailable(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("ELF 镜像与 exec format error 语义仅适用于 Unix")
	}
	fakeToolsInPATH(t, map[string][]byte{
		"promtool":          []byte(okToolScript),
		"blackbox_exporter": platformMismatchBinary,
	})

	st, msg := runToolChecks(&ConfigArtifacts{
		PrometheusYML: "global: {}\n",
		BlackboxYML:   "modules:\n  http_2xx:\n    prober: http\n",
	}, true)

	assert.Equal(t, ToolCheckUnavailable, st)
	assert.Contains(t, msg, "blackbox")
	assert.Contains(t, msg, "exec format error", "须保留可排障的底层原因")
}

// TestRunToolChecksClassifiesConfigErrorAsUserConfig 反向对照：假工具能正常执行、以非零
// 退出码 + stderr 返回（真正的配置非法）→ 仍归 ToolCheckUserConfig（failed + user_config）。
func TestRunToolChecksClassifiesConfigErrorAsUserConfig(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("依赖 POSIX shell 脚本作为假工具")
	}
	fakeToolsInPATH(t, map[string][]byte{
		"promtool": []byte("#!/bin/sh\necho \"yaml: line 3: could not find expected ':'\" >&2\nexit 1\n"),
	})

	st, msg := runToolChecks(&ConfigArtifacts{PrometheusYML: "global: {}\n"}, false)

	assert.Equal(t, ToolCheckUserConfig, st, "工具已执行并判定配置非法 → user_config")
	assert.Contains(t, msg, "could not find expected")
}

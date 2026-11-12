package models

import (
	"fmt"
	"strings"
	"unicode"
)

// forbiddenJobNameChars 是 job_name 中禁止出现的字符：
// 路径分隔符（/ \）与 Windows 文件名非法字符（: * ? " < > |）。
//
// targets 文件名直接使用 <job_name>.json（见 generator.normalizeJobFilename），
// 因此 job_name 只受「能否原样作为文件名」约束，不做 ASCII 白名单——
// 中文、大小写字母、数字及其它符号均可使用。
const forbiddenJobNameChars = `/\:*?"<>|`

// ValidateJobName 校验 job_name 能否原样用作 targets 文件名（<job_name>.json）。
//
// 规则刻意保持与「文件名安全」一一对应，而不是限制 Job 名的业务语义：
//   - 不能为空；
//   - 不能是 "." / ".."，不能以 "." 结尾（Windows 会忽略结尾点）；
//   - 不能包含空白、控制字符、路径分隔符与 Windows 非法文件名字符，
//     避免目录穿越与跨平台建文件失败；
//   - 不能是 Windows 保留设备名（CON/NUL/COM1 等，带 .json 后缀同样无法创建）。
//
// 中文等 Unicode 字符全部放行：job_name 存什么，targets 文件就叫什么，
// 保证不同 Job 名不会因为归一化而落到同一个文件、互相覆盖。
func ValidateJobName(name string) error {
	if name == "" {
		return fmt.Errorf("job_name 不能为空")
	}
	if name == "." || name == ".." || strings.HasSuffix(name, ".") {
		return fmt.Errorf("job_name 不能为 . / .. 或以 . 结尾")
	}
	for _, r := range name {
		if unicode.IsSpace(r) || unicode.IsControl(r) || strings.ContainsRune(forbiddenJobNameChars, r) {
			return fmt.Errorf(`job_name 不能包含空白、控制字符或 / \ : * ? " < > | 等文件名非法字符`)
		}
	}
	if isWindowsReservedDeviceName(name) {
		return fmt.Errorf("job_name %q 是 Windows 保留设备名，无法用作文件名", name)
	}
	return nil
}

// isWindowsReservedDeviceName 判定名字（含扩展名前的主干）是否为 Windows 保留设备名。
// 这些名字即使带 .json 后缀也无法在 Windows 上创建文件。
func isWindowsReservedDeviceName(name string) bool {
	base := name
	if i := strings.IndexByte(base, '.'); i >= 0 {
		base = base[:i]
	}
	upper := strings.ToUpper(base)
	switch upper {
	case "CON", "PRN", "AUX", "NUL":
		return true
	}
	if len(upper) == 4 && (strings.HasPrefix(upper, "COM") || strings.HasPrefix(upper, "LPT")) {
		return upper[3] >= '1' && upper[3] <= '9'
	}
	return false
}

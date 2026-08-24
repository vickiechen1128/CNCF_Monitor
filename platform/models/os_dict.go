package models

import (
	"strings"
	"unicode"
)

// OS 内置字典：将常用的操作系统「规范名」映射到监控家族（linux / windows）。
//
// 背景：os_type 原为自由文本，采集 Job 候选筛选靠 monitor_type.go 中写死的
// OSKeywords 用 LOWER LIKE 做脆性匹配，用户拼错或填了带版本的全名就匹配不到
// （host_linux / host_windows）。本字典作为单一权威：
//
//   - 前端「操作系统」下拉展示 ListOSOptions()，让用户从规范名选择（可自定义）；
//   - 资源写入经 NormalizeOSType 归一化为规范名，保证后续候选匹配稳定；
//   - DeriveResourceFilter 的 host 家族匹配关键字由本字典推导 + 家族兜底 token。
//
// 家族口径对齐 Module_01 monitor_type 推导：unix（AIX/Solaris）沿用既有
// unix→host_linux 的归类，纳入 linux 家族。MVP 不引入 unix 独立监控型。
type OSOption struct {
	Name   string `json:"name"`   // 规范名（前端下拉展示 / 写入归一化目标）
	Family string `json:"family"` // 监控家族：linux 或 windows
}

// OS 家庭枚举（对齐 host_linux / host_windows 监控类型）。
const (
	OSFamilyLinux   = "linux"
	OSFamilyWindows = "windows"
)

// osDict 是常用操作系统内置字典（规范名 → 家族）。
var osDict = []OSOption{
	{Name: "RedHat Enterprise Linux", Family: OSFamilyLinux},
	{Name: "CentOS", Family: OSFamilyLinux},
	{Name: "Ubuntu", Family: OSFamilyLinux},
	{Name: "Debian", Family: OSFamilyLinux},
	{Name: "SUSE Linux Enterprise", Family: OSFamilyLinux},
	{Name: "openEuler", Family: OSFamilyLinux},
	{Name: "EulerOS", Family: OSFamilyLinux},
	{Name: "Kylin OS", Family: OSFamilyLinux},
	{Name: "UOS", Family: OSFamilyLinux},
	{Name: "Rocky Linux", Family: OSFamilyLinux},
	{Name: "AlmaLinux", Family: OSFamilyLinux},
	{Name: "Fedora", Family: OSFamilyLinux},
	{Name: "AIX", Family: OSFamilyLinux},
	{Name: "Solaris", Family: OSFamilyLinux},
	{Name: "Windows Server 2022", Family: OSFamilyWindows},
	{Name: "Windows Server 2019", Family: OSFamilyWindows},
	{Name: "Windows Server 2016", Family: OSFamilyWindows},
	{Name: "Windows Server 2012", Family: OSFamilyWindows},
	{Name: "Windows 11", Family: OSFamilyWindows},
	{Name: "Windows 10", Family: OSFamilyWindows},
}

// ListOSOptions 返回操作系统内置字典（供前端下拉与接口消费，只读）。
func ListOSOptions() []OSOption {
	out := make([]OSOption, len(osDict))
	copy(out, osDict)
	return out
}

// ResolveOSFamily 返回规范名归属的家族（linux / windows），未知返回空串。
// 大小写不敏感。用于归一化回落与宿主判断。
func ResolveOSFamily(name string) string {
	lower := strings.ToLower(strings.TrimSpace(name))
	for _, o := range osDict {
		if strings.ToLower(o.Name) == lower {
			return o.Family
		}
	}
	if isWindowsLike(lower) {
		return OSFamilyWindows
	}
	if isLinuxLike(lower) {
		return OSFamilyLinux
	}
	return ""
}

// osKeywordsFor 返回某家族（linux/windows）候选匹配的关键词集：
// 该家族全部规范名 + 家族兜底 token，供 monitor_type 候选筛选 LIKE 匹配。
func osKeywordsFor(family string) []string {
	var kws []string
	for _, o := range osDict {
		if o.Family == family {
			kws = append(kws, strings.ToLower(o.Name))
		}
	}
	switch family {
	case OSFamilyLinux:
		kws = append(kws, "linux", "unix")
	case OSFamilyWindows:
		kws = append(kws, "windows", "win")
	}
	return kws
}

// OSKeywordsForLinux / OSKeywordsForWindows 暴露给 monitor_type.go 组装
// host 候选筛选关键字。
func OSKeywordsForLinux() []string   { return osKeywordsFor(OSFamilyLinux) }
func OSKeywordsForWindows() []string { return osKeywordsFor(OSFamilyWindows) }

// NormalizeOSType 将输入的操作系统文本归一化为字典规范名，保证候选匹配稳定：
//
//  1. 精确匹配（大小写不敏感）字典规范名 → 返回该规范名；
//  2. 字典规范名作为前缀（后随空格/数字/小数点等边界）→ 归一化为该规范名
//     （如 "ubuntu 22.04 LTS" → "Ubuntu"、"windows server 2019 dc" → "Windows Server 2019"）；
//  3. 仅能识别家族（含 linux/unix/windows 等家族 token）的非字典值 → 回落为
//     "Linux" / "Windows" 家族标签，确保能被 host_linux / host_windows 候选命中；
//  4. 其余保留原样（自定义 / 防拼写错误但仍能保留的值由前端下拉规避）。
func NormalizeOSType(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return s
	}
	lower := strings.ToLower(s)
	for _, o := range osDict {
		if o.Name == s || strings.EqualFold(s, o.Name) {
			return o.Name
		}
	}
	for _, o := range osDict {
		nameLower := strings.ToLower(o.Name)
		if len(lower) > len(nameLower) && strings.HasPrefix(lower, nameLower) {
			// 前缀后必须是边界符（空格/数字/点等），避免把 "Windows" 误配到
			// "Windows Server…" 或把 "Win" 匹配错误单词。
			if r := rune(s[len(nameLower)]); unicode.IsSpace(r) || unicode.IsDigit(r) || r == '.' || r == '-' {
				return o.Name
			}
		}
	}
	if isWindowsLike(lower) {
		return "Windows"
	}
	if isLinuxLike(lower) {
		return "Linux"
	}
	return s
}

// isWindowsLike 判断文本是否含 windows 家族标志词：独立单词 windows，或以 "win" 开头
// （Win7/Win10/Win11 等；OS 字段场景下 win 前缀即视为 Windows 家族）。
func isWindowsLike(lower string) bool {
	return containsWord(lower, "windows") || strings.HasPrefix(lower, "win")
}

// isLinuxLike 判断文本是否含 linux/unix 家族标志词。
func isLinuxLike(lower string) bool {
	tokens := []string{"linux", "unix", "ubuntu", "centos", "debian", "redhat", "fedora", "suse", "openeuler", "euler", "kylin", "aix", "solaris"}
	for _, t := range tokens {
		if containsWord(lower, t) {
			return true
		}
	}
	return false
}

// containsWord 判断 lower 是否包含单词 word（词边界：前后非字母数字）。
func containsWord(lower, word string) bool {
	for i := 0; i+len(word) <= len(lower); i++ {
		if strings.EqualFold(lower[i:i+len(word)], word) {
			beforeOK := i == 0 || !isWordChar(rune(lower[i-1]))
			afterOK := i+len(word) == len(lower) || !isWordChar(rune(lower[i+len(word)]))
			if beforeOK && afterOK {
				return true
			}
		}
	}
	return false
}

func isWordChar(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '.'
}
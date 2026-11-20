package models

import "strings"

// OS 内置字典：将常用的操作系统「规范名」映射到监控家族（linux / windows）。
//
// 背景：os_type 原为自由文本，采集 Job 候选筛选靠写死的 OSKeywords
// 用 LOWER LIKE 做脆性匹配，用户拼错或填了带版本的全名就匹配不到
// （host_linux / host_windows）。本字典作为单一权威：
//
//   - 前端「操作系统」下拉展示 ListOSOptions()，让用户从规范名选择（可自定义）；
//   - host 家族匹配关键字由本字典推导 + 家族兜底 token。
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

// OSKeywordsForLinux / OSKeywordsForWindows 暴露给 M01 候选筛选组装 host 匹配关键字。
func OSKeywordsForLinux() []string   { return osKeywordsFor(OSFamilyLinux) }
func OSKeywordsForWindows() []string { return osKeywordsFor(OSFamilyWindows) }

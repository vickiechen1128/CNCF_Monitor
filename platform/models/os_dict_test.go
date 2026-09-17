package models

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeOSType(t *testing.T) {
	// 1. 精确匹配（大小写不敏感）→ 返回字典规范名
	assert.Equal(t, "Ubuntu", NormalizeOSType("ubuntu"))
	assert.Equal(t, "Ubuntu", NormalizeOSType("  Ubuntu  "))
	assert.Equal(t, "Windows Server 2019", NormalizeOSType("windows server 2019"))
	// 2. 规范名前缀 + 版本归一化（后随空格/点/数字边界）
	assert.Equal(t, "Ubuntu", NormalizeOSType("ubuntu 22.04 LTS"))
	assert.Equal(t, "CentOS", NormalizeOSType("CentOS 7.9"))
	assert.Equal(t, "Windows Server 2019", NormalizeOSType("Windows Server 2019 DataCenter"))
	// 3. 非字典值但含家族 token → 回落为家族标签
	assert.Equal(t, "Linux", NormalizeOSType("Amazon Linux"))
	assert.Equal(t, "Linux", NormalizeOSType("Linux Mint"))
	assert.Equal(t, "Windows", NormalizeOSType("Windows Server 2008"))
	// 4. 未知/自定义（不含家族 token）→ 保留原样
	assert.Equal(t, "custom os", NormalizeOSType("custom os"))
}

func TestResolveOSFamily(t *testing.T) {
	assert.Equal(t, OSFamilyLinux, ResolveOSFamily("Ubuntu"))
	assert.Equal(t, OSFamilyLinux, ResolveOSFamily("centos"))
	assert.Equal(t, OSFamilyWindows, ResolveOSFamily("Windows 10"))
	assert.Equal(t, OSFamilyLinux, ResolveOSFamily("AIX"))
	assert.Equal(t, OSFamilyWindows, ResolveOSFamily("win11"))
	assert.Equal(t, "", ResolveOSFamily("UnknownOS"))
}

func TestOSKeywordsFor(t *testing.T) {
	linuxKws := OSKeywordsForLinux()
	winKws := OSKeywordsForWindows()
	require.Len(t, linuxKws, len(familyNames(OSFamilyLinux))+2, "linux 家族关键字 = 规范名 + 兜底 token")
	require.True(t, contains(linuxKws, "linux"), "linux 家族应含兜底 token linux")
	require.True(t, contains(linuxKws, "ubuntu"), "linux 家族应含 Ubuntu 规范名")
	require.True(t, contains(winKws, "windows"), "windows 家族应含兜底 token windows")
	require.True(t, contains(winKws, "windows 10"), "windows 家族应含 Windows 10 规范名")
	require.True(t, contains(winKws, "win"), "windows 家族应含兜底 token win")
	// 家族互斥：windows 家族关键字不应含 linux 家族规范名
	require.False(t, contains(winKws, "ubuntu"))
}

func TestOSOptionsAllClassified(t *testing.T) {
	for _, o := range ListOSOptions() {
		assert.True(t, o.Family == OSFamilyLinux || o.Family == OSFamilyWindows,
			"规范名 %q 家族 %q 非法", o.Name, o.Family)
		assert.Equal(t, strings.TrimSpace(o.Name), o.Name, "规范名不应有首尾空格")
	}
}

// --- helpers ---

func familyNames(family string) []string {
	var names []string
	for _, o := range osDict {
		if o.Family == family {
			names = append(names, o.Name)
		}
	}
	return names
}

func contains(kws []string, kw string) bool {
	for _, k := range kws {
		if k == strings.ToLower(kw) {
			return true
		}
	}
	return false
}
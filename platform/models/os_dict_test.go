package models

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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

package models

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestValidateJobName 覆盖「job_name 直接作为 targets 文件名」的校验口径：
// 中文等 Unicode 字符放行，只拦截无法作为文件名的字符。
func TestValidateJobName(t *testing.T) {
	valid := []string{
		"主机监控",
		"服务监控",
		"node-exporter-prod",
		"My.Job_01",
		"123",
		"a-b_c.d",
		".hidden",
	}
	for _, name := range valid {
		assert.NoError(t, ValidateJobName(name), "应允许 %q", name)
	}

	invalid := []struct {
		name string
		want string
	}{
		{"", "不能为空"},
		{" ", "空白"},
		{"my job", "空白"},
		{"host\t1", "空白"},
		{"a/b", "文件名非法字符"},
		{`a\b`, "文件名非法字符"},
		{"a:b", "文件名非法字符"},
		{"a*b", "文件名非法字符"},
		{"a?b", "文件名非法字符"},
		{`a"b`, "文件名非法字符"},
		{"a<b", "文件名非法字符"},
		{"a>b", "文件名非法字符"},
		{"a|b", "文件名非法字符"},
		{"a\x00b", "文件名非法字符"},
		{".", "不能为 . / .."},
		{"..", "不能为 . / .."},
		{"abc.", "不能为 . / .."},
		{"CON", "Windows 保留设备名"},
		{"nul", "Windows 保留设备名"},
		{"COM1", "Windows 保留设备名"},
	}
	for _, tc := range invalid {
		err := ValidateJobName(tc.name)
		assert.Error(t, err, "应拒绝 %q", tc.name)
		if err != nil {
			assert.Contains(t, err.Error(), tc.want, "错误文案应命中 %q", tc.name)
		}
	}
}

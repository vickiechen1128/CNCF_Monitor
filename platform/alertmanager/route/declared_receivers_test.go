package route

import "testing"

// TestParseDeclaredReceivers 覆盖「文件 receivers: 段已声明名」解析：正常段、去重、
// 缺 name、元素非映射等；并对齐 2026-10-08 实测阻断场景（手写 feishu + 平台 notify-1 共存）。
func TestParseDeclaredReceivers(t *testing.T) {
	cases := []struct {
		name string
		yaml string
		want []string
	}{
		{
			name: "手写与平台物化共存（实测场景）",
			yaml: `route:
    receiver: 'feishu'
receivers:
    - name: 'feishu'
      webhook_configs:
        - url: 'http://metricam.example.com:8080/api/v1/webhooks/notify?id=1'
    - name: notify-1
      webhook_configs:
        - url: http://127.0.0.1:8080/api/v1/webhooks/notify?id=1
`,
			want: []string{"feishu", "notify-1"},
		},
		{
			name: "同名重复只保留一次（按首次出现）",
			yaml: `receivers:
    - name: alpha
    - name: alpha
`,
			want: []string{"alpha"},
		},
		{
			name: "缺 name / 空 name 的元素被跳过",
			yaml: `receivers:
    - name: alpha
    - webhook_configs: []
    - name: '   '
`,
			want: []string{"alpha"},
		},
		{
			name: "元素非映射被跳过，不牵连其余条目",
			yaml: `receivers:
    - alpha
    - name: beta
`,
			want: []string{"beta"},
		},
		{
			name: "无 receivers 段 → 空",
			yaml: `route:
    receiver: 'feishu'
`,
			want: []string{},
		},
		{
			name: "receivers 非列表 → 空（吞错降级）",
			yaml: `receivers: oops
`,
			want: []string{},
		},
		{
			name: "YAML 非法 → 空（吞错降级，绝不返回 error）",
			yaml: "receivers: [oops\n",
			want: []string{},
		},
		{
			name: "顶层非映射 → 空",
			yaml: `- a
- b
`,
			want: []string{},
		},
		{
			name: "空输入 → 空",
			yaml: "",
			want: []string{},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ParseDeclaredReceivers(tc.yaml)
			if len(got) != len(tc.want) {
				t.Fatalf("声明名数量 = %v，期望 %v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("声明名[%d] = %q，期望 %q（完整 %v）", i, got[i], tc.want[i], got)
				}
			}
		})
	}
}

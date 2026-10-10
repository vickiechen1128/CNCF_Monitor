package portchain

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestResolveFourLevelPermutations 四级链全排列 7 组（提案 §9 验收：
// 「四级取值全排列 + 0/NULL 等价」；I=instance/M=mapping/T=template/B=business）：
// 4 组单级命中（每级都能独立成为生效来源）+ 3 组优先级压制（高优先级存在时
// 低优先级不得被选中）。逐值断言 port 与 source。
func TestResolveFourLevelPermutations(t *testing.T) {
	tests := []struct {
		name         string
		scrapePort   int
		mappingPort  int
		templatePort int
		businessPort int
		wantPort     int
		wantSource   string
	}{
		// 单级命中 ×4
		{"1_I only 实例覆盖", 19100, 0, 0, 0, 19100, SourceInstance},
		{"2_M only 类型默认", 0, 9100, 0, 0, 9100, SourceMapping},
		{"3_T only 采集器默认", 0, 0, 9104, 0, 9104, SourceTemplate},
		{"4_B only 业务端口兜底", 0, 0, 0, 3306, 3306, SourceBusiness},
		// 优先级压制 ×3
		{"5_I 压制 M/T/B", 19100, 9100, 9104, 3306, 19100, SourceInstance},
		{"6_M 压制 T/B", 0, 9100, 9104, 3306, 9100, SourceMapping},
		{"7_T 压制 B", 0, 0, 9104, 3306, 9104, SourceTemplate},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			port, source := Resolve(tt.scrapePort, tt.mappingPort, tt.templatePort, tt.businessPort)
			require.Equal(t, tt.wantPort, port, "生效端口")
			require.Equal(t, tt.wantSource, source, "来源枚举")
		})
	}
}

// TestResolveAllZeroUnresolved 全 0（含 0/NULL 归一后的零值）→ unresolved 失败态：
// 返回 0 且来源为 unresolved，调用方按裸 IP 语义（instanceAddress port=0）拼地址、
// 前端展示 `-`，**不展示 0**（提案 §9 失败态口径）。
func TestResolveAllZeroUnresolved(t *testing.T) {
	port, source := Resolve(0, 0, 0, 0)
	assert.Equal(t, 0, port)
	assert.Equal(t, SourceUnresolved, source)
}

// TestResolveZeroTierFallsThrough 0 档（每级）一律视为未指定向下回落——
// 0 与 NULL 归一后同为零值，不存在「填 0 被当有效端口」的歧义（§5.1 取值口径）。
// 也覆盖「较高优先级显式为 0 时不得拦截后续级」的边界。
func TestResolveZeroTierFallsThrough(t *testing.T) {
	// I=0 → 落 M；T 位也为 0 → 继续落 B
	port, source := Resolve(0, 9100, 0, 3306)
	assert.Equal(t, 9100, port)
	assert.Equal(t, SourceMapping, source)

	// I=0、M=0、T=0 → 落 B（db/mw 四级末端）
	port, source = Resolve(0, 0, 0, 6379)
	assert.Equal(t, 6379, port)
	assert.Equal(t, SourceBusiness, source)

	// 负值不作为有效端口（校验层拦截非法值，此处按非正=未指定归一，不误选）
	port, source = Resolve(0, -1, 9104, 3306)
	assert.Equal(t, 9104, port)
	assert.Equal(t, SourceTemplate, source)
}

// TestResolveHostNoBusinessTier host 无业务 port 概念（到模板层为止）：由调用方
// 不传 businessPort 表达——Resolve 的第 4 参恒 0，即使存在可解析层级也只到 T 为止，
// 永不产生 SourceBusiness（拍板 Q1 硬约束，T01-P4 补 generator host 分支同语义用例）。
func TestResolveHostNoBusinessTier(t *testing.T) {
	// host：scrape_port 留空 + 映射/模板均缺 → unresolved（裸 IP，无 B 级兜底）
	port, source := Resolve(0, 0, 0, 0)
	assert.Equal(t, 0, port)
	assert.Equal(t, SourceUnresolved, source)

	// host：scrape_port 留空，仅策略层有值 → 模板层封顶（source 不会是 business）
	port, source = Resolve(0, 0, 9100, 0)
	assert.Equal(t, 9100, port)
	assert.Equal(t, SourceTemplate, source)
}

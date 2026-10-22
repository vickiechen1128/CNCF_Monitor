// declared_receivers.go 提供「alertmanager.yml receivers: 段已声明的接收人名」解析。
//
// 为什么需要（2026-10-08 用户实测阻断缺陷）：
//
// 前端保存前的「接收人悬空」预检此前把 knownReceivers 只取「平台物化的渠道接收人名」
// （全部 NotifyChannel.ReceiverName() 集合），于是**用户手写在 receivers: 段里的
// receiver 会被误判为「未定义」**。实测：生效配置中 receivers 段同时声明了手写的
// `feishu`（指向用户自建通知脚本地址）与平台物化的 `notify-1`，而根路由 + 4 条子路由
// 全部引用 `feishu` → 5 个节点全部命中 `receiver_dangling`，页面进入「不能新建也不能保存」
// 的死锁（既阻断保存，又因按钮依赖编辑态而无法通过新建绕开）。
//
// 口径对齐（关键）：真正的「可达 receiver 集合」是两部分的并集——
//   - 文件 `receivers:` 段已声明的名字（用户手写，平台无权判其悬空）；
//   - 本次平台将物化的名字（NotifyChannel.ReceiverName()，桥地址已配时才写出）。
// 本文件补齐前半部分，使 GET /routes 能把「文件已声明名」一并交给前端，
// 前端 knownReceivers = 本字段 ∪ 平台物化名。
//
// 非敏感：只回显 receiver **名**（AM 里本就公开的标识符），绝不含 webhook URL / 桥令牌
// （脱敏口径另见 maskReceiverURL）。故本字段与 GET /routes 的「仅全局认证」鉴权级别相符，
// 不构成新的信息暴露面。
package route

import (
	"strings"

	"gopkg.in/yaml.v3"
)

// ParseDeclaredReceivers 解析 alertmanager.yml 原文 `receivers:` 段中已声明的接收人名
// （按声明顺序、去重、保持稳定）。
//
// 容错口径（**刻意不返回 error**）：
//   - 空内容 / YAML 非法 / 顶层非映射 / 无 receivers 段 / receivers 非列表 / 元素非映射
//     → 返回空切片。这些都属于「取不到可达集合」的降级情形，由调用方决定是否阻断；
//     预检侧对空集合应降级为「不校验」（与既有 knownReceivers 为空即不判悬空同口径）。
//   - 单个元素缺 name / name 为空 → 跳过该条，不影响其余条目。
//
// 与 ParseRouteTree 的差异：路由树解析失败要降级为「原文只读展示」，而本函数失败只丢一个
// 辅助字段、不影响主流程，故一律吞错返回空切片，绝不牵连 ListRoutes 的 200 响应。
func ParseDeclaredReceivers(baseYAML string) []string {
	out := []string{}
	if strings.TrimSpace(baseYAML) == "" {
		return out
	}
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(baseYAML), &doc); err != nil {
		return out
	}
	if doc.Kind != yaml.DocumentNode || len(doc.Content) == 0 {
		return out
	}
	root := deref(doc.Content[0])
	if root == nil || root.Kind != yaml.MappingNode {
		return out
	}
	seq := mappingValue(root, "receivers")
	if seq == nil || seq.Kind != yaml.SequenceNode {
		return out
	}
	seen := make(map[string]bool, len(seq.Content))
	for _, item := range seq.Content {
		item = deref(item)
		if item == nil || item.Kind != yaml.MappingNode {
			continue
		}
		name := strings.TrimSpace(scalarValue(mappingValue(item, "name")))
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, name)
	}
	return out
}

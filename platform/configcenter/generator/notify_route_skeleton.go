package generator

import (
	"fmt"

	"gopkg.in/yaml.v3"
)

// 本文件实现 M08「最小运行骨架自动布缆」（决策 113，口径 C）的生成器侧纯函数：
// 在用户显式开关（= 选定默认接收人）下，只原地替换 alertmanager.yml **根 route.receiver
// 这一个标量键**，把根兜底指向平台默认接收人，使新建渠道「开箱即响」。
//
// 决策 113 第 4 条红线（不可越）：
//   - 绝不触碰根 route 的 group_by / group_wait / group_interval / repeat_interval / continue；
//   - 绝不写入或修改 route.routes[]；
//   - 绝不为根 route 增删 matchers；
//   - 绝不新增/删除根 route 的其它键（本函数只改已存在的 receiver 标量值）。
//
// 异常一律降级为「跳过 + 诊断」，不返回 error（不得让挂载路径因骨架而失败）；唯一返回
// error 的是序列化失败这一不可预期场景，由调用方（draft.materializeRootRouteReceiver）
// 再降级为跳过。
//
// YAML 处理沿用同目录既有实现（notify_receivers.go）的 yaml.Node 往返范式：保注释、保手写
// 节点顺序与样式、保幂等（连跑两次输出字节一致）。

// RootRouteInput 是根兜底物化的入参。
type RootRouteInput struct {
	// Enabled 是接管开关（= 用户已选定默认接收人并授权平台接管根兜底）。
	// false 时不物化：原样返回输入（字节级不变、零副作用）。
	Enabled bool
	// DefaultReceiver 是平台默认接收人的 AM receiver 名（NotifyChannel.ReceiverName()，
	// 与 MaterializeNotifyReceivers 物化的平台槽位名同源）。为空时不物化（不写悬空值）。
	DefaultReceiver string
	// PlatformReceiverNames 是本次物化（MaterializeNotifyReceivers）平台生成的 receiver 名
	// 集合。与文件中既有 receivers 名并集构成「可达 receiver 集合」，用于阻断 dangling
	// receiver（目标不在集合内 → 跳过 + 诊断，避免 amtool 校验整单 failed）。
	PlatformReceiverNames []string
}

// 根兜底物化的跳过归因码。全部为「跳过 + 诊断」，不构成 error。
const (
	// RootRouteSkipInvalidYAML YAML 非法（无法解析为节点树）。
	RootRouteSkipInvalidYAML = "skipped_invalid_yaml"
	// RootRouteSkipMalformedDocument 顶层不是映射（不是合法的 alertmanager 配置形态）。
	RootRouteSkipMalformedDocument = "skipped_malformed_document"
	// RootRouteSkipNoRoute 文件无 route 节点。
	RootRouteSkipNoRoute = "skipped_no_route"
	// RootRouteSkipRouteNotMapping route 节点不是映射。
	RootRouteSkipRouteNotMapping = "skipped_route_not_mapping"
	// RootRouteSkipNoRootReceiver 根 route 无 receiver 标量键（AM 语义下非法配置，不代为新增）。
	RootRouteSkipNoRootReceiver = "skipped_no_root_receiver"
	// RootRouteSkipUnknownReceiver 目标 receiver 不在可达集合（文件 receivers ∪ 本次平台物化名）内。
	RootRouteSkipUnknownReceiver = "skipped_unknown_receiver"
	// RootRouteSkipMarshalFailed 序列化失败（唯一返回 error 的场景，调用方再降级为跳过）。
	RootRouteSkipMarshalFailed = "skipped_marshal_failed"
	// RootRouteSkipLoadSettingFailed 读取管理域单例设定失败（draft 侧降级归因）。
	RootRouteSkipLoadSettingFailed = "skipped_load_setting_failed"
	// RootRouteSkipLoadChannelsFailed 读取已启用通知渠道失败（draft 侧降级归因）。
	RootRouteSkipLoadChannelsFailed = "skipped_load_channels_failed"
)

// RootRouteDiagnostic 是根兜底物化的跳过 / 异常归因（非产物内容，不参与 Checksum）。
type RootRouteDiagnostic struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// MaterializeRootRouteReceiver 把 alertmanager.yml 根 route.receiver 原地替换为平台默认
// 接收人（决策 113，口径 C）。
//
//   - in.Enabled=false 或 in.DefaultReceiver 为空 → 原样返回 baseYAML（字节级不变）；
//   - 解析 / 结构异常（YAML 非法、无 route、route 非映射、根 route 无 receiver 标量）→
//     返回 baseYAML + 诊断，**不返回 error**；
//   - 目标 receiver 不在可达集合（文件 receivers ∪ PlatformReceiverNames）→ 返回 baseYAML +
//     诊断（阻断 dangling receiver）；
//   - 仅原地替换该标量值，其余节点逐字保留（注释、顺序、样式不变）；值已等于目标时原样返回
//     （幂等，连跑两次输出字节一致）。
func MaterializeRootRouteReceiver(baseYAML string, in RootRouteInput) (string, []RootRouteDiagnostic, error) {
	if !in.Enabled || in.DefaultReceiver == "" {
		return baseYAML, nil, nil
	}

	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(baseYAML), &doc); err != nil {
		return baseYAML, []RootRouteDiagnostic{{
			Code:    RootRouteSkipInvalidYAML,
			Message: fmt.Sprintf("alertmanager.yml 解析失败，跳过根兜底物化: %v", err),
		}}, nil
	}
	if doc.Kind != yaml.DocumentNode || len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		return baseYAML, []RootRouteDiagnostic{{
			Code:    RootRouteSkipMalformedDocument,
			Message: "alertmanager.yml 顶层不是映射，跳过根兜底物化",
		}}, nil
	}
	root := doc.Content[0]

	ri := mappingValueIndex(root, "route")
	if ri < 0 {
		return baseYAML, []RootRouteDiagnostic{{
			Code:    RootRouteSkipNoRoute,
			Message: "alertmanager.yml 无 route 节点，跳过根兜底物化",
		}}, nil
	}
	route := root.Content[ri]
	if route.Kind != yaml.MappingNode {
		return baseYAML, []RootRouteDiagnostic{{
			Code:    RootRouteSkipRouteNotMapping,
			Message: "alertmanager.yml 的 route 段不是映射，跳过根兜底物化",
		}}, nil
	}

	vi := mappingValueIndex(route, "receiver")
	if vi < 0 || route.Content[vi].Kind != yaml.ScalarNode {
		return baseYAML, []RootRouteDiagnostic{{
			Code:    RootRouteSkipNoRootReceiver,
			Message: "根 route 无 receiver 标量值，跳过根兜底物化（不代为新增键）",
		}}, nil
	}

	if !knownReceiverNames(root, in.PlatformReceiverNames)[in.DefaultReceiver] {
		return baseYAML, []RootRouteDiagnostic{{
			Code: RootRouteSkipUnknownReceiver,
			Message: fmt.Sprintf(
				"目标 receiver %q 不在文件 receivers（含本次平台物化名）内，跳过根兜底物化以避免悬空引用",
				in.DefaultReceiver),
		}}, nil
	}

	target := route.Content[vi]
	if target.Value == in.DefaultReceiver {
		// 已指向目标值：原样返回（幂等，checksum 可复现）。
		return baseYAML, nil, nil
	}
	target.Value = in.DefaultReceiver

	out, err := yaml.Marshal(&doc)
	if err != nil {
		return baseYAML, []RootRouteDiagnostic{{
			Code:    RootRouteSkipMarshalFailed,
			Message: fmt.Sprintf("物化根兜底后序列化失败: %v", err),
		}}, fmt.Errorf("marshal root-route materialized alertmanager.yml: %w", err)
	}
	return string(out), nil, nil
}

// knownReceiverNames 汇总「可达 receiver 名」集合：文件中既有 receivers 段的名字
// （root.receivers[].name）∪ 本次平台物化将生成的 receiver 名（platformNames）。
// 目标接收人必须落在该集合内，否则会引入 dangling receiver（amtool 校验整单 failed）。
func knownReceiverNames(root *yaml.Node, platformNames []string) map[string]bool {
	known := make(map[string]bool, len(platformNames))
	for _, n := range platformNames {
		known[n] = true
	}
	idx := mappingValueIndex(root, "receivers")
	if idx < 0 || root.Content[idx].Kind != yaml.SequenceNode {
		return known
	}
	for _, item := range root.Content[idx].Content {
		if item.Kind != yaml.MappingNode {
			continue
		}
		if ni := mappingValueIndex(item, "name"); ni >= 0 {
			known[item.Content[ni].Value] = true
		}
	}
	return known
}
// 本文件是 alertmanager.yml 的**唯一生成规则**。
//
// 2026-10-23 用户裁决：告警配置的唯一作者是平台（路由树 + 通知渠道）。任何需要
// 重新生成 alertmanager.yml 的链路（路由保存、M09 草稿生成 / 重校、未来接入的
// 告警抑制）都必须走 BuildAlertmanagerConfig，禁止在各处写「合并进旧文件 / 保留
// 某些段 / 逐项归一化」的适配逻辑：
//
//	global:
//	  resolve_timeout: 5m
//	route:
//	  <路由段>
//	receivers:
//	  - name: default               # 内置空接收人（不通知）
//	  - name: notify-<id>           # 仅 route 引用的渠道，按渠道 ID 升序
//
// 未来告警抑制能力接入时，在此规则的输入/输出上增加 inhibit_rules 生成即可，
// 所有调用方自动获得该能力，不另开旁路。
package generator

import (
	"bytes"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
	"gopkg.in/yaml.v3"
)

// DefaultReceiverName 是平台内置的空接收人（兜底占位）名。
//
// Alertmanager 要求根 route 必须指定 receiver（`root route must specify a default receiver`），
// 但接收人本身可以不挂任何通知配置——命中它的告警会被静默丢弃。平台把它作为「默认（不通知）」
// 选项提供给路由树，使新环境在尚未配置任何通知渠道时也能保存一份合法配置。
const DefaultReceiverName = "default"

// alertmanagerGlobalResolveTimeout 是生成规则中固定的 global.resolve_timeout。
// 与 deploy/alertmanager/alertmanager.yml 的 seed 口径一致；平台不接 SMTP /
// 全局 HTTP 客户端配置，global 段只需这一个字段。
const alertmanagerGlobalResolveTimeout = "5m"

// bridgeEndpointPath 是通知渲染桥端点路径（M08 PL-3）。口径必须与
// platform/alertmanager/notify/bridge.go 的 RegisterBridgeRoutes（/api/v1/webhooks/notify）
// 严格一致；变更时两处同步。
const bridgeEndpointPath = "/api/v1/webhooks/notify"

// NotifyBridgeURL 是平台通知入口（渲染桥）的基础地址，由 cmd/metric-center 在启动时
// 从监听地址 / NOTIFY_BRIDGE_URL 注入（形如 http://127.0.0.1:8080，不含路径）。
//
// 它属于生成器的运行时配置，不是调用方参数：保存路由与 M09 生成使用同一个值，
// 因此两边产出完全一致的 receiver 地址，不再有「保存占位、下发补全」的两段形态。
// 为空时不写 webhook 地址（仅测试 / 未配置场景）。
var NotifyBridgeURL string

// AlertmanagerConfigInput 是唯一生成规则的输入。
type AlertmanagerConfigInput struct {
	// RouteSection 是含顶层 `route:` 键的 YAML 段：
	//   - 路由保存：由 GenerateRouteSection(编辑态路由树) 生成；
	//   - M09 生成 / 重校：由 ExtractRouteSection(存量 alertmanager.yml) 提取。
	RouteSection string
	// Channels 是平台全部通知渠道；只有被 route 段引用到的渠道才会生成 receiver。
	Channels []models.NotifyChannel
}

// BuildAlertmanagerConfig 按唯一生成规则整份重建 alertmanager.yml。
//
// 旧文件中的手写 receivers / global / inhibit_rules / templates / mute_time_intervals
// 等段落不再保留（手写能力已下线，用户 2026-10-23 裁决）。receivers 恒为
// 「default + route 引用的渠道」，旧 receiver 一律丢弃，不做重名冲突判定。
//
// route 段生成失败（空段 / 畸形树 / 多根 / 环等）返回 error，由调用方转为校验错误，
// 绝不产出半份配置。
func BuildAlertmanagerConfig(in AlertmanagerConfigInput) (string, error) {
	routeNode, err := routeNodeFromSection(in.RouteSection)
	if err != nil {
		return "", err
	}
	referenced, err := CollectRouteReceiverNames(in.RouteSection)
	if err != nil {
		return "", err
	}

	receivers := &yaml.Node{Kind: yaml.SequenceNode, Tag: "!!seq"}
	receivers.Content = append(receivers.Content, defaultReceiverNode())
	for _, ch := range activeNotifyChannels(in.Channels, referenced) {
		name := ch.ReceiverName()
		if strings.TrimSpace(NotifyBridgeURL) == "" {
			receivers.Content = append(receivers.Content, receiverNameNode(name))
			continue
		}
		node, err := platformReceiverNode(name, bridgeReceiverURL(NotifyBridgeURL, ch))
		if err != nil {
			return "", err
		}
		receivers.Content = append(receivers.Content, node)
	}

	global := &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map", Content: []*yaml.Node{
		{Kind: yaml.ScalarNode, Tag: "!!str", Value: "resolve_timeout"},
		{Kind: yaml.ScalarNode, Tag: "!!str", Value: alertmanagerGlobalResolveTimeout},
	}}
	root := &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
	appendMapping(root, "global", global)
	appendMapping(root, routeSectionKey, routeNode)
	appendMapping(root, "receivers", receivers)

	doc := &yaml.Node{Kind: yaml.DocumentNode, Content: []*yaml.Node{root}}
	out, err := encodeDocument(doc)
	if err != nil {
		return "", fmt.Errorf("序列化 alertmanager.yml 失败: %w", err)
	}
	return out, nil
}

// ExtractRouteSection 从存量 alertmanager.yml 中提取 route 段（含顶层 `route:` 键），
// 供 M09 生成 / 重校把存量配置重新送进唯一生成规则。仅提取 route 节点本身，其余段丢弃。
func ExtractRouteSection(baseYAML string) (string, error) {
	if strings.TrimSpace(baseYAML) == "" {
		return "", errors.New("alertmanager.yml 为空，无法提取 route 段")
	}
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(baseYAML), &doc); err != nil {
		return "", fmt.Errorf("解析 alertmanager.yml 失败: %w", err)
	}
	if doc.Kind != yaml.DocumentNode || len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		return "", errors.New("alertmanager.yml 顶层不是映射，无法提取 route 段")
	}
	root := doc.Content[0]
	vi := mappingValueIndex(root, routeSectionKey)
	if vi < 0 || root.Content[vi].Kind != yaml.MappingNode {
		return "", errors.New("alertmanager.yml 缺少 route 映射节点，无法重建")
	}
	return encodeDocument(&yaml.Node{
		Kind: yaml.DocumentNode,
		Content: []*yaml.Node{{
			Kind: yaml.MappingNode,
			Content: []*yaml.Node{
				{Kind: yaml.ScalarNode, Tag: "!!str", Value: routeSectionKey},
				root.Content[vi],
			},
		}},
	})
}

// routeNodeFromSection 从 route 段 YAML 中取出 route 映射节点
// （保留节点上的路由名称注释与子结构）。
func routeNodeFromSection(routeSection string) (*yaml.Node, error) {
	if strings.TrimSpace(routeSection) == "" {
		return nil, errors.New("route 段为空，无法生成 alertmanager.yml")
	}
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(routeSection), &doc); err != nil {
		return nil, fmt.Errorf("解析 route 段失败: %w", err)
	}
	if doc.Kind != yaml.DocumentNode || len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		return nil, errors.New("route 段顶层不是映射")
	}
	vi := mappingValueIndex(doc.Content[0], routeSectionKey)
	if vi < 0 || doc.Content[0].Content[vi].Kind != yaml.MappingNode {
		return nil, errors.New("route 段缺少 route 映射节点")
	}
	return doc.Content[0].Content[vi], nil
}

// activeNotifyChannels 返回被 route 段引用到的渠道（按渠道 ID 升序，保证产物稳定）。
func activeNotifyChannels(channels []models.NotifyChannel, referenced map[string]struct{}) []models.NotifyChannel {
	active := make([]models.NotifyChannel, 0, len(channels))
	for _, ch := range channels {
		if _, ok := referenced[ch.ReceiverName()]; ok {
			active = append(active, ch)
		}
	}
	sort.Slice(active, func(i, j int) bool { return active[i].ID < active[j].ID })
	return active
}

// bridgeReceiverURL 拼平台 receiver 的桥地址：只带 id 参数（真实渠道 ID），
// 模板绑定不写进 URL，由桥在投递时按 channel ID 实时解析。
func bridgeReceiverURL(base string, ch models.NotifyChannel) string {
	return strings.TrimRight(base, "/") + bridgeEndpointPath +
		"?id=" + strconv.FormatUint(uint64(ch.ID), 10)
}

// platformReceiverNode 构造单个平台 receiver 的 yaml.Node。receiver 名恒为 notify-<id>。
func platformReceiverNode(name, url string) (*yaml.Node, error) {
	raw, err := yaml.Marshal(genReceiver{
		Name:           name,
		WebhookConfigs: []genWebhookConfig{{URL: url, SendResolved: true}},
	})
	if err != nil {
		return nil, fmt.Errorf("marshal generated receiver %q: %w", name, err)
	}
	var n yaml.Node
	if err := yaml.Unmarshal(raw, &n); err != nil {
		return nil, fmt.Errorf("build generated receiver node %q: %w", name, err)
	}
	if n.Kind != yaml.DocumentNode || len(n.Content) == 0 {
		return nil, fmt.Errorf("build generated receiver node %q: 非法节点", name)
	}
	return n.Content[0], nil
}

// genWebhookConfig / genReceiver 是平台 receiver 的 YAML 结构（仅本文件使用）。
type genWebhookConfig struct {
	URL          string `yaml:"url"`
	SendResolved bool   `yaml:"send_resolved"`
}

type genReceiver struct {
	Name           string             `yaml:"name"`
	WebhookConfigs []genWebhookConfig `yaml:"webhook_configs"`
}

// receiverNameNode 构造只有 name 的空 receiver 占位节点（保存期 amtool 校验用）。
func receiverNameNode(name string) *yaml.Node {
	item := &yaml.Node{Kind: yaml.MappingNode}
	appendMapping(item, "name", &yaml.Node{Kind: yaml.ScalarNode, Value: name})
	return item
}

// defaultReceiverNode 构造空接收人节点：只有 name，不挂任何通知配置。
func defaultReceiverNode() *yaml.Node {
	return receiverNameNode(DefaultReceiverName)
}

// mappingValueIndex 返回映射节点中键 key 对应的值节点下标（无则 -1）。
func mappingValueIndex(m *yaml.Node, key string) int {
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			return i + 1
		}
	}
	return -1
}

// encodeDocument 以 2 空格缩进序列化 YAML 文档并返回错误（生成规则必须显式失败，
// 不能返回半份/原文）。2 空格与 alertmanager.yml 惯例一致。
func encodeDocument(doc *yaml.Node) (string, error) {
	var buf bytes.Buffer
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2)
	if err := enc.Encode(doc); err != nil {
		return "", err
	}
	if err := enc.Close(); err != nil {
		return "", err
	}
	return buf.String(), nil
}

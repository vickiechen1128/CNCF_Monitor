package generator

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
	"gopkg.in/yaml.v3"
)

// bridgeEndpointPath 是通知渲染桥端点路径（M08 PL-3）。口径必须与
// platform/alertmanager/notify/bridge.go 的 RegisterBridgeRoutes（/api/v1/webhooks/notify）
// 及 receiver_snippet.go buildBridgeURL 严格一致；变更时三处同步。
const bridgeEndpointPath = "/api/v1/webhooks/notify"

// NotifyReceiverInput 是 M09 物化平台通知 receivers 所需的运行配置与源数据
// （决策 74 定稿第 1/6 条）。
type NotifyReceiverInput struct {
	// BridgeURL 是通知渲染桥基础地址（形如 http://127.0.0.1:8080，不含路径）。
	// 为空时不物化（不写出悬空/相对 URL）。
	BridgeURL string
	// BridgeToken 是桥内网调用令牌；写入 receiver 的 http_config.authorization.credentials
	// （H-1：令牌走请求头，不落 URL query）。为空时不写 http_config（缺失鉴权由桥端 401 +
	// 启动 WARN 暴露，绝不伪造占位令牌进入真实下发配置）。
	BridgeToken string
	// Channels 是平台已启用的通知渠道（enabled=true），每个生成一个 receiver。
	Channels []models.NotifyChannel
}

// NotifyReceiverConflict 是平台生成 receiver 名与用户手写 / 平台内其他 receiver 名冲突的
// 归因（决策 74 定稿第 1 条：重名即草稿校验失败，绝不静默覆盖或合并）。
type NotifyReceiverConflict struct {
	// Name 是冲突的 receiver 名。
	Name string
	// Line 是用户手写 receiver 所在行号（1-based；0 = 平台内部重名或未知行号）。
	Line int
}

// ---- 平台物化 receiver 的 YAML 结构（仅本文件的生成/解析用） ----

type genHTTPConfig struct {
	Authorization *genAuthorization `yaml:"authorization,omitempty"`
}

type genAuthorization struct {
	Type        string `yaml:"type"`
	Credentials string `yaml:"credentials"`
}

type genWebhookConfig struct {
	URL          string         `yaml:"url"`
	SendResolved bool           `yaml:"send_resolved"`
	HTTPConfig   *genHTTPConfig `yaml:"http_config,omitempty"`
}

type genReceiver struct {
	Name           string             `yaml:"name"`
	WebhookConfigs []genWebhookConfig `yaml:"webhook_configs"`
}

// MaterializeNotifyReceivers 把平台已启用渠道物化为 alertmanager.yml 的 receivers，与用户
// 手写 receivers 合并（决策 74 定稿第 1/2/3 条）：
//   - 每个 enabled 渠道生成一个 receiver：`url` = 桥地址 + `?channel=<真实数字 ID>`，
//     `http_config.authorization` = `Bearer <令牌>`（H-1：令牌走请求头，不落 URL query）；
//   - 用户手写 receivers 原样保留（baseYAML 其余内容透传，不解析其它段语义）；
//   - 平台生成名与手写名（或平台内部两名）冲突 → **不写入任何平台 receiver**、返回冲突归因，
//     由校验层（ValidateArtifacts）转为行级错误阻塞确认，绝不静默覆盖或半合并。
//
// baseYAML 为空（无告警配置）或 BridgeURL 为空（桥未配置）时直接返回原文与 nil
// （不生成空产物 / 悬空 URL，决策 60 口径不变）。
func MaterializeNotifyReceivers(baseYAML string, in NotifyReceiverInput) (string, []NotifyReceiverConflict, error) {
	if strings.TrimSpace(baseYAML) == "" || in.BridgeURL == "" || len(in.Channels) == 0 {
		return baseYAML, nil, nil
	}

	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(baseYAML), &doc); err != nil {
		return "", nil, fmt.Errorf("parse alertmanager.yml for notify receivers: %w", err)
	}
	if doc.Kind != yaml.DocumentNode || len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		return "", nil, fmt.Errorf("alertmanager.yml 顶层不是映射，无法物化通知 receivers")
	}
	root := doc.Content[0]

	var recvSeq *yaml.Node
	// existing: receiver 名 → {行号, 首个 webhook url, 节点}。节点用于地址演进原地更新；
	// 判据已改为「receiver 名 ∈ 平台命名空间」（见下方循环），url 仅作幂等/地址演进辅助识别，
	// 不再作为平台产物的唯一身份依据（避免桥地址变化把自身产物误读为手写重名，F-36/L2）。
	existing := map[string]existingReceiver{}
	if idx := mappingValueIndex(root, "receivers"); idx >= 0 {
		recvSeq = root.Content[idx]
		if recvSeq.Kind != yaml.SequenceNode {
			return "", nil, fmt.Errorf("alertmanager.yml 的 receivers 段不是列表，无法物化通知 receivers")
		}
		for _, item := range recvSeq.Content {
			if item.Kind != yaml.MappingNode {
				continue
			}
			ni := mappingValueIndex(item, "name")
			if ni < 0 {
				continue
			}
			existing[item.Content[ni].Value] = existingReceiver{
				line: item.Line,
				url:  firstWebhookURL(item),
				node: item,
			}
		}
	} else {
		recvSeq = &yaml.Node{Kind: yaml.SequenceNode, Tag: "!!seq"}
		root.Content = append(root.Content,
			&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: "receivers"},
			recvSeq,
		)
	}

	// 平台命名空间集合：本次物化将生成的全部平台 receiver 名（= 各已启用渠道的
	// ch.ReceiverName()）。L2 以「receiver 名 ∈ 此集合」判定是否为平台槽位，不再依赖
	// 「名称 + 桥 URL 全等」（决策 74 定稿补充）。
	platformNames := make(map[string]bool, len(in.Channels))
	for _, ch := range in.Channels {
		platformNames[ch.ReceiverName()] = true
	}

	// 冲突检测 + 平台 receiver 地址演进识别（L2，决策 74 定稿补充）：
	//   以「receiver 名 ∈ 平台命名空间（本次物化将生成的平台名集合）」判定是否为平台槽位，
	//   不再依赖「名称 + 桥 URL 全等」。
	//   - 已物化（url 相同）：跳过（幂等）；
	//   - 同名且 URL 属平台桥地址形态（url 不同）：平台自身产物地址演进 → 收集原地更新，
	//     不报冲突（不再把桥地址变化误读为「与手写 receiver 重名」）；
	//   - 同名但 URL 非平台桥地址形态（确系用户手写、指向别处）：真重名 → 冲突
	//     （failed + user_config + 行级错误，决策 74「绝不静默覆盖/合并」语义不变）；
	//   - 平台内部两条渠道 sanitize 同名（name 不在既有 receivers 中）：冲突
	//     （AM 拒绝重复 receiver 名）。
	// 任一真重名冲突即整体不写入（避免半合并）；地址演进原地更新也只在无冲突时才落盘。
	var conflicts []NotifyReceiverConflict
	seen := map[string]bool{}
	type platformUpdate struct {
		node             *yaml.Node
		name, url, token string
	}
	var updates []platformUpdate
	for _, ch := range in.Channels {
		name := ch.ReceiverName()
		url := bridgeReceiverURL(in.BridgeURL, ch.ID)
		ex, ok := existing[name]
		if !ok {
			if seen[name] {
				conflicts = append(conflicts, NotifyReceiverConflict{Name: name})
			} else {
				seen[name] = true
			}
			continue
		}
		// name ∈ 平台命名空间（平台槽位）
		if ex.url == url {
			continue // 已物化：幂等跳过
		}
		if isPlatformBridgeURL(ex.url) {
			// 平台自身产物地址演进 → 原地更新，不冲突
			updates = append(updates, platformUpdate{node: ex.node, name: name, url: url, token: in.BridgeToken})
			continue
		}
		// 同名但 URL 非平台桥地址形态 → 确系用户手写 squat → 真重名冲突
		conflicts = append(conflicts, NotifyReceiverConflict{Name: name, Line: ex.line})
	}
	if len(conflicts) > 0 {
		return baseYAML, conflicts, nil
	}
	// 原地更新平台 receiver 地址演进（无真重名冲突时才落盘，避免半合并）
	for _, u := range updates {
		replacement, err := platformReceiverNode(u.name, u.url, u.token)
		if err != nil {
			return "", nil, err
		}
		*u.node = *replacement
	}

	// 追加尚未物化的平台 receiver（已物化的平台槽位已跳过或原地更新，不再重复追加）。
	for _, ch := range in.Channels {
		name := ch.ReceiverName()
		if _, inDraft := existing[name]; inDraft {
			continue // 已存在（幂等跳过或原地更新），不重复追加
		}
		if !platformNames[name] {
			continue // 非平台槽位（不应发生：name 由渠道 ReceiverName 得出）
		}
		url := bridgeReceiverURL(in.BridgeURL, ch.ID)
		node, err := platformReceiverNode(name, url, in.BridgeToken)
		if err != nil {
			return "", nil, err
		}
		recvSeq.Content = append(recvSeq.Content, node)
	}

	out, err := yaml.Marshal(&doc)
	if err != nil {
		return "", nil, fmt.Errorf("marshal materialized alertmanager.yml: %w", err)
	}
	return string(out), nil, nil
}

// bridgeReceiverURL 拼平台物化 receiver 的桥地址：只带 channel 参数（真实数字 ID），
// 令牌不经 query 传递（H-1）。口径与 notify/receiver_snippet.go buildBridgeURL 一致。
func bridgeReceiverURL(base string, channelID uint) string {
	return strings.TrimRight(base, "/") + bridgeEndpointPath +
		"?channel=" + strconv.FormatUint(uint64(channelID), 10)
}

// platformReceiverNode 构造单个平台 receiver 的 yaml.Node（含 http_config.authorization，
// 令牌非空时）。receiver 名已由 models.ReceiverName sanitize 为安全字符集。
func platformReceiverNode(name, url, token string) (*yaml.Node, error) {
	rcv := genReceiver{
		Name:           name,
		WebhookConfigs: []genWebhookConfig{{URL: url, SendResolved: true}},
	}
	if token != "" {
		rcv.WebhookConfigs[0].HTTPConfig = &genHTTPConfig{
			Authorization: &genAuthorization{Type: "Bearer", Credentials: token},
		}
	}
	raw, err := yaml.Marshal(rcv)
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

// mappingValueIndex 返回映射节点中键 key 对应的值节点下标（无则 -1）。
func mappingValueIndex(m *yaml.Node, key string) int {
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			return i + 1
		}
	}
	return -1
}

// existingReceiver 是已存在 receiver 的轻量视图（幂等识别与冲突定位用）。
type existingReceiver struct {
	line int        // receiver 名所在行号（1-based）
	url  string     // 首个 webhook_configs[].url（无则空）
	node *yaml.Node // receiver 映射节点（地址演进原地更新用）
}

// firstWebhookURL 取 receiver 映射中 webhook_configs 列表首个 url（无则空）。
func firstWebhookURL(recv *yaml.Node) string {
	wi := mappingValueIndex(recv, "webhook_configs")
	if wi < 0 || recv.Content[wi].Kind != yaml.SequenceNode {
		return ""
	}
	for _, wc := range recv.Content[wi].Content {
		if wc.Kind != yaml.MappingNode {
			continue
		}
		if ui := mappingValueIndex(wc, "url"); ui >= 0 {
			return wc.Content[ui].Value
		}
	}
	return ""
}

// isPlatformBridgeURL 判定 url 是否属平台通知桥地址形态：路径恒为 bridgeEndpointPath
// （/api/v1/webhooks/notify）。用于 L2 识别「同名 receiver 是否平台自身产物」——桥地址演进时
// 即便 host/端口变化，路径形态不变，仍视为平台产物（原地更新而非误报重名）；用户手写指向
// 别处的 receiver 路径不同，按真重名处理（决策 74 定稿补充）。
func isPlatformBridgeURL(u string) bool {
	parsed, err := url.Parse(u)
	if err != nil {
		return false
	}
	return parsed.Path == bridgeEndpointPath
}

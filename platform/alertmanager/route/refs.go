package route

import (
	"fmt"
	"strings"

	"gorm.io/gorm"
)

// ReferencedReceiverNames 返回当前生效 / 待确认路由树中每个 receiver 被哪些路由节点引用
// （receiver 名 → 路由展示名列表）。用于通知渠道删除前的引用保护：
// 渠道的 receiver 名恒为 notify-<id>，只要仍被路由引用，删除就会让下一次生成的
// alertmanager.yml 出现悬空 receiver。
//
// 数据源与 GET /routes 同源（effectiveAlertmanagerYAML：最新 pending 草稿优先，
// 其次最近确认版本，最后回落挂载留痕），因此 pending 中的引用同样会阻止删除。
// 路由名为空时回退节点 ID（如 root/0），保证提示可定位。
func ReferencedReceiverNames(db *gorm.DB) (map[string][]string, error) {
	yamlText, err := effectiveAlertmanagerYAML(db)
	if err != nil {
		return nil, fmt.Errorf("load effective alertmanager config: %w", err)
	}
	if strings.TrimSpace(yamlText) == "" {
		return map[string][]string{}, nil
	}
	nodes, err := ParseRouteTree(yamlText)
	if err != nil {
		return nil, fmt.Errorf("parse route tree for receiver references: %w", err)
	}
	out := make(map[string][]string)
	for i := range nodes {
		if nodes[i].Receiver == "" {
			continue
		}
		label := nodes[i].Name
		if label == "" {
			label = nodes[i].ID
		}
		out[nodes[i].Receiver] = append(out[nodes[i].Receiver], label)
	}
	return out, nil
}

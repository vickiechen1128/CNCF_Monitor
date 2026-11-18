package notify

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"gopkg.in/yaml.v3"
	"gorm.io/gorm"
)

// This file inlines the single route helper notify needs. Importing
// platform/alertmanager/route would drag configcenter/generator and the rest
// of the legacy route/config stack into the v3 binary.

// referencedReceiverNames reports which route nodes reference each receiver,
// using the same effective-config precedence as the legacy route package:
// newest non-discarded draft → newest confirmed version → newest applied
// alertmanager.yml mount. It is used for delete-time reference protection and
// for the channel list's read-only route-reference count.
func referencedReceiverNames(db *gorm.DB) (map[string][]string, error) {
	if db == nil {
		return map[string][]string{}, nil
	}
	yamlText, err := effectiveAlertmanagerYAML(db)
	if err != nil {
		return nil, fmt.Errorf("load effective alertmanager config: %w", err)
	}
	out := map[string][]string{}
	for _, node := range parseReceiverTree(yamlText) {
		if node.receiver == "" {
			continue
		}
		label := node.name
		if label == "" {
			label = node.id
		}
		out[node.receiver] = append(out[node.receiver], label)
	}
	return out, nil
}

func effectiveAlertmanagerYAML(db *gorm.DB) (string, error) {
	best := ""
	var bestAt time.Time

	var draft models.ConfigDraft
	err := db.Where("network_domain_id = ? AND status <> ?", models.DefaultDomainID, models.DraftStatusDiscarded).
		Order("created_at DESC, id DESC").First(&draft).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", fmt.Errorf("load latest config draft: %w", err)
	}
	if err == nil && strings.TrimSpace(draft.AlertmanagerYml) != "" {
		best, bestAt = draft.AlertmanagerYml, draft.CreatedAt
	}

	var version models.ConfigVersion
	err = db.Where("network_domain_id = ?", models.DefaultDomainID).
		Order("created_at DESC, id DESC").First(&version).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", fmt.Errorf("load latest config version: %w", err)
	}
	if err == nil && strings.TrimSpace(version.AlertmanagerYml) != "" &&
		(best == "" || version.CreatedAt.After(bestAt)) {
		best = version.AlertmanagerYml
	}
	if best != "" {
		return best, nil
	}

	var applied models.AlertmanagerConfigVersion
	err = db.Where("status = ?", models.AlertmanagerConfigStatusApplied).
		Order("created_at DESC, id DESC").First(&applied).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("load latest applied alertmanager config: %w", err)
	}
	return applied.Content, nil
}

type receiverNode struct {
	id       string
	name     string
	receiver string
}

// parseReceiverTree is a focused route-tree walk: it only extracts receiver
// names and display labels, so it stays much smaller than the legacy route
// parser while producing the same reference map notify needs.
func parseReceiverTree(yamlText string) []receiverNode {
	if strings.TrimSpace(yamlText) == "" {
		return nil
	}
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(yamlText), &doc); err != nil {
		return nil
	}
	if doc.Kind != yaml.DocumentNode || len(doc.Content) == 0 {
		return nil
	}
	root := doc.Content[0]
	if root.Kind != yaml.MappingNode {
		return nil
	}
	route := mappingValue(root, "route")
	if route == nil || route.Kind != yaml.MappingNode {
		return nil
	}
	out := make([]receiverNode, 0, 4)
	appendReceiverNodes(&out, route, "root")
	return out
}

func appendReceiverNodes(out *[]receiverNode, node *yaml.Node, id string) {
	*out = append(*out, receiverNode{
		id:       id,
		name:     scalarValue(mappingValue(node, "name")),
		receiver: scalarValue(mappingValue(node, "receiver")),
	})
	children := mappingValue(node, "routes")
	if children == nil || children.Kind != yaml.SequenceNode {
		return
	}
	for i, child := range children.Content {
		if child.Kind != yaml.MappingNode {
			continue
		}
		appendReceiverNodes(out, child, id+"/"+fmt.Sprint(i))
	}
}

func mappingValue(node *yaml.Node, key string) *yaml.Node {
	if node == nil || node.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(node.Content); i += 2 {
		if node.Content[i].Value == key {
			return node.Content[i+1]
		}
	}
	return nil
}

func scalarValue(node *yaml.Node) string {
	if node == nil || node.Kind != yaml.ScalarNode {
		return ""
	}
	return node.Value
}

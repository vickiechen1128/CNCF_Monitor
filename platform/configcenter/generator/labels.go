package generator

import "github.com/metriccenter/metriccenter/platform/models"

// mergeLabels 合并 system / user / cmdb 三层标签，返回最终标签集。
//
// 规则（PRD §3.3.1 / §3.3 标签注入）：
//   - system 标签受保护，User/CMDB 均不可覆盖（原型语义「system 不可被覆盖」）；
//   - 其余标签优先级 cmdb > user > system（cmdb 为 v0.4+ 预留，MVP 仅 user/sys 两层）。
func mergeLabels(system, user, cmdb map[string]string) map[string]string {
	out := make(map[string]string, len(system)+len(user)+len(cmdb))
	for k, v := range system {
		out[k] = v
	}
	for k, v := range user {
		if _, protected := system[k]; !protected {
			out[k] = v
		}
	}
	for k, v := range cmdb {
		if _, protected := system[k]; !protected {
			out[k] = v
		}
	}
	return out
}

// expandLabelTemplate 将标签模板的启用映射按字段视图展开为标签集。
// composite("instance_ip:port") 使用给出地址；resource_field 从字段视图取值。
func expandLabelTemplate(tmpl *models.LabelTemplate, fields map[string]string, address string) map[string]string {
	labels := map[string]string{}
	if tmpl == nil {
		return labels
	}
	for _, m := range tmpl.Mappings {
		if !m.Enabled {
			continue
		}
		switch {
		case m.SourceType == models.LabelSourceTypeComposite && m.SourceField == "instance_ip:port":
			if address != "" {
				labels[m.TargetLabel] = address
			}
		case m.SourceType == models.LabelSourceTypeResourceField:
			if v, ok := fields[m.SourceField]; ok && v != "" {
				labels[m.TargetLabel] = v
			}
		}
	}
	return labels
}

// mergeIntoLabels 将模板展开标签与 system 层身份标签按优先级并入。
// system 层（如 resource_id，决策 47-3 coverage 回连键）受保护，模板展开
// 视为 user 语义（MVP 无 cmdb），不可覆盖 system。
func mergeIntoLabels(system, templateLabels map[string]string) map[string]string {
	return mergeLabels(system, templateLabels, nil)
}
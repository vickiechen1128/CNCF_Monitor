package generator

import "github.com/metriccenter/metriccenter/platform/models"

// mergeLabels 合并 system / user / cmdb 三层标签，返回最终标签集。
//
// 规则（PRD §3.3.1 / §3.3 标签注入）：
//   - system 标签受保护，User/CMDB 均不可覆盖（原型语义「system 不可被覆盖」）；
//   - 其余标签优先级 cmdb > user > system（cmdb 为 v0.4+ 预留，MVP 仅 user/sys 两层）。
//
// ⚠️ 由此推出的调用方规约（决策 118-2，**必须由代码评审拦截**）：**同一 label 不得
// 同时由 system 层与模板层产出**。system 已写该键时，模板层取值会被**静默覆盖**且
// 不报错、不告警——决策 115 补的 `platform_code → platform` 默认模板映射即因此在主
// 路径完全失效（`sum by (platform)` 恒空）。新增 system 层标签前须先确认无同名模板
// 映射，反之亦然；不得依赖「两者恰好取值一致」。
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
//
// transform=dict（字典翻译）在 resource_field 分支生效：把字典编码翻译为展示名
// （app_code → 应用名 / biz_code → 业务名 / platform_code → 平台名 /
// network_domain_id → 网域名 / env → 中文环境名）；字典未命中回退原始 code，
// 保证存量数据与未登记编码仍能生成标签。dicts 为 nil 时等价于原样透传。
func expandLabelTemplate(tmpl *models.LabelTemplate, fields map[string]string, address string, dicts *labelDictionary) map[string]string {
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
				if m.Transform == models.LabelTransformDict {
					if translated, ok := dicts.translate(m.SourceField, v); ok {
						v = translated
					}
				}
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

// Package label implements Module 07 标签模板管理：LabelTemplate 列表、CRUD、
// mappings 与关联实例查询。本文件提供 system label 生成器（ComputeSystemLabels）
// 与「适用模板」查询（GetApplicableTemplate），供资源详情标签展示（T07-11）复用。
package label

import (
	"errors"
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// SystemLabel 表示由标签模板为单个资源实时计算出的 system 标签
// （Module_07 §5.3：实时计算、不落库）。
//
// 字段语义：
//   - Key：目标 Prometheus 标签名（如 app / env / hostname / biz）；
//   - Value：标签值。composite→instance 映射本阶段不生成拼接值（交由 Module_09
//     生成配置时拼接，§5.12 C），Value 为空字符串；
//   - SourceMap：「来源字段→目标标签」标注，供前端「来自 XX 模板 · 来源字段→目标
//     标签」展示（§5.3 联动呈现），如 "app_name→app"。
type SystemLabel struct {
	Key       string `json:"key"`
	Value     string `json:"value"`
	SourceMap string `json:"source_map"`
}

// ComputeSystemLabels 按标签模板为单个资源实时计算 system 标签（纯函数，不落库）。
//
// 处理规则（Module_07 §5.12 / §5.13 / §5.15）：
//   - 仅处理 source_type ∈ {resource_field, composite} 且 enabled 的映射；
//     prometheus_builtin / cmdb_field 本阶段跳过（v0.2+ / v0.4+ 预留，§5.12 B）；
//   - resource_field：经 models 包字段映射 helper（models.GetResourceField）从资源
//     读取对应字段值——Host 经 legacy 映射取列（instance_ip→private_ip、
//     hostname/instance_name→instance_name、os_type→image、env→env_flag、
//     cluster→sub_app_code、app_name→app_code）；
//   - 空值处理：读取值为空时跳过该映射（§5.15 规则 4；app_name/cluster 对
//     host/generic_target 可空，不注入对应标签，§5.2 ✅*）；
//   - composite→instance：标注「内置默认」（§5.13），本阶段不生成拼接值，Value
//     留空，交由 Module_09 生成配置时拼接（§5.12 C）。
func ComputeSystemLabels(template *models.LabelTemplate, res models.Resource) []SystemLabel {
	if template == nil || res == nil {
		return nil
	}
	labels := make([]SystemLabel, 0, len(template.Mappings))
	for _, m := range template.Mappings {
		if !m.Enabled {
			continue
		}
		switch m.SourceType {
		case models.LabelSourceTypeComposite:
			// 组合字段为默认模板内置（自动生成 instance，§5.13）；本阶段不生成拼接值。
			if m.TargetLabel == "instance" {
				labels = append(labels, SystemLabel{
					Key:       m.TargetLabel,
					Value:     "",
					SourceMap: m.SourceField + "→" + m.TargetLabel + "（内置默认）",
				})
			}
		case models.LabelSourceTypeResourceField:
			value, ok := models.GetResourceField(res, m.SourceField)
			if !ok || value == "" {
				continue // 字段未映射或值为空：不注入对应标签
			}
			labels = append(labels, SystemLabel{
				Key:       m.TargetLabel,
				Value:     value,
				SourceMap: m.SourceField + "→" + m.TargetLabel,
			})
		}
		// prometheus_builtin / cmdb_field：本阶段跳过（v0.2+ / v0.4+ 预留）。
	}
	return labels
}

// GetApplicableTemplate 返回某资源类型的默认标签模板（is_default=true），供资源
// 详情「适用模板」展示（默认模板名 + ID，Module_07 §9.1 / §3.1 联动呈现）。无默认
// 模板时返回可读空态错误，由调用方呈现为空态提示。
func GetApplicableTemplate(db *gorm.DB, category models.ResourceCategory) (*models.LabelTemplate, error) {
	var t models.LabelTemplate
	err := db.Where("resource_category = ? AND is_default = ?", category, true).First(&t).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("资源类型 %s 暂无默认标签模板，请先在标签模板管理中创建", category)
	}
	if err != nil {
		return nil, fmt.Errorf("查询 %s 默认标签模板失败: %w", category, err)
	}
	return &t, nil
}

package models

// 网域标签键与解析规则（跨模块共享）：
//
//   - NetworkDomainLabelKey 是「面向消费侧」的网域标签键——M02 查询中心注入标签 key
//     契约（M02 决策 4.4：统一 network_domain / tenant_id）与 M08 告警状态视图
//     labels.network_domain（契约快照 §10.1/§10.2）；
//   - NetworkDomainIDLabelKey 是「面向写入侧」的部署级 external_labels 键——M09
//     prometheus.yml global.external_labels 注入键（v3 仅注入 network_domain_id /
//     replica）。
//
// 两者是同一个网域值的两种载体：指标经边缘 vmagent remote_write 回传、或告警被
// Prometheus 发往 Alertmanager 时，external_labels 会被附加到序列 / 告警标签上，
// 因此写入侧携带的是 NetworkDomainIDLabelKey，消费侧统一读 NetworkDomainLabelKey。
const (
	// NetworkDomainLabelKey 是消费侧网域标签键（M02 决策 4.4 契约键）。
	NetworkDomainLabelKey = "network_domain"
	// NetworkDomainIDLabelKey 是写入侧部署级 external_labels 网域键（M09 决策 19）。
	NetworkDomainIDLabelKey = "network_domain_id"
	// NetworkDomainNameLabelKey 是网域中文展示名标签键（target 级 system 注入）。
	// **仅用于展示**：过滤 / 归属 / 授权仍以 NetworkDomainLabelKey 的 ID 值为准，
	// 不得用本键替代身份键。
	NetworkDomainNameLabelKey = "network_domain_name"
	// CloudNameLabelKey 是云字典中文展示名标签键（target 级 system 注入，仅展示）。
	CloudNameLabelKey = "cloud_name"
)

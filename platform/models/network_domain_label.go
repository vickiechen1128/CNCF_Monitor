package models

// 网域标签键与解析规则（跨模块共享）：
//
//   - NetworkDomainLabelKey 是「面向消费侧」的网域标签键——M02 查询中心注入标签 key
//     契约（M02 决策 4.4：统一 network_domain / tenant_id）与 M08 告警状态视图
//     labels.network_domain（契约快照 §10.1/§10.2）；
//   - NetworkDomainIDLabelKey 是「面向写入侧」的部署级 external_labels 键——M09
//     prometheus.yml global.external_labels 注入键（M09 决策 19 / v1.45 收敛：
//     network_domain_id / zone_type / replica）。
//
// 两者是同一个网域值的两种载体：指标经边缘 vmagent remote_write 回传、或告警被
// Prometheus 发往 Alertmanager 时，external_labels 会被附加到序列 / 告警标签上，
// 因此写入侧携带的是 NetworkDomainIDLabelKey。消费侧统一读 NetworkDomainLabelKey，
// 由 ResolveNetworkDomain 承担回落，避免调用方各自硬编码。
const (
	// NetworkDomainLabelKey 是消费侧网域标签键（M02 决策 4.4 契约键）。
	NetworkDomainLabelKey = "network_domain"
	// NetworkDomainIDLabelKey 是写入侧部署级 external_labels 网域键（M09 决策 19）。
	NetworkDomainIDLabelKey = "network_domain_id"
)

// ResolveNetworkDomain 从指标 / 告警标签解析网域归属，读取顺序：
//
//  1. network_domain（消费侧契约键，优先——调用方已归一或显式注入时以它为准）；
//  2. network_domain_id（写入侧 external_labels 键，覆盖边缘 remote_write 回传的
//     序列与经 Alertmanager 附加外部标签的告警）；
//  3. DefaultDomainID（"default"）兜底——与 M02 §2.1.1 / M08 §10.1 的「缺失回落
//     default」契约一致。
//
// 入参为 nil map 时安全返回兜底值。
func ResolveNetworkDomain(labels map[string]string) string {
	if v := labels[NetworkDomainLabelKey]; v != "" {
		return v
	}
	if v := labels[NetworkDomainIDLabelKey]; v != "" {
		return v
	}
	return DefaultDomainID
}

// EnsureNetworkDomain 把解析后的网域回写进标签映射并返回该映射，供代理层在响应中
// 补齐 labels.network_domain（入参为 nil 时新建映射，避免对 nil map 赋值 panic）。
//
// 调用方需自行把返回值写回原字段，例如：
//
//	a.Labels = models.EnsureNetworkDomain(a.Labels, domain)
func EnsureNetworkDomain(labels map[string]string, domain string) map[string]string {
	if labels == nil {
		labels = map[string]string{}
	}
	labels[NetworkDomainLabelKey] = domain
	return labels
}

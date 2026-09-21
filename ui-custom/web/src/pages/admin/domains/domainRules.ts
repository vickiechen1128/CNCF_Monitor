import type { NetworkDomain } from '../../../types/domain'

/**
 * 判断网域是否为「空网域」（未纳管监控），用于决定删除按钮是否可用。
 * 客户端启发式判断（依据已返回的 M09 纳管字段）；权威校验以后端 DELETE 前置校验为准——
 * 空网域 = 无 M07 资源引用 且 无已纳管 EdgeAgent（Module_06 §6.2 / §11.2）。
 */
export function isVacantDomain(d: NetworkDomain): boolean {
  if (d.is_monitored) return false
  // 运行态存在即非空域（normal/partial/offline 均表明已纳管监控；unknown 表示无节点数据）
  if (d.monitored_status && d.monitored_status !== 'unknown') return false
  if (d.agent_version) return false
  if (d.channel === 'agent_pull' || d.token || d.center_endpoint) return false
  return true
}

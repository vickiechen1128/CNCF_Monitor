import type { NetworkDomain } from '../../../types/domain'

/**
 * 判断网域是否为「空网域」（未纳管监控），用于决定删除按钮是否可用。
 * 客户端启发式判断（依据已返回的 M09 纳管字段）；权威校验以后端 DELETE 前置校验为准——
 * 空网域 = 无 M07 资源引用 且 无已纳管 EdgeAgent（Module_06 §6.2 / §11.2）。
 */
export function isVacantDomain(d: NetworkDomain): boolean {
  if (d.is_monitored) return false
  if (d.monitored_status === 'online') return false
  if (d.agent_version) return false
  if (d.channel === 'agent_pull' || d.token || d.center_endpoint) return false
  return true
}

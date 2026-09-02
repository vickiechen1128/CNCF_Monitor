/**
 * sha256 校验和短显（技术信息折叠区共用工具，M08/M09 口径统一避免漂移）。
 * 规则：超过 16 位时省略中间、首尾各保留 8 位；空值返回占位 '-'。
 * 消费方：告警配置版本校验和列、配置中心联合校验值展示。
 */
export function shortChecksum(checksum?: string): string {
  if (!checksum) return '-'
  return checksum.length > 16 ? `${checksum.slice(0, 8)}…${checksum.slice(-8)}` : checksum
}
/**
 * Grafana iframe 地址构造（M05 PRD v1.15 §11.10）：
 * 保留原始 URL 与全部查询参数，缺省追加 `kiosk`（裸键，已有不重复追加）与
 * `hideLogo=true`（已有不重复追加）。
 *
 * 2026-11-16 修复：旧实现用字符串拼接追加参数，遇到 `#hash` 时会把参数拼到
 * fragment 之后（Grafana 收不到 kiosk）；以空查询串 `?` 结尾时会拼出 `??kiosk`。
 * 这里改用 `URL` 解析做校验/判断，再从原始串**只替换查询串**，既保留 Grafana
 * 常见参数（`$__all` 等）的原始编码，也保证 fragment 始终在末尾。
 *
 * 非法 URL 直接抛错，由调用方（DashboardFrame）降级为可读提示，避免整页白屏。
 */
export function buildKioskURL(rawURL: string): string {
  // 仅用于校验与参数存在性判断；真正输出基于原始串，避免 URL 规范化改写编码。
  const parsed = new URL(rawURL)
  const additions: string[] = []
  if (!parsed.searchParams.has('kiosk')) additions.push('kiosk')
  if (!parsed.searchParams.has('hideLogo')) additions.push('hideLogo=true')
  if (additions.length === 0) return rawURL

  const hashIndex = rawURL.indexOf('#')
  const base = hashIndex === -1 ? rawURL : rawURL.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : rawURL.slice(hashIndex)
  const separator = !base.includes('?') ? '?' : base.endsWith('?') || base.endsWith('&') ? '' : '&'
  return `${base}${separator}${additions.join('&')}${hash}`
}

/**
 * 保存源数据（Job / 规则 / 告警配置）后同步触发配置变更单生成。
 * 即时性优化：替代变更检测 watcher 最长 30s 的轮询等待，用户保存后立即可见变更单。
 *
 * 语义与安全性：
 * - 对每个网域调用 POST /api/v2/platform/config/drafts（draft.GenerateDraft 幂等：
 *   无实质变更返回 no_changes；同域已有活 pending 按 checksum reconcile/取代，
 *   不会重复生成，决策 42-1）；
 * - 生成/更新成功：提示变更单号，点击跳转「配置变更确认」；
 * - 全部网域均无实质变更：提示已保存但无需变更单（如仅改了不参与生成的字段）；
 * - 触发失败：不阻塞保存流程，仅 warning 提示由自动检测兜底。
 */
import { message } from 'antd'
import { configDraftApi } from '../../../api/configCenter'
import { fetchMonitoredDomains } from './useConfigDrafts'

/** 配置变更确认页路由 */
export const CONFIG_PREVIEW_PATH = '/config-preview'

export interface TriggerDraftOptions {
  /** 点击成功提示时跳转（一般为 () => navigate('/config-preview')） */
  onNavigate?: () => void
  /** 提示前缀（如「配置已挂载」），与变更单提示合并为一条消息 */
  prefix?: string
}

/** 同步触发指定网域的变更单生成（去重、并发、容错）。 */
export async function triggerConfigDrafts(
  networkDomainIds: string[],
  opts?: TriggerDraftOptions,
): Promise<void> {
  const ids = [...new Set(networkDomainIds.filter(Boolean))]
  if (ids.length === 0) return
  const results = await Promise.allSettled(ids.map((id) => configDraftApi.create(id)))
  const changeNos: string[] = []
  let failed = 0
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      // 无实质变更时后端返回 { message, no_changes: true }（非 ConfigDraft）
      const data = r.value.data as { change_no?: string; no_changes?: boolean } | undefined
      if (data && !data.no_changes && data.change_no) changeNos.push(data.change_no)
    } else {
      failed++
    }
  }
  const prefix = opts?.prefix ? `${opts.prefix}，` : ''
  if (changeNos.length > 0) {
    message.success({
      content: `${prefix}已生成配置变更单 ${changeNos.join('、')}，点击前往「配置变更确认」发布`,
      duration: 6,
      onClick: opts?.onNavigate,
    })
    return
  }
  if (failed > 0) {
    message.warning(
      `${prefix}变更单同步生成触发失败，将由自动检测兜底生成（最长约 30s），也可到「配置变更确认」页查看`,
    )
    return
  }
  message.info(`${prefix}已保存，本次无实质配置变更，无需生成变更单`)
}

/**
 * 规则类源数据为全局 scope（central/both，generator.LoadRules 不按网域过滤），
 * 保存后需对全部已纳管网域触发生成；获取网域列表失败时静默（由 watcher 兜底）。
 */
export async function triggerConfigDraftsForAllDomains(opts?: TriggerDraftOptions): Promise<void> {
  let ids: string[]
  try {
    const domains = await fetchMonitoredDomains()
    ids = domains.map((d) => d.id)
  } catch {
    message.warning(
      `${opts?.prefix ? `${opts.prefix}，` : ''}网域列表获取失败，变更单将由自动检测兜底生成（最长约 30s）`,
    )
    return
  }
  await triggerConfigDrafts(ids, opts)
}

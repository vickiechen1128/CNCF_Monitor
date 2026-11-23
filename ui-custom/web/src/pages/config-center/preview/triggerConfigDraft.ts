/**
 * 保存源数据（Job / 规则 / 告警配置）后的配置同步触发层。
 *
 * v3 没有草稿 / 变更单，但 M09 仍是 30s watcher 兜底；本模块在保存成功后
 * best-effort 触发一次即时生成，缩短「待同步」窗口。触发失败静默降级，
 * watcher 会在下一轮补齐。
 *
 * 历史背景：v2 通过 POST /api/v3/platform/config/drafts 即时触发变更单生成；
 * v3 改为 POST /api/v3/platform/config-sync/trigger。
 */
import { configSyncTriggerApi } from '../../../api/configCenter'

/** 配置产物历史页路由（2026-11-17 起为合并后的单页路由；旧 /config-preview 仍可重定向到达） */
export const CONFIG_PREVIEW_PATH = '/config-snapshots'

export interface TriggerDraftOptions {
  /** 历史参数：点击成功提示时跳转；v3 自动同步后不再使用 */
  onNavigate?: () => void
  /** 历史参数：提示前缀；v3 自动同步后不再使用 */
  prefix?: string
}

/**
 * 即时触发指定网域的配置生成（best-effort）。
 *
 * 调用方保持 `void triggerConfigDrafts(...)` 的 fire-and-forget 语义；
 * 列表页通过轮询 sync_status 感知最终结果，不依赖本 Promise。
 */
export async function triggerConfigDrafts(
  networkDomainIds: string[],
  _opts?: TriggerDraftOptions,
): Promise<void> {
  const ids = Array.from(new Set(networkDomainIds.map((id) => id.trim()).filter(Boolean)))
  if (ids.length === 0) return
  try {
    await configSyncTriggerApi.trigger({
      scope: 'domain',
      network_domain_ids: ids,
      wait: false,
    })
  } catch {
    // 触发是优化项：权限/网络/后端异常都不能阻断保存动线，30s watcher 兜底。
  }
}

/**
 * 即时触发中心规则重算（规则是全局 scope，由中心 Prometheus 统一求值）。
 *
 * 历史参数 `prefix` / `onNavigate` 保留以兼容既有调用点，不再使用。
 */
export async function triggerConfigDraftsForAllDomains(_opts?: TriggerDraftOptions): Promise<void> {
  try {
    await configSyncTriggerApi.trigger({ scope: 'center', wait: false })
  } catch {
    // 同上：watcher 兜底。
  }
}

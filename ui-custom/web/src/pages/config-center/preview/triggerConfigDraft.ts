/**
 * 保存源数据（Job / 规则 / 告警配置）后的配置同步兼容层。
 *
 * v3 语义：配置变更即自动同步，不再生成草稿 / 变更单，也没有人工确认与下发动作。
 * 既有保存动线仍调用本模块（保持 best-effort 调用点不变），因此导出签名保留为空操作；
 * 待各保存页在 v3 收敛后可直接删除这些调用与文件。
 *
 * 历史背景：v2 通过 POST /api/v2/platform/config/drafts 即时触发变更单生成，
 * 以缩短 watcher 最长 30s 的轮询等待；该端点已在 v3 删除。
 */

/** 配置快照页路由（保留给既有保存动线跳转引用） */
export const CONFIG_PREVIEW_PATH = '/config-preview'

export interface TriggerDraftOptions {
  /** 历史参数：点击成功提示时跳转；v3 自动同步后不再使用 */
  onNavigate?: () => void
  /** 历史参数：提示前缀；v3 自动同步后不再使用 */
  prefix?: string
}

/**
 * 兼容空操作：v3 配置变更由后端自动同步并生成快照，无需前端触发生成草稿。
 * 保留 Promise 签名以兼容既有 `void triggerConfigDrafts(...)` 调用。
 */
export async function triggerConfigDrafts(
  _networkDomainIds: string[],
  _opts?: TriggerDraftOptions,
): Promise<void> {
  // v3：变更即自动同步，无草稿可生成。
}

/**
 * 兼容空操作：规则类全局变更同样由后端自动同步。
 * 保留导出以兼容采集策略各保存动线。
 */
export async function triggerConfigDraftsForAllDomains(_opts?: TriggerDraftOptions): Promise<void> {
  // v3：变更即自动同步，无草稿可生成。
}

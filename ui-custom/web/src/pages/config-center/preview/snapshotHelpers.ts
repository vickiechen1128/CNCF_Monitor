/**
 * Module_09 配置快照页共享展示逻辑（v3 契约 §4）。
 * 仅含纯函数 / 常量，供配置快照页与快照历史页复用并便于单测。
 */
import type { ConfigArtifactType, ConfigSnapshot, SnapshotValidationStatus } from '../../../types/config-center'

/** 配置产物类型文案（SRS v1.5 FR-13） */
export const ARTIFACT_TYPE_LABEL: Record<ConfigArtifactType, string> = {
  domain: '采集配置',
  center: '中心规则',
  alertmanager: '告警配置',
}

export const ARTIFACT_TYPE_COLOR: Record<ConfigArtifactType, string> = {
  domain: 'blue',
  center: 'purple',
  alertmanager: 'orange',
}

/** 快照校验状态用户文案（v3 仅 passed / failed） */
export const SNAPSHOT_STATUS_LABEL: Record<SnapshotValidationStatus, string> = {
  passed: '成功',
  failed: '失败',
}

export const SNAPSHOT_STATUS_COLOR: Record<SnapshotValidationStatus, string> = {
  passed: 'success',
  failed: 'error',
}

/** 校验失败归因用户文案（契约 §4.1；passed 快照为 none） */
export const SNAPSHOT_CAUSE_LABEL: Record<string, string> = {
  user_config: '用户配置问题',
  platform_fault: '平台故障',
  none: '无',
}

/** 生成来源展示名（generated_by 为后端标识，未识别时原样展示） */
export const SNAPSHOT_GENERATOR_LABEL: Record<string, string> = {
  system: '系统自动生成',
  alertmanager: '告警配置同步',
  admin: '管理员操作',
}

/** 配置历史保留口径（用户可见，避免暴露技术细节） */
export const SNAPSHOT_RETENTION_TIP =
  '系统只保留最近 30 天、每天最多 1 份成功配置；当前正在使用的配置不会被删除。'

/**
 * validation_details 美化展示：
 * - 空值 / 空对象 / 空数组 → 空串（页面展示「无校验明细」）；
 * - JSON 字符串 → 解析后缩进；
 * - 对象 / 数组 → 直接缩进序列化。
 */
export function validationDetailsText(details: unknown): string {
  if (details === null || details === undefined) return ''
  if (typeof details === 'string') {
    const trimmed = details.trim()
    if (!trimmed) return ''
    try {
      const parsed: unknown = JSON.parse(trimmed)
      const formatted = JSON.stringify(parsed, null, 2)
      return formatted === '{}' || formatted === '[]' ? '' : formatted
    } catch {
      return trimmed
    }
  }
  if (typeof details === 'object') {
    if (Object.keys(details as Record<string, unknown>).length === 0) return ''
    try {
      return JSON.stringify(details, null, 2)
    } catch {
      return String(details)
    }
  }
  return String(details)
}

/** 快照按创建时间倒序（同时间按 id 倒序），用于跨网域合并结果排序 */
export function sortSnapshotsNewestFirst<T extends Pick<ConfigSnapshot, 'id' | 'created_at'>>(rows: T[]): T[] {
  const time = (value: string): number => {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return [...rows].sort((a, b) => {
    const diff = time(b.created_at) - time(a.created_at)
    return diff !== 0 ? diff : b.id - a.id
  })
}

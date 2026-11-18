import type { DictionaryStatus } from '../../types/resource'

/**
 * 字典生命周期共享判定与文案（M07 SRS v2.0 §3.4 / §5.7 / NFR-21）。
 *
 * 单独放在非组件模块中：仓库 eslint 为 `max-warnings 0`，
 * `react-refresh/only-export-components` 不允许组件文件同时导出普通常量 / 函数。
 */

/** 四态统一文案（NFR-21）：启用 / 停用 / 已合并 / 已撤销 */
export const DICTIONARY_STATUS_LABEL: Record<DictionaryStatus, string> = {
  enabled: '启用',
  disabled: '停用',
  merged: '已合并',
  revoked: '已撤销',
}

/** 列表默认只展示「有效条目」（启用 + 停用），终态需切换到「全部」。 */
export const DICTIONARY_ACTIVE_STATUSES: DictionaryStatus[] = ['enabled', 'disabled']

/** 四态徽标颜色（AntD Badge status）。 */
export const DICTIONARY_STATUS_BADGE: Record<
  DictionaryStatus,
  'success' | 'default' | 'warning' | 'error'
> = {
  enabled: 'success',
  disabled: 'default',
  merged: 'warning',
  revoked: 'error',
}

/** 兼容旧响应缺字段的场景：status 缺失时由 enabled 推导「启用 / 停用」。 */
export function dictionaryStatusOf(entry: {
  status?: DictionaryStatus
  enabled?: boolean
}): DictionaryStatus {
  if (entry.status) return entry.status
  return entry.enabled === false ? 'disabled' : 'enabled'
}

/** 已合并 / 已撤销为终态，不可再编辑、启停、撤销或合并。 */
export function isDictionaryTerminal(status: DictionaryStatus): boolean {
  return status === 'merged' || status === 'revoked'
}

/** 完整生命周期规则（字典页「查看规则」抽屉）。 */
export const DICT_LIFECYCLE_RULES = [
  '字典条目是编码取值权威，不是可删除的对象：编码写入历史监控序列后不能物理删除，也不能重新登记复用。',
  '从未被引用的条目可以「撤销」；撤销是终态，编码永久保留，不可重新登记。',
  '已被资源或应用平台关联引用的条目，只能「停用」或「合并」：停用保留存量引用、禁止新增引用；合并把引用迁移到目标编码。',
  '业务 / 应用 / 平台 / 云 / 区域类型五个字典遵循同一套规则；页面不提供删除入口，变更可在「变更日志」中追溯。',
]

/** 名称列统一后缀：停用 / 已合并 / 已撤销。 */
export function dictionaryNameSuffix(status: DictionaryStatus): string {
  switch (status) {
    case 'disabled':
      return '（已停用）'
    case 'merged':
      return '（已合并）'
    case 'revoked':
      return '（已撤销）'
    default:
      return ''
  }
}

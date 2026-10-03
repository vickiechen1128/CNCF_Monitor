/**
 * 路由「分组键」标签名联想（T08-F13，v0.3-c 联动）。
 *
 * 数据来源：`GET /api/v2/platform/alertmanager/silences/label-options`——与静默管理页同源的
 * **四层并集**键集合（决策 71 既有资产，零后端改动）：系统与采集标签 ∪ 标签模板 ∪ 规则标签 ∪ 网域标识。
 *
 * 口径：
 * - 取数失败 / 无权限 → **静默降级为空集合**（分组键可手写输入，绝不阻断编辑与保存）；
 * - 仅做「联想」，不限制用户输入：未收录的标签名仍可回车自建（AM `group_by` 是自由数组）。
 *
 * clipping（task-sequence T08-F13）：联想下拉**限制条数**（`ROUTE_LABEL_OPTION_LIMIT`，默认 50），
 * 不引入虚拟滚动依赖——标签键总量在百级，限制条数 + 关键词过滤即可规避长列表卡顿。
 */
import { useEffect, useState } from 'react'
import { alertmanagerSilenceApi } from '../../api/alertmanager'
import type { SilenceLabelOptionsData } from '../../types/alertmanager'

/** 联想下拉一次最多渲染的标签条数（clipping：限制条数，规避长列表） */
export const ROUTE_LABEL_OPTION_LIMIT = 50

/** 单条标签联想项（去重后的扁平形态） */
export interface RouteLabelOption {
  /** 标签名（= `group_by` 的值） */
  value: string
  /** 所属分组展示名（如「系统与采集标签」） */
  group: string
  /** 标签说明（可选，来自后端 label-options） */
  description?: string
}

/** 端点响应 → 扁平联想项：按分组顺序去重（同名键保留首次出现），再按标签名排序 */
export function flattenRouteLabelOptions(
  data: SilenceLabelOptionsData | null | undefined,
): RouteLabelOption[] {
  const out: RouteLabelOption[] = []
  const seen = new Set<string>()
  for (const group of data?.groups ?? []) {
    for (const item of group?.items ?? []) {
      const name = (item?.name ?? '').trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      out.push({ value: name, group: group.label ?? '', description: item.description })
    }
  }
  return out.sort((a, b) => a.value.localeCompare(b.value))
}

/**
 * 关键词过滤 + 限条：前缀命中优先于包含命中（同优先级按字典序），最后按 limit 截断。
 *
 * `keyword` 为空 = 不过滤，仅限条（首次打开下拉时展示前 N 个常用键）。
 */
export function filterRouteLabelOptions(
  options: RouteLabelOption[],
  keyword: string,
  limit: number = ROUTE_LABEL_OPTION_LIMIT,
): RouteLabelOption[] {
  const kw = (keyword ?? '').trim().toLowerCase()
  const matched = kw === '' ? options : options.filter((o) => o.value.toLowerCase().includes(kw))
  const rank = (o: RouteLabelOption) => (o.value.toLowerCase().startsWith(kw) ? 0 : 1)
  return [...matched].sort((a, b) => rank(a) - rank(b) || a.value.localeCompare(b.value)).slice(0, limit)
}

/** 是否命中限条（供 UI 提示「仅显示前 N 个，输入关键词精确查找」） */
export function isRouteLabelClipped(total: number, shown: number): boolean {
  return total > shown
}

/** 联想项 → antd Select 分组 options（分组内保持传入顺序；空分组不渲染） */
export function toRouteLabelSelectOptions(
  options: RouteLabelOption[],
): { label: string; options: { value: string; label: string }[] }[] {
  const byGroup = new Map<string, { value: string; label: string }[]>()
  for (const o of options) {
    const key = o.group || '其他标签'
    const arr = byGroup.get(key)
    if (arr) arr.push({ value: o.value, label: o.value })
    else byGroup.set(key, [{ value: o.value, label: o.value }])
  }
  return Array.from(byGroup, ([label, items]) => ({ label, options: items }))
}

/**
 * 分组键联想取数（仅 `enabled` 为真时取一次，避免列表页常驻请求）。
 * 失败静默降级为空数组（不抛错、不阻断编辑）。
 */
export function useRouteLabelOptions(enabled: boolean): RouteLabelOption[] {
  const [options, setOptions] = useState<RouteLabelOption[]>([])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const run = async () => {
      try {
        const res = await alertmanagerSilenceApi.getLabelOptions()
        if (!cancelled) setOptions(flattenRouteLabelOptions(res.data))
      } catch {
        // 联想是增强能力：取不到不阻断，分组键可手写输入
        if (!cancelled) setOptions([])
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [enabled])

  return options
}

/**
 * 「路由规则」页只读路由树数据 Hook（T08-F10，v0.3-a）。
 *
 * 数据来源：`GET /api/v2/platform/alertmanager/routes`（T08-12 后端契约；仅全局认证、只读无写能力）。
 * 成功 → `{ mode, items, dead_receivers }`；解析失败 → `{ mode, parse_error, raw_yaml }`（非 500、不白屏）。
 *
 * 归属边界：本 Hook 只读、不解析 YAML（前端零 yaml 依赖）、不生成产物；可写表单见 v0.3-b（T08-F11）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { alertmanagerRoutesApi } from '../../api/alertmanager'
import type { RouteNode, RouteTreeData } from '../../types/alertmanager'

/** 树形展开后的一行：节点 + 缩进深度（根为 0） */
export interface RouteRow {
  node: RouteNode
  depth: number
}

export interface UseRoutesResult {
  data: RouteTreeData | null
  /** 按 `parent_id` / `order` 建树后前序展开的行（根恒置顶）；解析失败时为空 */
  rows: RouteRow[]
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * 按 `parent_id` / `order` 把扁平节点序列还原为树并前序展开（根置顶）。
 *
 * 后端 `items` 本身已是前序序列（`items[0]` = 根），此处**按结构重建**而非依赖返回顺序，
 * 保证列表缩进层级与同级优先级（`order` 升序）与 AM 原生语义一致。
 */
export function buildRouteRows(items: RouteNode[]): RouteRow[] {
  const byParent = new Map<string, RouteNode[]>()
  for (const node of items ?? []) {
    const siblings = byParent.get(node.parent_id)
    if (siblings) siblings.push(node)
    else byParent.set(node.parent_id, [node])
  }
  for (const siblings of byParent.values()) siblings.sort((a, b) => a.order - b.order)

  const rows: RouteRow[] = []
  const walk = (nodes: RouteNode[], depth: number) => {
    for (const node of nodes) {
      rows.push({ node, depth })
      walk(byParent.get(node.id) ?? [], depth + 1)
    }
  }
  // 根节点的 parent_id 为空串（契约），从此处起遍历即得「根置顶」的层级序
  walk(byParent.get('') ?? [], 0)
  return rows
}

export function useRoutes(): UseRoutesResult {
  const [data, setData] = useState<RouteTreeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)

  const reload = useCallback(() => {
    setError(null)
    setLoading(true)
    setRefresh((r) => r + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const res = await alertmanagerRoutesApi.getRoutes()
        if (cancelled) return
        setData(res.data ?? null)
        setError(null)
      } catch (e) {
        if (cancelled) return
        setData(null)
        setError(e instanceof Error ? e.message : '加载路由规则失败，请稍后重试')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [refresh])

  const rows = useMemo(() => (data?.items ? buildRouteRows(data.items) : []), [data])
  return { data, rows, loading, error, reload }
}
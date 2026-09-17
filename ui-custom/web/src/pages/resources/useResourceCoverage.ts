import { useCallback, useEffect, useState } from 'react'
import { coverageApi } from '../../api/coverage'
import type { CoverageItem, CoverageState } from '../../types/query'
import type { ResourceCategory } from '../../types/resource'

export interface UseResourceCoverageResult {
  /** resource_id → coverage item（M07 行合并映射，禁止逐行查询 TQ-6） */
  coverageByResource: Record<string, CoverageItem>
  loading: boolean
  error: string | null
  /** 资源被任一 Job 选中时的采集状态；未命中（∉ 任何 Job）为 undefined，由调用方按「未监控」归一 */
  stateOf: (resourceId: string) => CoverageState | undefined
  reload: () => void
}

/**
 * M07 资源列表「采集状态」数据 Hook（决策 47-3）。
 * 一次拉取 M02 `GET /api/v1/health/coverage`（按当前 resource_category），Map by resource_id
 * 与列表行合并；coverage 加载失败不影响资源列表主渲染（列降级为 '-'）。
 * 随 Tab category 切换自动重拉；reload 用于编辑/删除后刷新 badge。
 */
export function useResourceCoverage(category: ResourceCategory): UseResourceCoverageResult {
  const [coverageByResource, setCoverage] = useState<Record<string, CoverageItem>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await coverageApi.list({ resource_category: category, page_size: 1000 })
      const map: Record<string, CoverageItem> = {}
      for (const it of res.data?.items ?? []) map[it.resource_id] = it
      setCoverage(map)
    } catch (e) {
      setCoverage({})
      setError(e instanceof Error ? e.message : '采集状态加载失败')
    } finally {
      setLoading(false)
    }
  }, [category])

  useEffect(() => {
    // 异步请求回调内 setState；沿用本模块既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, version])

  const reload = useCallback(() => setVersion((v) => v + 1), [])

  const stateOf = useCallback(
    (resourceId: string): CoverageState | undefined => coverageByResource[resourceId]?.monitor_state,
    [coverageByResource],
  )

  return { coverageByResource, loading, error, stateOf, reload }
}
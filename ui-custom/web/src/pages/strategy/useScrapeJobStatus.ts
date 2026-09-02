import { useEffect, useMemo, useState } from 'react'
import { targetsApi } from '../../api/targets'
import type { TargetItem } from '../../types/query'
import type { ScrapeJobInstanceItem } from '../../types/strategy'

/** Job 实例「采集状态」三枚举（决策 47-2，仅 M01 抽屉内展示用） */
export type JobInstanceScrapeStatus = 'collecting' | 'down' | 'pending'

/** 外层汇总（决策 47-2：在线数 / 实例总数 / 待采集数；down 实例不计入在线与待采集） */
export interface JobScrapeStatusSummary {
  online: number
  total: number
  pending: number
}

interface UseScrapeJobStatusResult {
  /** resource_id → 实例采集状态 */
  statusMap: Record<string, JobInstanceScrapeStatus>
  summary: JobScrapeStatusSummary
  /** 已确认下发时拉取 M02 targets 的加载态（未下发/无实例时恒 false） */
  loading: boolean
}

/** 从 target.instance `host:port` 提取 host（IPv4 / 主机名按最后一个 ':' 截断；无冒号即原值） */
function hostOf(instance?: string): string {
  if (!instance) return ''
  const idx = instance.lastIndexOf(':')
  return idx === -1 ? instance : instance.slice(0, idx)
}

/**
 * M01 Job 实例「采集状态」回显（决策 47-2）。
 * 只读消费 M02 `GET /api/v1/targets?job=<job_name>`，不直连 Prometheus、不回持久化（展示口径）。
 * 时序：变更未确认下发（deployed=false）→ 全部「待采集」；已确认下发 → 按目标 health 推导
 * up=collecting / down=down（已下发未采到）/ 无对应 target 或 unknown=pending。
 * 实例↔target 匹配：优先 target.resource_id 标签回连，回落主机地址（host vs instance_ip）匹配。
 */
export function useScrapeJobStatus(
  jobName: string | undefined,
  deployed: boolean,
  items: ScrapeJobInstanceItem[],
): UseScrapeJobStatusResult {
  const [targets, setTargets] = useState<TargetItem[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!deployed || !jobName || items.length === 0) return
    let active = true
    const run = async () => {
      setLoading(true)
      try {
        const res = await targetsApi.list({ job: jobName })
        if (active) setTargets(res.data?.activeTargets ?? [])
      } catch {
        if (active) setTargets([])
      } finally {
        if (active) setLoading(false)
      }
    }
    // 异步请求回调内 setState；沿用本模块既有 set-state-in-effect 模式
    void run()
    return () => {
      active = false
    }
  }, [deployed, jobName, items.length])

  const { statusMap, summary } = useMemo(() => {
    const map: Record<string, JobInstanceScrapeStatus> = {}
    let online = 0
    let pending = 0
    for (const it of items) {
      let status: JobInstanceScrapeStatus
      if (!deployed) {
        status = 'pending'
      } else {
        const target = targets.find(
          (x) =>
            (x.resource_id && x.resource_id === it.resource_id) || (!x.resource_id && hostOf(x.instance) === it.instance_ip),
        )
        const health = target?.health
        if (!target || health === 'unknown') status = 'pending'
        else if (health === 'up') status = 'collecting'
        else status = 'down'
      }
      map[it.resource_id] = status
      if (status === 'collecting') online += 1
      else if (status === 'pending') pending += 1
    }
    return { statusMap: map, summary: { online, total: items.length, pending } }
  }, [deployed, items, targets])

  return { statusMap, summary, loading }
}
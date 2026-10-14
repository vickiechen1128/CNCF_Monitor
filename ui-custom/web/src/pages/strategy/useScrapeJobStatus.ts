import { useEffect, useMemo, useState } from 'react'
import { queryApi } from '../../api/query'
import type { PromVectorItem } from '../../types/query'
import type { ScrapeJobInstanceItem } from '../../types/strategy'
import { upQueryForJob, lastUpQueryForJob, statusFromUp } from './upStatus'

/** Job 实例「采集状态」四态（决策 47-2 + F-40 回传延迟，仅 M01 抽屉内展示用） */
export type JobInstanceScrapeStatus = 'collecting' | 'down' | 'stale' | 'pending'

/** 外层汇总（决策 47-2：在线数 / 实例总数 / 待采集数；down 实例不计入在线与待采集）。
 * F-40 新增 stale（回传延迟中）：5min 窗口无样本、1h 内有，样本在途非丢失。 */
export interface JobScrapeStatusSummary {
  online: number
  total: number
  pending: number
  stale: number
}

interface UseScrapeJobStatusResult {
  /** resource_id → 实例采集状态 */
  statusMap: Record<string, JobInstanceScrapeStatus>
  summary: JobScrapeStatusSummary
  /** 已确认下发时拉取 M02 up 指标的加载态（未下发/无实例时恒 false） */
  loading: boolean
}

/** 查询单条 PromQL 并解包 vector result；任何失败（网络异常 / 非 vector / 调用方未 mock
 * 返回 undefined）一律降级为空数组，绝不向上抛——采集状态展示是旁路观测，不阻断主流程。 */
export async function queryVector(expr: string): Promise<PromVectorItem[]> {
  try {
    const res = await queryApi.query({ query: expr })
    return res?.data && res.data.resultType === 'vector' ? res.data.result : []
  } catch {
    return []
  }
}

/**
 * M01 Job 实例「采集状态」回显（决策 47-2，F-10 数据源收敛）。
 * 只读消费 M02 `GET /api/v1/query?query=up{job="<job_name>"}`，不直连 Prometheus、不回持久化。
 * 时间线：变更未确认下发（deployed=false）→ 全部「待采集」；已确认下发 → 按 up 值推导
 * 1=collecting / 0=down（已下发未采到）/ 5min 无样本但 1h 内有=stale（回传延迟中，F-40）/
 * 1h 内也无样本=pending。
 * 采集节点域（agent_pull）经 remote_write 上报 up 样本，本口径对 local 与边缘两通道均成立
 * （F-10：替代原 `/api/v1/targets`，后者仅 local 通道有效、采集节点域恒空）。
 * 实例↔序列匹配：优先 resource_id 标签回连，回落主机地址（host vs instance_ip）匹配。
 */
export function useScrapeJobStatus(
  jobName: string | undefined,
  deployed: boolean,
  items: ScrapeJobInstanceItem[],
): UseScrapeJobStatusResult {
  const [upItems, setUpItems] = useState<PromVectorItem[]>([])
  const [lastItems, setLastItems] = useState<PromVectorItem[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!deployed || !jobName || items.length === 0) return
    let active = true
    const run = async () => {
      setLoading(true)
      try {
        // F-40：并行的两个查询——up（5min 窗口实时态）+ last_over_time 时间戳（1h 窗口
        // 是否出现过样本），后者用于把「回传延迟」从「待采集」中区分出来。
        const [up, last] = await Promise.all([
          queryVector(upQueryForJob(jobName)),
          queryVector(lastUpQueryForJob(jobName)),
        ])
        if (active) {
          setUpItems(up)
          setLastItems(last)
        }
      } catch {
        if (active) {
          setUpItems([])
          setLastItems([])
        }
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
    let stale = 0
    for (const it of items) {
      const status = deployed ? statusFromUp(upItems, it, lastItems) : 'pending'
      map[it.resource_id] = status
      if (status === 'collecting') online += 1
      else if (status === 'stale') stale += 1
      else if (status === 'pending') pending += 1
    }
    return { statusMap: map, summary: { online, total: items.length, pending, stale } }
  }, [deployed, items, upItems, lastItems])

  return { statusMap, summary, loading }
}
import { useEffect, useState } from 'react'
import { targetsApi } from '../../api/targets'
import { scrapeJobApi } from '../../api/scrapeJobs'
import type { TargetItem } from '../../types/query'
import type { ScrapeJob, ScrapeJobInstanceItem } from '../../types/strategy'
import type { JobInstanceScrapeStatus } from './useScrapeJobStatus'

/**
 * Job 维度「采集状态」聚合（Module_01，决策 47-2 的 per-job 形态）。
 * coverage 接口（M02）item 是资源维度、不含 job 维度，无法直接按 job 过滤；
 * 故本 hook 按当前页每个 Job 拉取 `scrapeJobApi.instances(id)` + `targetsApi.list({job})`
 * 聚合得出「采集中 / 已下发未采到 / 待采集」，供采集 Job 列表『采集状态』列展示。
 * 复用 useScrapeJobStatus 的实例↔target 匹配口径（resource_id 回连回落到 host 地址）。
 */

/** Job 汇总三态（同 ExporterInstallationPanel SCRAPE_STATUS_META 口径） */
export type JobScrapeAggState = 'collecting' | 'down' | 'pending'

/** Job 维度采集状态汇总视图 */
export interface JobScrapeStatusView {
  state: JobScrapeAggState
  online: number
  down: number
  pending: number
  total: number
  /** 是否已完成抓取（列表骨架未就绪时不渲染半态计数） */
  loaded: boolean
}

/** 从 target.instance `host:port` 提取 host（IPv4 / 主机名按最后一个 ':' 截断；无冒号即原值） */
function hostOf(instance?: string): string {
  if (!instance) return ''
  const idx = instance.lastIndexOf(':')
  return idx === -1 ? instance : instance.slice(0, idx)
}

/** 对单个 Job 的已选实例做采集状态聚合（复用 useScrapeJobStatus 决策 47-2 推导） */
function aggregateView(deployed: boolean, items: ScrapeJobInstanceItem[], targets: TargetItem[]): JobScrapeStatusView {
  let online = 0
  let down = 0
  let pending = 0
  for (const it of items) {
    let s: JobInstanceScrapeStatus
    if (!deployed) {
      s = 'pending'
    } else {
      const t = targets.find(
        (x) => x.resource_id === it.resource_id || (!x.resource_id && hostOf(x.instance) === it.instance_ip),
      )
      const health = t?.health
      if (!t || health === 'unknown') s = 'pending'
      else if (health === 'up') s = 'collecting'
      else s = 'down'
    }
    if (s === 'collecting') online += 1
    else if (s === 'down') down += 1
    else pending += 1
  }
  const state: JobScrapeAggState = online > 0 ? 'collecting' : down > 0 ? 'down' : 'pending'
  return { state, online, down, pending, total: items.length, loaded: true }
}

/**
 * 采集 Job 列表『采集状态』聚合数据源。
 * 输入当前页 Job 列表，逐个拉取实例 +（已下发时）targets，返回 job.id → 采集状态视图。
 * job 维度变更（new/add/change_status/enabled）驱动重新聚合。
 */
export function useJobScrapeStatus(jobs: ScrapeJob[]): Record<number, JobScrapeStatusView> {
  const [map, setMap] = useState<Record<number, JobScrapeStatusView>>({})

  const jobsKey = jobs.map((j) => `${j.id}:${j.job_name}:${j.change_status}:${j.enabled}`).join('|')

  useEffect(() => {
    if (jobs.length === 0) return
    let active = true
    const entries = jobs.map(async (job): Promise<[number, JobScrapeStatusView]> => {
      const deployed = job.change_status === 'deployed' && job.enabled !== false
      let items: ScrapeJobInstanceItem[] = []
      try {
        items = (await scrapeJobApi.instances(job.id)).data?.items ?? []
      } catch {
        // 实例拉取失败时保持空实例列表
      }
      let targets: TargetItem[] = []
      if (deployed) {
        try {
          targets = (await targetsApi.list({ job: job.job_name })).data?.activeTargets ?? []
        } catch {
          targets = []
        }
      }
      return [job.id, aggregateView(deployed, items, targets)]
    })
    // 全部 Job 聚合完成后一次性回写，避免逐条 setState 抖动
    void Promise.all(entries).then((results) => {
      if (!active) return
      const next: Record<number, JobScrapeStatusView> = {}
      results.forEach(([id, view]) => {
        next[id] = view
      })
      setMap(next)
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobsKey])

  return map
}
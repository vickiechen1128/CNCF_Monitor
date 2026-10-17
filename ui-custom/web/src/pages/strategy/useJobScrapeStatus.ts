import { useEffect, useState } from 'react'
import { scrapeJobApi } from '../../api/scrapeJobs'
import type { PreviewTargetsResult } from '../../api/scrapeJobs'
import type { PromVectorItem } from '../../types/query'
import type { ScrapeJob, ScrapeJobInstanceItem } from '../../types/strategy'
import { queryVector, type JobInstanceScrapeStatus } from './useScrapeJobStatus'
import {
  upQueryForJob,
  lastUpQueryForJob,
  statusFromUp,
  probeQueryForJob,
  probeStatusOfTarget,
  type ProbeTarget,
} from './upStatus'

/**
 * Job 维度「采集状态」聚合（Module_01，决策 47-2 的 per-job 形态，F-10 数据源收敛）。
 * coverage 接口（M02）item 是资源维度、不含 job 维度，无法直接按 job 过滤；
 * 故本 hook 按当前页每个 Job 拉取 `scrapeJobApi.instances(id)` + 中心 `up{job="<job_name>"}`
 * 聚合得出「采集中 / 已下发未采到 / 待采集」，供采集 Job 列表『采集状态』列展示。
 * 数据源由 `targetsApi.list` 收敛为 up 指标（F-10）：采集节点域经 remote_write 上报 up 样本，
 * 本口径对 local 与边缘两通道均成立。复用 upStatus.statusFromUp 的实例↔序列匹配口径。
 *
 * 拨测 Job（F-12）：blackbox 无实例维度，改按 `scrapeJobApi.previewTargets(id)` 解析出的
 * 拨测目标（`selected_instance_ids` 在 `target_field` 上的字段值，与下发 target 同源）
 * + 中心 `probe_success{job=...}` 聚合（`online` 语义 = 拨测通过数），
 * 详见 upStatus.probeStatusOfTarget。
 */

/** Job 汇总四态（同 ExporterInstallationPanel SCRAPE_STATUS_META 口径；F-40 增 stale 回传延迟中） */
export type JobScrapeAggState = 'collecting' | 'down' | 'stale' | 'pending'

/** Job 维度采集状态汇总视图 */
export interface JobScrapeStatusView {
  state: JobScrapeAggState
  online: number
  down: number
  /** 回传延迟中实例数（F-40）：5min 无样本、1h 内有，样本在途非丢失 */
  stale: number
  pending: number
  total: number
  /** 选中集引用、但资源已被软删/不存在的失效引用数（F-38/F-39：分母 total 不含此项） */
  missingCount: number
  /** 是否已完成抓取（列表骨架未就绪时不渲染半态计数） */
  loaded: boolean
}

/** 对单个 Job 的已选实例做采集状态聚合（复用 upStatus 决策 47-2 + F-40 三态推导）
 * `missingCount` 来自 ListJobInstances 的 `missing_count`：选中集引用、但资源已软删/失效的引用数，
 * 不参与分子分母，仅作为「另有 n 台实例资源已被删除」提示来源（F-38/F-39）。 */
function aggregateView(
  deployed: boolean,
  items: ScrapeJobInstanceItem[],
  upItems: PromVectorItem[],
  missingCount = 0,
  lastItems: PromVectorItem[] = [],
): JobScrapeStatusView {
  let online = 0
  let down = 0
  let stale = 0
  let pending = 0
  for (const it of items) {
    const s: JobInstanceScrapeStatus = deployed ? statusFromUp(upItems, it, lastItems) : 'pending'
    if (s === 'collecting') online += 1
    else if (s === 'down') down += 1
    else if (s === 'stale') stale += 1
    else pending += 1
  }
  // 聚合优先级：有采集正常即「采集中」；其次 down（真实抓取失败，重于延迟）；再次 stale
  //（回传延迟，提示查回传通道）；全无样本才「待采集」。
  const state: JobScrapeAggState = online > 0 ? 'collecting' : down > 0 ? 'down' : stale > 0 ? 'stale' : 'pending'
  return { state, online, down, stale, pending, total: items.length, missingCount, loaded: true }
}

/**
 * 对单个拨测 Job 的拨测目标做探测结果聚合（F-12）。
 * 复用同一三态枚举，但语义映射为拨测口径：`online`=通过数、`down`=失败数、`pending`=待拨测数。
 */
function aggregateProbeView(
  deployed: boolean,
  targets: ProbeTarget[],
  probeItems: PromVectorItem[],
): JobScrapeStatusView {
  let pass = 0
  let fail = 0
  let pending = 0
  for (const t of targets) {
    const s: JobInstanceScrapeStatus = deployed ? probeStatusOfTarget(probeItems, t) : 'pending'
    if (s === 'collecting') pass += 1
    else if (s === 'down') fail += 1
    else pending += 1
  }
  const state: JobScrapeAggState = pass > 0 ? 'collecting' : fail > 0 ? 'down' : 'pending'
  // 拨测聚合不产出 stale（F-40）：probe_success 由 blackbox_exporter 在边缘本地探测后
  // 经同一回传链路上报，延迟场景与标准 Job 同源，但拨测列表不区分「在途」态，保持三态。
  return { state, online: pass, down: fail, stale: 0, pending, total: targets.length, missingCount: 0, loaded: true }
}

/**
 * 采集 Job 列表『实例采集状态』聚合数据源。
 * 输入当前页 Job 列表，逐个拉取实例 +（已下发时）中心 up 指标，返回 job.id → 采集状态视图。
 * job 维度变更（new/add/change_status/enabled）与刷新 tick 驱动重新聚合。
 * 决策 47-2 + F-10：只读消费 M02 /api/v1/query（up 指标）；约 20s 自动刷新
 * （原型「在线 x / 总数 y」列的刷新节奏）。
 */
export function useJobScrapeStatus(jobs: ScrapeJob[], refreshMs = 20000): Record<number, JobScrapeStatusView> {
  const [map, setMap] = useState<Record<number, JobScrapeStatusView>>({})
  const [tick, setTick] = useState(0)

  const jobsKey = jobs.map((j) => `${j.id}:${j.job_name}:${j.change_status}:${j.enabled}`).join('|')

  // 20s 自动刷新 tickizer：每次 tick 递增触发重新聚合（默认 20s，测试可传其他值/关闭）
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), refreshMs)
    return () => clearInterval(id)
  }, [refreshMs])

  useEffect(() => {
    if (jobs.length === 0) return
    let active = true
    const entries = jobs.map(async (job): Promise<[number, JobScrapeStatusView]> => {
      const deployed = job.change_status === 'deployed' && job.enabled !== false
      // 拨测 Job（F-12）：无实例维度，按 preview-targets 解析出的拨测目标 + 中心 probe_success
      // 聚合探测结果。preview-targets 与生成侧同源（同一 selected_instance_ids + target_field
      // 读取入口），故解析出的 address 与最终下发的 __param_target 逐字一致。
      if (job.job_type === 'blackbox') {
        let targets: ProbeTarget[] = []
        try {
          const pv = await scrapeJobApi.previewTargets(job.id)
          const list: PreviewTargetsResult['targets'] = pv.data?.targets ?? []
          targets = list.filter((t) => !!t.address)
        } catch {
          // 目标解析失败时按空目标处理（列表显示 '-'）
        }
        let probeItems: PromVectorItem[] = []
        if (deployed && job.job_name && targets.length > 0) {
          probeItems = await queryVector(probeQueryForJob(job.job_name))
        }
        return [job.id, aggregateProbeView(deployed, targets, probeItems)]
      }
      let items: ScrapeJobInstanceItem[] = []
      let missingCount = 0
      try {
        const inst = await scrapeJobApi.instances(job.id)
        items = inst.data?.items ?? []
        missingCount = inst.data?.missing_count ?? 0
      } catch {
        // 实例拉取失败时保持空实例列表
      }
      let upItems: PromVectorItem[] = []
      let lastItems: PromVectorItem[] = []
      if (deployed && job.job_name) {
        // F-40：并行拉取 up（5min 实时态）与 last_over_time 时间戳（1h 是否出现过样本），
        // 后者失败降级为空数组——此时全部实例按原两态（down/pending）判定，不阻断列表。
        ;[upItems, lastItems] = await Promise.all([
          queryVector(upQueryForJob(job.job_name)),
          queryVector(lastUpQueryForJob(job.job_name)),
        ])
      }
      return [job.id, aggregateView(deployed, items, upItems, missingCount, lastItems)]
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
  }, [jobsKey, tick])

  return map
}
/**
 * Job 实例「采集状态」的 up 指标推导（F-10 数据源收敛）。
 *
 * 背景（F-10）：决策 47-2 原以中心 `GET /api/v1/targets`（M02 代理透传中心 Prometheus
 * 的 target 健康）作为 Job 实例采集状态数据源。该源仅对 **local 通道**成立（中心 Prometheus
 * 亲自 scrape target）；**采集节点域（agent_pull）由边缘 vmagent 抓取、经 remote_write 仅推送
 * 指标样本（`up` 等），不向中心上报 target 元数据**，导致 `/api/v1/targets` 对采集节点域恒空、
 * 前端实例状态误报为空/离线。
 *
 * 收敛口径（定版 A 方案）：Job 实例采集状态一律按中心 `up{job="<job_name>"}` PromQL 推导，
 * 对 local 与边缘（remote_write 上来 `up`）两通道均成立：
 *  - 查到 `up` 样本且值 = "1" → collecting（采集中）
 *  - 查到 `up` 样本且值 = "0" → down（已下发未采到）
 *  - 无该实例的 `up` 样本，但 `timestamp(last_over_time(up[1h]))` 命中 → stale（回传延迟中，F-40）
 *  - 1h 内也无样本 → pending（not monitored / 未采到）
 *
 * F-40（回传延迟三态，2026-10-10）：瞬时查询 `up` 只认 5 分钟 lookback 窗口内的样本；
 * 边缘回传通道积压时（实测 530MB ≈ 2.8h），样本只是「迟到」并非「丢失」，按 pending
 * 「待采集」误导排查方向（把回传问题当采集问题查）。引入第二个查询
 * `timestamp(last_over_time(up{job}[1h]))` 取每序列 1h 内最近一次样本时间：5min 内无样本、
 * 1h 内有 → stale「回传延迟中」（warning），提示用户去节点状态页看「回传积压」而非查采集器。
 *
 * 实例↔序列匹配：优先 `resource_id` 标签回连，缺失时回落主机（host vs instance_ip）匹配。
 *
 * 补充（F-12）：blackbox 拨测 Job 无实例维度，其执行状态看 `probe_success`（1=通过 / 0=失败），
 * 由 `probeQueryForJob` + `probeStatusOfTarget` 提供；`up` 只代表「抓取 blackbox_exporter 是否成功」，
 * 不能表达拨测结果，故拨测 Job 不复用 `statusFromUp`。
 */
import type { PromVectorItem } from '../../types/query'
import type { ScrapeJobInstanceItem } from '../../types/strategy'
import type { JobInstanceScrapeStatus } from './useScrapeJobStatus'

/**
 * 拨测目标（F-12）：来自 `POST /scrape-jobs/:id/preview-targets` 的解析结果，
 * 与生成侧 generator.resolveSelectedInstanceTargets 同源（同一 `selected_instance_ids`
 * + `target_field` 读取入口），故与最终下发的 `__param_target` 地址逐字一致。
 */
export interface ProbeTarget {
  resource_id?: string
  address: string
  protocol?: string
}

/** 从 `instance`（host:port）提取 host（IPv4 / 主机名按最后一个 ':' 截断；无冒号即原值） */
export function hostOf(instance?: string): string {
  if (!instance) return ''
  const idx = instance.lastIndexOf(':')
  return idx === -1 ? instance : instance.slice(0, idx)
}

/** PromQL 标签值转义（job 名可能含引号/反斜杠，双引号字符串内需转义） */
function escapePromQLValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** 构造按 job 过滤的 up 表达式：`up{job="<job_name>"}` */
export function upQueryForJob(jobName: string): string {
  return `up{job="${escapePromQLValue(jobName)}"}`
}

/**
 * 构造按 job 过滤的「最近一次 up 样本时间」表达式（F-40 回传延迟判定）：
 * `timestamp(last_over_time(up{job="<job_name>"}[1h]))`。
 * 返回向量的 value[1] 是各序列 1h 内最近一次样本的 Unix 时间戳（秒），
 * 仅用于「序列是否存在过」的判定，时间值由前端结合服务端时间估算延迟。
 */
export function lastUpQueryForJob(jobName: string): string {
  return `timestamp(last_over_time(up{job="${escapePromQLValue(jobName)}"}[1h]))`
}

/** 从一给定 job 的 up 样本向量推导单个实例的采集状态（F-40 扩展三态）。
 * lastItems 为 `lastUpQueryForJob` 的结果（可选）：5min 窗口无样本、但 1h 内出现过
 * → 'stale'（回传延迟中）；1h 内也没有 → 'pending'。 */
export function statusFromUp(
  upItems: PromVectorItem[],
  it: ScrapeJobInstanceItem,
  lastItems?: PromVectorItem[],
): JobInstanceScrapeStatus {
  // 优先 resource_id 标签回连；无 resource_id 样本回落主机匹配（与决策 47-2 实例↔target 口径一致）
  const match = (items: PromVectorItem[]) => {
    const byRes = items.find((x) => x.metric.resource_id && x.metric.resource_id === it.resource_id)
    return byRes ?? items.find((x) => !x.metric.resource_id && hostOf(x.metric.instance) === it.instance_ip)
  }
  const series = match(upItems)
  if (series) return series.value?.[1] === '1' ? 'collecting' : 'down'
  if (lastItems && match(lastItems)) return 'stale'
  return 'pending'
}

/** 构造按 job 过滤的拨测结果表达式：`probe_success{job="<job_name>"}` */
export function probeQueryForJob(jobName: string): string {
  return `probe_success{job="${escapePromQLValue(jobName)}"}`
}

/**
 * 从一给定 job 的 `probe_success` 样本向量推导单个拨测目标的探测结果（F-12）。
 *
 * 背景：blackbox 拨测 Job 无实例维度，其执行状态看 `probe_success`（1=通过 / 0=失败）；
 * `up` 仅代表「抓取 blackbox_exporter 本身是否成功」，不能表达拨测结果。
 *
 * 匹配口径与 statusFromUp 对齐：优先 `resource_id` 标签回连（拨测 Job 的目标同样
 * 由资源台账选出，生成侧 render.go 把 `__param_target`（=目标地址）复制为 `instance`，
 * 并保留 `resource_id`），缺失时回落按 `instance` 地址匹配。
 */
export function probeStatusOfTarget(probeItems: PromVectorItem[], target: ProbeTarget): JobInstanceScrapeStatus {
  const byRes = target.resource_id
    ? probeItems.find((x) => x.metric.resource_id === target.resource_id)
    : undefined
  const series = byRes ?? probeItems.find((x) => x.metric.instance === target.address)
  if (!series) return 'pending'
  return series.value?.[1] === '1' ? 'collecting' : 'down'
}
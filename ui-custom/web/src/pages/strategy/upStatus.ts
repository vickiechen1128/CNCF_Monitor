/**
 * Job 实例「采集状态」的 up 指标推导（F-10 数据源收敛）。
 *
 * 背景（F-10）：决策 47-2 原以中心 `GET /api/v1/targets`（M02 代理透传中心 Prometheus
 * 的 target 健康）作为 Job 实例采集状态数据源。该源仅对 **local 通道**成立（中心 Prometheus
 * 亲自 scrape target）；**边缘域（agent_pull）由边缘 vmagent 抓取、经 remote_write 仅推送
 * 指标样本（`up` 等），不向中心上报 target 元数据**，导致 `/api/v1/targets` 对边缘域恒空、
 * 前端实例状态误报为空/离线。
 *
 * 收敛口径（定版 A 方案）：Job 实例采集状态一律按中心 `up{job="<job_name>"}` PromQL 推导，
 * 对 local 与边缘（remote_write 上来 `up`）两通道均成立：
 *  - 查到 `up` 样本且值 = "1" → collecting（采集中）
 *  - 查到 `up` 样本且值 = "0" → down（已下发未采到）
 *  - 无该实例的 `up` 样本 → pending（not monitored / 未采到）
 *
 * 实例↔序列匹配：优先 `resource_id` 标签回连，缺失时回落主机（host vs instance_ip）匹配。
 *
 * 补充（F-12）：blackbox 拨测 Job 无实例维度，其执行状态看 `probe_success`（1=通过 / 0=失败），
 * 由 `probeQueryForJob` + `probeStatusOfTarget` 提供；`up` 只代表「抓取 blackbox_exporter 是否成功」，
 * 不能表达拨测结果，故拨测 Job 不复用 `statusFromUp`。
 */
import type { PromVectorItem } from '../../types/query'
import type { BlackboxTarget, ScrapeJobInstanceItem } from '../../types/strategy'
import type { JobInstanceScrapeStatus } from './useScrapeJobStatus'

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

/** 从一给定 job 的 up 样本向量推导单个实例的采集状态 */
export function statusFromUp(upItems: PromVectorItem[], it: ScrapeJobInstanceItem): JobInstanceScrapeStatus {
  // 优先 resource_id 标签回连；无 resource_id 样本回落主机匹配（与决策 47-2 实例↔target 口径一致）
  const byRes = upItems.find((x) => x.metric.resource_id && x.metric.resource_id === it.resource_id)
  const series = byRes ?? upItems.find((x) => !x.metric.resource_id && hostOf(x.metric.instance) === it.instance_ip)
  if (!series) return 'pending'
  return series.value?.[1] === '1' ? 'collecting' : 'down'
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
 * 匹配口径：`probe_success` 的 `instance` 标签即拨测目标地址，优先用 `url`（含协议头形态），
 * 回落 `target`（无协议头形态）。
 */
export function probeStatusOfTarget(probeItems: PromVectorItem[], target: BlackboxTarget): JobInstanceScrapeStatus {
  const series =
    probeItems.find((x) => x.metric.instance === target.url) ?? probeItems.find((x) => x.metric.instance === target.target)
  if (!series) return 'pending'
  return series.value?.[1] === '1' ? 'collecting' : 'down'
}
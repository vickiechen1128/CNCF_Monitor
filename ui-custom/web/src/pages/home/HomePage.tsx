/**
 * 首页概览 —— **六段信息架构**（Module_05 §3.1 决策 93 / PRD v1.8）。
 *
 * 页面结构（自上而下）：页头行（引导语 + 系统状态）→ **L0 全局态势区**（5 张 KPI 卡，
 * 含「拨测」）→ **L1 采集覆盖区**（5 张资源类型卡一行，子类封顶 3 + 更多）→ **L2 应用覆盖表**
 * （覆盖率升序，未归类行置底）→ **L3 拨测态势面板** → **L4 告警状态卡 + L5 使用指引
 * （同排等高：左告警 1.6 : 右指引 1）**。
 *
 * 与 v1.7 的差异（决策 93）：L0 由 4 卡扩为 5 卡（新增「拨测」）；删「按应用查看」入口卡与
 * L1 未恢复胶囊、L2 未恢复列（告警口径收口 L0 告警卡 + L4 告警卡）；L2 改「应用覆盖」；
 * 新增 L3 拨测态势面板；告警卡与使用指引由两根整宽行改为同排等高。
 *
 * 版式约束：
 * - 页面按内容自然排布，**不锁定视口**：不同电脑尺寸/分辨率下版式一致，内容超出即滚动；
 * - L0 / L1 均 5 卡一行：栅格走 antd Col `flex:1` 等宽方案，容量变化不溢出；
 * - 告警卡固定 5 行/页为**定稿硬契约**（见 homeLayout.ts，已与视口解耦）。
 *
 * 数据源：
 * - dashboardApi.getSummary()：资源总数 / 已监控（L0）、by_category（L1）、
 *   by_app + unclassified_*（L2）、probe_target_count / probe_target_abnormal_count（L0 拨测卡）；
 * - alertStatusApi 三条只读链路**单次请求**由 useAlertGovernance 持有：
 *   Prom 当前告警（L0 第 4 卡的 firing 条数）+ AM 通知状态 + M02 历史告警。
 * - L3 拨测态势实测来自 `dashboard.probe_targets[]`（决策 93 明细），由 HomePage 传入 ProbePanel
 *   受控渲染；静态预览（VITE_STATIC_PREVIEW=true）仍用 DASHBOARD_MOCK 明细与原型对齐。前端排序、分页，
 *   见 ProbePanel 头注释。
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Col, Row, Space, Tooltip, Typography, theme } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { apiClient } from '../../api/client'
import { dashboardApi } from '../../api/dashboard'
import { useProductName } from '../../skinContext'
import type { DashboardSummary } from '../../api/dashboard'
import { alertStatusApi, ALERT_HISTORY_STEP_SECONDS } from '../../api/alertmanager'
import type {
  AlertHistoryData,
  AmAlertItem,
  AmAlertsData,
  PromAlertItem,
  PromAlertsData,
} from '../../types/alertmanager'
import type { ApiResponse } from '../../types/api'
import { MainLayout } from '../../layouts/MainLayout'
import { LoadingPlaceholder } from '../../components/LoadingPlaceholder'
import { AlertStatusCard, LATEST_ALERT_LIMIT } from './AlertStatusCard'
import type { AlertCounts } from './AlertStatusCard'
import { alertMatchKey } from '../alerts/alertmanagerConstants'
import { OnboardingSteps } from './OnboardingSteps'
import { SurfaceCard } from './SurfaceCard'
import { ResourceTypeGrid } from './ResourceTypeGrid'
import { AppDetailTable } from './AppDetailTable'
import { ProbePanel } from './ProbePanel'
import { firingAlerts as pickFiringAlerts } from './resourceTypeMeta'

interface Status {
  version: string
  mode: string
}

/** 最新告警条数上限取自 AlertStatusCard.LATEST_ALERT_LIMIT（告警卡标题与本页截断共用一份） */

const STATUS_MOCK: Status = {
  version: 'dev-preview',
  mode: 'static-preview',
}

/**
 * 静态预览（无后端）用的聚合样例。数值与原型 `docs/prototypes/module-05/src/mocks/module-05.ts`
 * 逐项一致，便于生产页与原型同屏对照走查；同时满足全部不变量：
 * - `sum(by_category.resource_count) = 128 = resource_count`；`sum(monitored) = 96 = monitored_count`
 *   （42/36 主机 + 26/21 数据库 + 18/12 中间件 + 34/22 应用服务 + 8/5 其他监控目标）；
 * - `sum(by_app.resource_count) + unclassified_resource_count = 80 + 48 = 128`；
 *   `sum(by_app.monitored_count) + unclassified_monitored_count = 60 + 36 = 96`；
 * - `probe_target_count = 24` **不进** `resource_count`（拨测口径）。
 */
const DASHBOARD_MOCK: DashboardSummary = {
  resource_count: 128,
  monitored_count: 96,
  scrape_job_count: 0,
  scrape_job_enabled_count: 0,
  pending_draft_count: 0,
  recent_deployments: [],
  domain_count: 0,
  by_category: [
    {
      resource_category: 'host',
      resource_count: 42,
      monitored_count: 36,
      by_subtype: [
        { subtype: 'linux', resource_count: 34, monitored_count: 30 },
        { subtype: 'windows', resource_count: 8, monitored_count: 6 },
      ],
    },
    {
      resource_category: 'database',
      resource_count: 26,
      monitored_count: 21,
      by_subtype: [
        { subtype: 'mysql', resource_count: 14, monitored_count: 12 },
        { subtype: 'redis', resource_count: 9, monitored_count: 8 },
        // 覆盖率 33% < 70%：静态预览用来看「橙色警示子类行」这一分支
        { subtype: 'oracle', resource_count: 3, monitored_count: 1 },
      ],
    },
    {
      resource_category: 'middleware',
      resource_count: 18,
      monitored_count: 12,
      by_subtype: [
        { subtype: 'kafka', resource_count: 8, monitored_count: 6 },
        { subtype: 'nginx', resource_count: 6, monitored_count: 4 },
        { subtype: 'elasticsearch', resource_count: 4, monitored_count: 2 },
      ],
    },
    {
      // 应用服务不设子类：by_subtype 恒为空数组（不按语言 / 框架拆）
      resource_category: 'application',
      resource_count: 34,
      monitored_count: 22,
      by_subtype: [],
    },
    {
      resource_category: 'generic_target',
      resource_count: 8,
      monitored_count: 5,
      by_subtype: [
        { subtype: 'snmp', resource_count: 4, monitored_count: 3 },
        { subtype: 'k8s', resource_count: 3, monitored_count: 2 },
        { subtype: 'custom_http', resource_count: 1, monitored_count: 0 },
      ],
    },
  ],
  by_app: [
    { app_code: 'payment', app_name: '支付平台', biz_code: 'pay', biz_name: '支付业务', resource_count: 30, monitored_count: 24 },
    { app_code: 'user', app_name: '用户中心', biz_code: 'user', biz_name: '用户业务', resource_count: 24, monitored_count: 16 },
    { app_code: 'data-api', app_name: '数据网关', biz_code: 'data', biz_name: '数据服务', resource_count: 26, monitored_count: 20 },
  ],
  unclassified_resource_count: 48,
  unclassified_monitored_count: 36,
  probe_target_count: 12,
  // 后端 MVP 恒 0；静态预览取 1 是为了把「异常 >0」这一分支也渲染出来（口径不变）
  probe_target_abnormal_count: 1,
  // L3 明细（决策 93）：静态预览 mock，覆盖「异常排前」「归属网域」与 >5 条分页分支；
  // 归属口径为「归属网域」（见 design-proposals/probe-ownership-alignment.md：拨测不承载
  // 应用/业务域维度）。mock 走 up/down 显式态，真实环境无 probe_success 样本时为空串（见 ProbePanel 头注释）
  probe_targets: [
    { url: 'https://pay-api.example.cn/healthz', status: 'down', network_domain_id: 'mc-prod-intranet', network_domain_name: '生产内网域', last_probe_at: '2026-09-19T09:36:00+08:00' },
    { url: 'https://www.example.cn/cert-check', status: 'down', network_domain_id: 'mc-prod-intranet', network_domain_name: '生产内网域', last_probe_at: '2026-09-19T09:27:00+08:00' },
    { url: 'https://www.example.cn/', status: 'up', network_domain_id: 'mc-prod-intranet', network_domain_name: '生产内网域', last_probe_at: '2026-09-19T09:38:00+08:00' },
    { url: 'https://data-api.example.cn/health', status: 'up', network_domain_id: 'mc-edge-debug', network_domain_name: '腾讯云调试边缘域', last_probe_at: '2026-09-19T09:38:00+08:00' },
    { url: 'https://order.example.cn/submit', status: 'up', network_domain_id: 'mc-prod-intranet', network_domain_name: '生产内网域', last_probe_at: '2026-09-19T09:37:00+08:00' },
    { url: 'tcp://mysql.pay.example.cn:3306', status: 'up', network_domain_id: 'mc-prod-intranet', network_domain_name: '生产内网域', last_probe_at: '2026-09-19T09:37:00+08:00' },
    { url: 'https://gateway.example.cn/v1/ping', status: 'up', network_domain_id: 'mc-edge-debug', network_domain_name: '腾讯云调试边缘域', last_probe_at: '2026-09-19T09:36:00+08:00' },
  ],
}

const ALERT_MOCK: AlertCounts = {
  today: 12,
  week: 38,
  active: 2,
  silenced: 1,
  inhibited: 0,
  unprocessed: 0,
  // 与 ALERT_MOCK_ALERTS 的 firing 条数保持一致（静态预览下 L0 第 4 卡即由此得出）
  firing: 5,
  pending: 1,
}

/**
 * 静态预览用 Prom 当前告警样例（`/api/v1/alerts` 的响应项）。
 *
 * 覆盖四类归属，供 L0 / L1 / L2 三处「未恢复」分组断言：
 * host 1 + database 1 + application 1 + generic_target 1（共 4 条带 `resource_category`）
 * + 1 条**无 `resource_category`**（拨测目标告警，只进 L1 入口卡附注，不进任何类型卡）。
 * 另含 1 条 `pending`（求值中）——**不计入任何「未恢复」数字**，用于验证只取 `firing`。
 */
const ALERT_MOCK_ALERTS: PromAlertItem[] = [
  {
    labels: { alertname: '主机 CPU 使用率过高', severity: 'critical', instance: '10.0.0.11:9100' },
    annotations: { summary: 'CPU 使用率 92%，超过阈值 85% 已持续 5 分钟' },
    state: 'firing',
    activeAt: '2026-09-18T09:32:00Z',
    resource_category: 'host',
    resource_name: 'prod-web-01',
  },
  {
    labels: {
      alertname: '数据库连接数接近上限',
      severity: 'warning',
      instance: '10.0.1.6:3306',
      app: 'payment',
    },
    annotations: { summary: '当前连接数 480 / 上限 500，新增连接将被拒绝' },
    state: 'firing',
    activeAt: '2026-09-18T08:20:00Z',
    resource_category: 'database',
    resource_name: 'prod-mysql-01',
  },
  {
    labels: {
      alertname: '服务健康检查失败',
      severity: 'critical',
      instance: 'http://order-svc:8080/health',
      app: 'user',
    },
    annotations: { summary: 'HTTP 探针连续 3 次超时（>3s）' },
    state: 'firing',
    activeAt: '2026-09-18T08:58:00Z',
    resource_category: 'application',
    resource_name: 'order-service-v2',
  },
  {
    labels: { alertname: '端点探测超时', severity: 'warning', instance: 'tcp://10.0.5.7:9200' },
    annotations: { summary: 'TCP 探测连续 5 次超时' },
    state: 'firing',
    activeAt: '2026-09-18T08:10:00Z',
    resource_category: 'generic_target',
    resource_name: 'es-endpoint-01',
  },
  {
    // 拨测目标告警：无 resource_category → 只进 L1 入口卡附注
    labels: { alertname: '拨测失败', severity: 'critical', instance: 'http://portal/health' },
    annotations: { summary: 'HTTP 拨测连续 3 次失败' },
    state: 'firing',
    activeAt: '2026-09-18T07:52:00Z',
  },
  {
    // 求值中：不计入任何「未恢复」数字
    labels: { alertname: '磁盘空间不足', severity: 'warning', instance: '10.0.1.5:9100' },
    annotations: { summary: '数据盘使用率 88%' },
    state: 'pending',
    activeAt: '2026-09-18T09:50:00Z',
    resource_category: 'host',
    resource_name: 'prod-db-01',
  },
]

/**
 * 静态预览用最新告警样例（无后端时保持告警卡形态完整，数量与卡内上限一致便于校验行高与「查看全部」语义）。
 * 每条携带 annotations.summary（行 2 告警具体内容）与 labels.instance（history 回查键的一半）。
 */
const ALERT_MOCK_LATEST: AmAlertItem[] = [
  {
    labels: { alertname: '主机 CPU 使用率过高', severity: 'critical', instance: '10.0.0.11:9100' },
    annotations: { summary: 'CPU 使用率 92%，超过阈值 85% 已持续 5 分钟' },
    starts_at: '2026-09-18T09:32:00Z',
    resource_name: 'prod-web-01',
    notify_status: 'active',
  },
  {
    labels: { alertname: '节点离线', severity: 'critical', instance: '10.0.2.7:9100' },
    annotations: { summary: '节点已 60 秒无响应，疑似断网或采集进程异常' },
    starts_at: '2026-09-18T09:28:00Z',
    resource_name: 'edge-node-03',
    notify_status: 'active',
  },
  {
    labels: { alertname: '磁盘空间不足', severity: 'warning', instance: '10.0.1.5:9100' },
    annotations: { summary: '数据盘使用率 91%，预计 6 小时后写满' },
    starts_at: '2026-09-18T09:15:00Z',
    resource_name: 'prod-db-01',
    notify_status: 'active',
  },
  {
    labels: { alertname: '服务拨测失败', severity: 'critical', instance: 'http://order-svc:8080/health' },
    annotations: { summary: 'HTTP 探针连续 3 次超时（>3s）' },
    starts_at: '2026-09-18T08:58:00Z',
    resource_name: 'order-service-v2',
    notify_status: 'silenced',
  },
  {
    labels: { alertname: '内存使用率偏高', severity: 'warning', instance: '10.0.3.9:9100' },
    annotations: { summary: '内存使用率 88%，接近告警阈值 90%' },
    starts_at: '2026-09-18T08:40:00Z',
    resource_name: 'redis-cache-01',
    notify_status: 'inhibited',
  },
  {
    labels: { alertname: '数据库连接数接近上限', severity: 'warning', instance: '10.0.1.6:3306' },
    annotations: { summary: '当前连接数 480 / 上限 500，新增连接将被拒绝' },
    starts_at: '2026-09-18T08:20:00Z',
    resource_name: 'prod-mysql-01',
    notify_status: 'active',
  },
  {
    labels: { alertname: 'Kafka 消费延迟增长', severity: 'warning', instance: '10.0.4.2:9092' },
    annotations: { summary: '消费组 order-group 积压 12 万条，延迟 8 分钟' },
    starts_at: '2026-09-18T07:40:00Z',
    resource_name: 'kafka-broker-02',
    notify_status: 'active',
  },
  {
    labels: { alertname: 'Nginx 上游健康检查失败', severity: 'info', instance: 'http://nginx-01/status' },
    annotations: { summary: '上游 app-03 连续 5 次健康检查失败' },
    starts_at: '2026-09-18T07:00:00Z',
    resource_name: 'nginx-01',
    notify_status: 'silenced',
  },
]

const IS_STATIC_PREVIEW = import.meta.env.VITE_STATIC_PREVIEW === 'true'

/**
 * 告警排序用时间戳：缺失或非法 `starts_at` 计 0（排到末位），
 * 避免 `dayjs(undefined)` 视作「当前时间」而把无时间条目顶到最前、或 NaN 比较器导致顺序不定。
 */
function alertTime(iso?: string): number {
  if (!iso) return 0
  const d = dayjs(iso)
  return d.isValid() ? d.valueOf() : 0
}

/**
 * 单数据源取数结果归一：网络异常与业务错误信封（status: 'error'）统一转 error，
 * 不静默吞 0（决策 68-2：AM 未挂载时数字恒为 0，必须与「请求失败」区分）。
 */
function toSourceState<T>(
  settled: PromiseSettledResult<ApiResponse<T>>,
): { res: ApiResponse<T> | null; error: string | null } {
  if (settled.status === 'rejected') {
    const reason: unknown = settled.reason
    return { res: null, error: reason instanceof Error ? reason.message : String(reason) }
  }
  if (settled.value.status === 'success') {
    return { res: settled.value, error: null }
  }
  return { res: null, error: settled.value.error || '请求失败' }
}

/** 近 7 天告警窗口（决策 73：与 M02 history 服务端最大时间窗一致） */
const HISTORY_WINDOW_DAYS = 7

/** history 单页取数上限（服务端 maxHistoryPageSize = 200，一次拉满减少分页往返） */
const HISTORY_PAGE_SIZE = 200

/**
 * 历史告警取数参数：窗口按服务端上限 7d（决策 73 只关心当日 / 近 7 天）。
 *
 * - **必须显式传 `step`（决策 90）**：取 `ALERT_HISTORY_STEP_SECONDS`（30s，PRD 默认细粒度）。
 *   本卡窗口恒为 7d，7d ÷ 30s = 20160 点超过 Prometheus 单序列 11000 点上限 → 上游 400 →
 *   本卡「当日 / 近 7 天告警」两格恒为 0（2026-09-18 实测缺陷）；服务端会按窗口把 30s 抬高到
 *   55s 兜底，但调用侧仍显式传值，避免行为依赖服务端默认；
 * - 窗口直接取整 7d：服务端会把 > 7d 的窗口压缩为 `[end-7d, end]`，故多加容差无实际效果，
 *   反而是让 `total` 与「近 7 天」口径严格一致的前提（见 computeHistoryCounts）。
 */
function historyQuery(): { start: string; end: string; step: number; page: number; page_size: number } {
  const now = dayjs()
  return {
    start: now.subtract(HISTORY_WINDOW_DAYS, 'day').toISOString(),
    end: now.toISOString(),
    step: ALERT_HISTORY_STEP_SECONDS,
    page: 1,
    page_size: HISTORY_PAGE_SIZE,
  }
}

/** fired_at 时间戳：缺失 / 非法计 0（不落入「今日」或「近 7 天」计数，也不抛错） */
function firedAt(value?: string): number {
  if (!value) return 0
  const d = dayjs(value)
  return d.isValid() ? d.valueOf() : 0
}

/**
 * 历史告警计数（决策 73 §1，决策 90 修订）：当日 = fired_at ≥ 今日 0 点；近 7 天 = 服务端窗口总量。
 *
 * **「近 7 天」直接取服务端 `total`**：请求窗口与「近 7 天」口径严格一致（7d，服务端裁剪后
 * 亦为 `[end-7d, end]`），`total` 即该窗口内的触发区间总数。原实现把 `total` 与前端**按渲染
 * 时刻**重算边界的 `inWindow` 做大小比较，两个边界不同源（渲染时刻晚于请求时刻），导致 7d
 * 边界外刚过期的记录被计入，与卡片文案「近 7 天」不符 —— 取消该混用。
 * 单页上限（200）截断的只是**列表**且按触发时间倒序（丢的是最旧记录），故 `today` 仍由当前页
 * 统计；`total` 缺失（契约异常）时回落为页内条目数。
 *
 * 字段缺失（无 list）返回 null，由调用方把两格降级为 '-'（不显示 0）。
 */
function computeHistoryCounts(
  res: ApiResponse<AlertHistoryData> | null,
): { today: number; week: number } | null {
  const items = res?.data?.list
  if (!Array.isArray(items)) return null

  const dayStart = dayjs().startOf('day').valueOf()
  const today = items.filter((item) => firedAt(item.fired_at) >= dayStart).length
  const total = res?.data?.total
  const week = typeof total === 'number' ? total : items.length
  return { today, week }
}

/**
 * 行 2 告警具体内容回查表（决策 73 §3）：M02 history 的 summary 优先，AM annotations.summary 兜底。
 * 键由 alertMatchKey（告警名 + 采集地址）生成，与告警卡取值端共用一份逻辑。
 */
function buildSummaryMap(res: ApiResponse<AlertHistoryData> | null): Record<string, string> {
  const items = res?.data?.list
  if (!Array.isArray(items)) return {}
  const map: Record<string, string> = {}
  for (const item of items) {
    const summary = item.summary?.trim()
    if (!summary) continue
    const key = alertMatchKey(item.alertname, item.instance)
    // 同一告警名 + 实例可能有多段触发区间：保留最近一段（history 按时间倒序返回时首条即最新）
    if (!(key in map)) map[key] = summary
  }
  return map
}

/** 告警计数：AM 通知四态（active / silenced / inhibited / unprocessed）+ Prom 触发态 */
function computeCounts(
  promRes: ApiResponse<PromAlertsData> | null,
  amRes: ApiResponse<AmAlertsData> | null,
): Omit<AlertCounts, 'today' | 'week'> {
  // promRes / amRes 仅在信封 status === 'success' 时被写入（见 toSourceState），
  // 业务错误信封不会静默计 0，而是走 promError / amError 呈现。
  const promAlerts: PromAlertItem[] = promRes?.data?.alerts ?? []
  const amAlerts: AmAlertItem[] = amRes?.data?.items ?? []
  return {
    active: amAlerts.filter((i) => i.notify_status === 'active').length,
    silenced: amAlerts.filter((i) => i.notify_status === 'silenced').length,
    inhibited: amAlerts.filter((i) => i.notify_status === 'inhibited').length,
    unprocessed: amAlerts.filter((i) => i.notify_status === 'unprocessed').length,
    firing: promAlerts.filter((a) => a.state === 'firing').length,
    pending: promAlerts.filter((a) => a.state === 'pending').length,
  }
}

interface AlertGovernance {
  counts: AlertCounts
  /**
   * 当前仍在触发（`state === 'firing'`）的告警全量。
   * **L0 第 4 卡 / L1 各类型卡胶囊 / L1 入口卡附注 / L2 行「未恢复」的唯一取数来源**——
   * 均在本数组上按 `resource_category` / 标签 `app` 分组（决策 91，前端分组、后端零改动）。
   */
  firingAlerts: PromAlertItem[]
  /** 最新告警：AM 条目按 starts_at 倒序取前 LATEST_ALERT_LIMIT 条，剔除 unprocessed（治理闭环 MVP 未实现） */
  latestAlerts: AmAlertItem[]
  /** 行 2 告警具体内容回查表（history summary 优先，AM annotations.summary 兜底） */
  summaryByAlert: Record<string, string>
  loading: boolean
  promError: string | null
  amError: string | null
  /** history 链路错误：当日 / 近 7 天两格降级为 '-'，不影响 AM / Prom 展示 */
  historyError: string | null
  retry: () => void
}

/**
 * 首页告警治理态取数（三条只读链路各单次请求持有）。
 * allSettled：任一端点失败不丢弃其他端点已成功数据，失败源局部降级提示。
 */
function useAlertGovernance(
  isStaticPreview: boolean,
  mockCounts: AlertCounts,
  mockLatest: AmAlertItem[],
  mockAlerts: PromAlertItem[],
): AlertGovernance {
  const [promRes, setPromRes] = useState<ApiResponse<PromAlertsData> | null>(null)
  const [amRes, setAmRes] = useState<ApiResponse<AmAlertsData> | null>(null)
  const [historyRes, setHistoryRes] = useState<ApiResponse<AlertHistoryData> | null>(null)
  const [promError, setPromError] = useState<string | null>(null)
  const [amError, setAmError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [loading, setLoading] = useState(() => !isStaticPreview)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    if (isStaticPreview) {
      return
    }
    let cancelled = false
    Promise.allSettled([
      alertStatusApi.getPromAlerts(),
      alertStatusApi.getAlertmanagerAlerts(),
      alertStatusApi.getAlertHistory(historyQuery()),
    ]).then(([prom, am, history]) => {
      if (cancelled) return
      const p = toSourceState(prom)
      const a = toSourceState(am)
      const h = toSourceState(history)
      setPromRes(p.res)
      setAmRes(a.res)
      setHistoryRes(h.res)
      setPromError(p.error)
      setAmError(a.error)
      // 字段缺失（信封成功但无 list）同样视为不可用：两格显示 '-' 而非 0
      setHistoryError(
        h.error ?? (Array.isArray(h.res?.data?.list) ? null : '历史告警响应缺少列表字段'),
      )
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [isStaticPreview, retryKey])

  const counts = useMemo(() => {
    if (isStaticPreview) {
      return mockCounts
    }
    const history = computeHistoryCounts(historyRes)
    return {
      ...computeCounts(promRes, amRes),
      // history 不可用时由 AlertStatusCard 按 historyError 渲染 '-'，此处仅提供占位数值
      today: history?.today ?? 0,
      week: history?.week ?? 0,
    }
  }, [isStaticPreview, mockCounts, promRes, amRes, historyRes])

  const latestAlerts = useMemo(() => {
    if (isStaticPreview) {
      return mockLatest
    }
    const items = amRes?.data?.items ?? []
    return items
      .filter((i) => i.notify_status !== 'unprocessed')
      .sort((a, b) => alertTime(b.starts_at) - alertTime(a.starts_at))
      .slice(0, LATEST_ALERT_LIMIT)
  }, [isStaticPreview, mockLatest, amRes])

  /**
   * 当前未恢复（firing）告警全量：L0 第 4 卡与 L1 / L2 三处分组的**同一份**数据。
   * 取数失败（promError 非空）时为空数组 → 各处按不可用降级为 `-`。
   */
  const firingAlerts = useMemo(
    () => pickFiringAlerts(isStaticPreview ? mockAlerts : promRes?.data?.alerts ?? []),
    [isStaticPreview, mockAlerts, promRes],
  )

  const summaryByAlert = useMemo(
    () => (isStaticPreview ? {} : buildSummaryMap(historyRes)),
    [isStaticPreview, historyRes],
  )

  const retry = () => {
    // 静态预览无后端：effect 提前 return，置 loading 会永久停在加载态，直接短路
    if (isStaticPreview) return
    setLoading(true)
    setPromError(null)
    setAmError(null)
    setHistoryError(null)
    setRetryKey((k) => k + 1)
  }

  return { counts, firingAlerts, latestAlerts, summaryByAlert, loading, promError, amError, historyError, retry }
}

interface MetricItem {
  key: string
  label: string
  value: ReactNode
  /** 口径注释（卡片右上角 ⓘ Tooltip 文案，决策 72-3 §3.2） */
  tip?: string
  /** 副行说明（11px 灰字） */
  sub?: string
  /** 传入时以**进度条**替代副行文字（目前仅「整体覆盖率」） */
  progress?: number
  /** 告警卡：浅红底 + 浅红边，与三张资产卡视觉分离 */
  danger?: boolean
  /** 数字语义色 */
  valueColor?: string
}

/**
 * 关键指标卡（**版式按排版定版**，与原型 DashboardPage.GlobalStatCard 同款）：
 * 标签 12px 在上 → 30px/800 数字 → 11px 副行说明，**卡内不放图标容器**——
 * 数字已经是卡内唯一视觉主体，图标只会与它争视觉权重、让扫读变慢。
 *
 * - 「整体覆盖率」用**进度条**替代副行文字：百分数需要一段横向长度才有「进度感」，
 *   口径文字（「已纳入监控 ÷ 资源总数」）收进 ⓘ，不重复占版面；
 * - 第 4 卡（告警）用浅红底 + 浅红边：它表达的是「异常数」而不是「资产数」，
 *   与前 3 张分开，扫读时才不会被当成第四种资产。
 * - 卡高由内容决定，不锁死视口相关高度。
 */
function MetricCard({ item }: { item: MetricItem }) {
  const { token } = theme.useToken()
  const percent = item.progress

  return (
    <SurfaceCard
      hoverShadow
      data-testid={`metric-${item.key}`}
      style={{
        position: 'relative',
        height: '100%',
        ...(item.danger ? { background: token.colorErrorBg, borderColor: token.colorErrorBorder } : {}),
      }}
      styles={{ body: { padding: '14px 16px' } }}
    >
      {/* 标签行 */}
      <div
        style={{
          fontSize: 12,
          color: item.danger ? token.colorErrorText : token.colorTextSecondary,
          whiteSpace: 'nowrap',
        }}
      >
        {item.label}
      </div>

      {/* 数字：30px/800 等宽数字，卡内唯一视觉主体 */}
      <div
        style={{
          marginTop: 8,
          fontSize: 30,
          fontWeight: 800,
          lineHeight: 1.15,
          color: item.valueColor ?? token.colorText,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {item.value}
      </div>

      {percent === undefined ? (
        <div
          style={{ marginTop: 4, fontSize: 11, color: token.colorTextTertiary, whiteSpace: 'nowrap' }}
        >
          {item.sub}
        </div>
      ) : (
        <div
          data-testid={`l0-bar-${item.key}`}
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`整体覆盖率 ${percent}%`}
          style={{
            marginTop: 12,
            height: 6,
            borderRadius: 3,
            background: token.colorFillSecondary,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${Math.min(100, Math.max(0, percent))}%`,
              height: '100%',
              borderRadius: 3,
              background: token.colorPrimary,
            }}
          />
        </div>
      )}

      {/* 口径注释：仅 tip 非空时渲染；可聚焦 + aria-label，保证键盘用户也能读到口径说明 */}
      {item.tip && (
        <Tooltip title={item.tip}>
          <InfoCircleOutlined
            data-testid={`metric-tip-${item.key}`}
            tabIndex={0}
            aria-label={item.tip}
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              fontSize: 13,
              color: item.danger ? token.colorErrorText : token.colorTextTertiary,
              cursor: 'help',
            }}
          />
        </Tooltip>
      )}
    </SurfaceCard>
  )
}

export function HomePage() {
  // 引导语中的产品名随「外观设置」变化（用户 2026-09-18 补充）
  const { productName } = useProductName()
  // L0 数字语义色（覆盖率品牌青 / 告警语义红）与卡片色取自主题 token，不硬编码
  const { token } = theme.useToken()
  const [status, setStatus] = useState<Status | null>(() => (IS_STATIC_PREVIEW ? STATUS_MOCK : null))
  const [error, setError] = useState<string | null>(null)

  const [dashboard, setDashboard] = useState<DashboardSummary | null>(() =>
    IS_STATIC_PREVIEW ? DASHBOARD_MOCK : null,
  )
  const [dashboardLoading, setDashboardLoading] = useState(() => !IS_STATIC_PREVIEW)
  const [dashboardError, setDashboardError] = useState<string | null>(null)

  const {
    counts,
    firingAlerts,
    latestAlerts,
    summaryByAlert,
    loading: alertLoading,
    promError,
    amError,
    historyError,
    retry,
  } = useAlertGovernance(IS_STATIC_PREVIEW, ALERT_MOCK, ALERT_MOCK_LATEST, ALERT_MOCK_ALERTS)

  useEffect(() => {
    // Vercel 静态预览环境没有后端，不发起请求
    if (IS_STATIC_PREVIEW) {
      return
    }

    apiClient
      .get<Status>('/api/v1/status')
      .then((res) => {
        if (res.status === 'success') {
          setStatus(res.data)
        } else {
          setError(res.error || '请求失败')
        }
      })
      .catch((err: Error) => {
        setError(err.message)
      })
  }, [])

  useEffect(() => {
    if (IS_STATIC_PREVIEW) {
      return
    }

    dashboardApi
      .getSummary()
      .then((res) => {
        if (res.status === 'success') {
          setDashboard(res.data)
        } else {
          setDashboardError(res.error || '请求失败')
        }
        setDashboardLoading(false)
      })
      .catch((err: Error) => {
        setDashboardError(err.message)
        setDashboardLoading(false)
      })
  }, [])

  // 取数失败（含字段缺失）统一显示 '-'，不把失败静默成 0、也不渲染 NaN%
  // （决策 72-3 §3.2 失败态 / 决策 91 §11.3「接口失败时对应数字显示 -」）
  const metricNumber = (value?: number): number | undefined =>
    typeof value === 'number' && !Number.isNaN(value) ? value : undefined
  const metricValue = (value?: number): ReactNode => metricNumber(value) ?? '-'

  // 整体覆盖率：已纳入监控 ÷ 资源总数，取整百分数；任一字段缺失或资源数为 0 时显示 '-'
  // （不渲染 0% / NaN%），前端派生无需新字段（口径按 PRD §「L0 关键指标卡口径」）
  const resourceTotal = metricNumber(dashboard?.resource_count)
  const monitoredTotal = metricNumber(dashboard?.monitored_count)
  // 覆盖率数值（进度条用；无数据时 undefined → 卡片显示 '-'，进度条按 0 渲染）
  const coveragePercent =
    resourceTotal !== undefined && resourceTotal > 0 && monitoredTotal !== undefined
      ? Math.round((monitoredTotal / resourceTotal) * 100)
      : undefined
  const coverage = coveragePercent !== undefined ? `${coveragePercent}%` : '-'

  /**
   * L0 第 4 卡「当前未恢复告警」：`/api/v1/alerts` 中 `state === 'firing'` 的条数。
   * Prom 链路失败时显示 `-`（不显示 0——0 是「确实没有未恢复告警」的有效取值）。
   */
  const firingCount = promError ? '-' : firingAlerts.length

  /**
   * L0 四张 KPI 卡（决策 91：6 张收敛为 4 张，采集 Job / 已纳管网域 / 待确认草稿下沉出首页；
   * 版式按排版定版：无图标容器、覆盖率走进度条、告警卡浅红底）。
   */
  const metrics: MetricItem[] = [
    {
      key: 'resource_count',
      label: '资源总数',
      value: metricValue(dashboard?.resource_count),
      sub: '五类台账合计',
      tip: '已导入平台的监控资源总数（主机 / 数据库 / 中间件 / 应用服务 / 其他监控目标五类合计），拨测目标不计入。',
    },
    {
      key: 'monitored_count',
      label: '已纳入监控',
      value: metricValue(dashboard?.monitored_count),
      // 副行给「未纳管 N」——比重复口径文字更有信息量（口径收进 ⓘ）
      sub:
        resourceTotal !== undefined && monitoredTotal !== undefined
          ? `未纳管 ${Math.max(0, resourceTotal - monitoredTotal)}`
          : undefined,
      tip: '至少被一个已启用的采集任务覆盖到的资源数；其余为尚未纳管的资源。',
    },
    {
      key: 'coverage',
      label: '整体覆盖率',
      value: coverage,
      tip: '已纳入监控资源数 ÷ 资源总数，反映当前纳管进度；拨测目标不参与计算。',
      valueColor: token.colorPrimary,
      progress: coveragePercent ?? 0,
    },
    {
      key: 'firing_count',
      label: '告警',
      value: firingCount,
      sub: '当前未恢复',
      tip: '此刻仍在触发、尚未恢复的告警条数，含不属于资源台账对象的拨测与聚合告警。',
      valueColor: token.colorError,
      danger: true,
    },
    {
      // 决策 93：第 5 张卡「拨测」。值 = 拨测异常目标数（probe_target_abnormal_count）
      key: 'probe',
      label: '拨测',
      value: metricValue(dashboard?.probe_target_abnormal_count),
      sub:
        dashboard?.probe_target_count !== undefined
          ? `/ ${dashboard.probe_target_count} 个拨测目标 · 异常数`
          : undefined,
      tip: '当前探测失败的拨测目标数；拨测由 blackbox 采集任务承载，不计入资源台账与覆盖率。全量明细见下方拨测态势面板。',
      valueColor:
        (dashboard?.probe_target_abnormal_count ?? 0) > 0 ? token.colorError : token.colorText,
    },
  ]

  return (
    <MainLayout>
      {/* 内容自然高度：根容器纵向 flex 排布页头行 / L0 / L1 / L2 / 告警卡 / 使用指引，
          但**不锁定视口高度**——视口够高时视觉上仍接近一屏，视口矮或内容多时正常滚动，
          不做裁切、不拉伸卡片。gap 用 16，与卡片 gutter 一致。 */}
      <div
        data-testid="home-page"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* 页头行：左引导语 + 右系统状态（版本 / 模式） */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          {/* 页面引导语：页面归属已由左侧导航与面包屑表达，不再重复「MetricCenter 概览」大标题。
              引导语描述「本页有什么」，不指代下方区域。 */}
          <Typography.Text type="secondary" style={{ fontSize: 14 }}>
            欢迎回到 {productName}，这里汇总监控资源、采集任务与告警的整体运行情况
          </Typography.Text>
          {/* 系统状态标注：版本 / 模式，右对齐在页头行 */}
          {(status || error) && (
            <Typography.Text
              type={error ? 'danger' : 'secondary'}
              style={{ fontSize: 12, whiteSpace: 'nowrap' }}
            >
              <Space size={16}>
                {status && <span>版本 {status.version}</span>}
                {status && <span>模式 {status.mode}</span>}
                {error && <span>状态加载失败：{error}</span>}
              </Space>
            </Typography.Text>
          )}
        </div>

        {/* L0 全局态势区：5 张 KPI 卡，5 卡一行（决策 93 新增第 5 卡「拨测」，由 4 卡收敛扩展）。
            第 4 卡「告警 / 当前未恢复」是 L0 唯一取 /api/v1/alerts 的数字；第 5 卡「拨测」取
            dashboard.probe_target_abnormal_count。栅格走 antd Col flex:1 等宽方案保证 5 卡一行不溢出。 */}
        <div style={{ fontSize: 13, fontWeight: 600 }}>全局态势</div>
        <div data-testid="l0-section" style={{ flex: 'none' }}>
          {dashboardLoading && <LoadingPlaceholder />}
          {dashboardError && (
            <Alert message="请求失败" description={dashboardError} type="error" showIcon />
          )}
          <Row gutter={[16, 16]}>
            {metrics.map((item) => (
              <Col key={item.key} flex="1">
                <MetricCard item={item} />
              </Col>
            ))}
          </Row>
        </div>

        {/* L1 采集覆盖区：5 张资源类型卡一行（决策 93：删「按应用查看」入口卡与未恢复胶囊；
            网格同 L0 的 flex 等宽方案。卡内子类明细口径见 ResourceTypeGrid 头注释。） */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            采集覆盖
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400, marginLeft: 4 }}>
              （进度条与子类明细 = 各类型采集覆盖情况，子类最多 3 条，可点击穿到资源清单）
            </Typography.Text>
          </div>
          <div style={{ marginTop: 8 }}>
            <ResourceTypeGrid byCategory={dashboard?.by_category ?? []} />
          </div>
        </div>

        {/* L2 应用覆盖表：按覆盖率升序，未归类行置底。
            锚点 id 供「按应用查看」历史入口（/resources / 旧 L1 链接）就地定位。 */}
        <div id="app-detail">
          <AppDetailTable
            byApp={dashboard?.by_app ?? []}
            unclassifiedResourceCount={dashboard?.unclassified_resource_count ?? 0}
            unclassifiedMonitoredCount={dashboard?.unclassified_monitored_count ?? 0}
          />
        </div>

        {/* L3 拨测态势面板：整宽卡（决策 93）。数据源为 dashboard.probe_targets[]（受控注入，
            空库/字段缺失时空数组 → ProbePanel 显示空态 + 去配置深链）。 */ }
        <ProbePanel probeTargets={dashboard?.probe_targets ?? []} />

        {/* L4 告警状态卡 + L5 使用指引：同排等高（左告警 flex:1.6 : 右指引 flex:1，决策 93）。
            AlertStatusCard 已支持 height:100% + 纵向 flex，使用指引改为纵向六步，见各自组件。 */}
        <div data-testid="home-l45-row" style={{ display: 'flex', gap: 16, alignItems: 'stretch' }}>
          <div style={{ flex: 1.6, minWidth: 0 }}>
            <AlertStatusCard
              counts={counts}
              latestAlerts={latestAlerts}
              summaryByAlert={summaryByAlert}
              loading={alertLoading}
              promError={promError}
              amError={amError}
              historyError={historyError}
              onRetry={retry}
              isStaticPreview={IS_STATIC_PREVIEW}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <OnboardingSteps />
          </div>
        </div>
      </div>
    </MainLayout>
  )
}

export default HomePage
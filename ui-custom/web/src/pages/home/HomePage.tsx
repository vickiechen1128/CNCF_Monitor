/**
 * 首页概览 —— **首屏信息架构**（Module_05 反馈 11 §11.3 定稿版式；沿用 PRD v1.8 编号 01~06；
 * 2026-10-17 走查：02+03 合并行、标题通俗化、类型卡去子类、拨测双卡、指引一行、采集健康解释整合；
 * 2026-10-17 第五轮走查：04 改「圆环 + 六类表格」、云卡紧凑统计行、矩阵脚注缩减、
 * 告警与采集健康 2:1 并排、页头去除版本/模式字样；
 * 2026-10-17 第六轮走查（产品负责人看效果后修订）：**「监控对象纳管进度 + 告警状态」
 * 一行、「采集健康 + 拨测态势」一行**；02/03「资源管理」展示组由**页头行一个开关
 * 整组隐藏**（隐藏后 home-resource-row 整体不渲染，不露面板标题；偏好跨会话持久）。
 *
 * 页面结构（自上而下）：
 * 01 页头行（引导语 + 「隐藏 / 显示资源分布」开关）→
 * 02 资源管理行 `home-resource-row`（可整组隐藏）：02「不同云的主机数量」
 * （固定窄列）+ 03「平台与应用的主机分布」，两个 flex-wrap 同行 →
 * 03 「监控对象纳管进度 + 告警状态」一行 `home-coverage-alert-row` →
 * 04 「采集健康 + 拨测态势」一行 `home-health-probe-row` →
 * 06 使用指引（**一行横排**六步）。
 *
 * 与上一版的关键差异（反馈 11 §11.2，产品定稿）：
 * - 🚫 **删除 L0「全局态势感知」整块**（5 张 KPI 卡）：五张卡分属四种互不相干的维度，
 *   并排却不构成可比较 / 可汇总 / 可下钻的整体。告警数字统一由告警状态卡承载，
 *   整体纳管进度归口到 04 区块（首页唯一呈现点）——首屏不再出现任何孤立 KPI 数字。
 * - 02 由「整宽 4 列表格」改为**每云紧凑统计行**（第五轮起；反馈 11 时为每云一张 KPI 卡），
 *   且去掉「已下发 / 纳管率 / 进度条」（按云维度纳管率本轮不做，避免与 04 同屏出现两个同源纳管率）；
 *   **第六轮起收窄为固定窄列**（原 1 1 460px 在 02+03 两列行里被拉到 ≈530px「过长」，
 *   产品负责人要求缩短）。
 * - 03 为**新增**矩阵区块：度量单位取主机台数，故行合计 === 列合计 === 主机总数。
 * - 04 与告警状态并排（第六轮走查定）：04「监控对象纳管进度」承接已删除的 L0 覆盖率卡
 *   职责，是首页唯一整体纳管率呈现点；告警卡原独立整宽「太宽」，并排同时修正两处。
 *   采集健康与拨测态势并排（第六轮走查定）：采集健康由「拨测之后」上移，系产品负责人
 *   对反馈 11 §11.2 ⑧「不与 04 相邻」的重新裁定——并排后仍是不同卡、不同口径、
 *   Tooltip 分隔，「分开展示」的实质不变（记录见 design-proposal §7）。
 * - 02 / 03「资源管理」展示组默认显示，页头行一个开关整组隐藏（第六轮：关注面不同，
 *   且隐藏后不露面板标题——恢复入口是页头的「显示资源分布」按钮）。
 *
 * 2026-10-17 走查七项（第四轮，详见 design-proposal §7）：
 * - 02+03 合并为一行（同类信息：主机在归属维度上的分布），标题改领导语言；
 * - 04 区块标题「纳管覆盖率」→「监控对象纳管进度」；类型卡去除「采集方式细分」子类区；
 * - 05 拨测由「一张大卡两个分区」改为两张独立卡，各带四格总体数字；
 * - 06 使用指引纵向六步 → 一行横排（窄屏卡内横向滚动）；
 * - 采集健康解释整合：只留一行可见副标题，次要口径进标题 / 图例 Tooltip。
 *
 * 2026-10-17 第五轮走查四项（产品负责人确认「方案 A + 4 项全部确认」后落地）：
 * - 04 由「32px 大数字 + 进度条 + 六张类型卡」改为**单卡内「左整体圆环 + 右六类表格」**
 *   （六张平级卡与整体看不出共同体关系；圆环承担「整体」，表格承担「明细」）；
 * - 02 每云 KPI 卡 → 紧凑统计行（2 朵云时左卡被撑高，与矩阵不协调）；
 * - 03 矩阵脚注三句 → 一句速记，完整口径进标题 Tooltip；
 * - 告警 + 采集健康 2:1 并排（告警太宽）；L1 六类顺序中「接口服务」上调至
 *   「其他监控目标」之上（兜底聚合类读表时居末）。
 *
 * 2026-10-17 第六轮走查（产品负责人看过第五轮效果后修订）：
 * - 「监控对象纳管完成率」与「告警状态」**对分**一行（04 + 告警，flex 1:1，各 ≈568px
 *   @1440；先评估过 2+3+4 压一行——内容宽 ≈1192px 下三列总宽 ≈1520px 放不下，
 *   故不采用，改为按关注面分行）；
 * - 「采集健康」与「拨测态势」一行，两者 grow **填满整行**（采集 1 : 拨测 2）；
 * - 02/03「资源管理」组页头行开关整组隐藏，隐藏后不露面板标题（偏好跨会话持久）；
 * - 拨测态势区头与两个子版面**合为一张卡**（样式上做成一体），整体健康度「正常率」
 *   圆环仿 04 整体圆环样式做在卡内左列；原「拨测目标 N · 正常 X · 异常 Y」汇总行移除；
 * - 04 标题「纳管进度」→「纳管完成率」（进度是过程量、完成率是结果量）；「已下发 /
 *   未下发」→「已配置采集 / 未配置采集」（下发什么说不清）；纳管率列去行内进度条、
 *   资源类型收窄，使纳管率列在 1440 半幅卡内完整可见；口径注解定稿在卡底左对齐；
 * - 告警卡统计块 280 → 220px；Prometheus 参考行与「配置告警通知」深链均已移除，
 *   首页告警卡只保留「库四指标 + AM 正在告警」；矩阵脚注两句合并为一行、末行/末列「合计」统一命名。
 *
 * 版式约束：
 * - 页面按内容自然排布，**不锁定视口**：不同电脑尺寸/分辨率下版式一致，内容超出即滚动；
 * - 区块间距 16px，与卡片 gutter 一致；
 * - 三个内容行均为 **flex-wrap + flex-basis 折行**（不写断点魔法数）：
 *   资源管理行 ≈260+420+16、04+告警行 ≈936（对分）、采集+拨测行 ≈936（grow 填满），
 *   宽屏一行、窄容器各自折行堆叠；
 * - 告警卡固定 5 行/页为**定稿硬契约**（见 homeLayout.ts，已与视口解耦）。
 *
 * 移动适配（手机竖屏，≤767px；见 homeResponsive.ts）：资源管理行两块折为上下堆叠
 * （云分布单列统计行、矩阵保留表格 + 横向滚动 + 固定首列，**不卡片化**——二维信息卡片化
 * 会破坏行列可比性）、04+告警行与采集+拨测行各折为上下堆叠、04 圆环与表格纵向堆叠、
 * 拨测双卡纵向堆叠、告警四格统计条 2×2、使用指引卡内横向滚动、05 / 06 纵向不折叠。
 *
 * 数据源：
 * - dashboardApi.getSummary()：by_cloud（02）、by_platform_app（03）、
 *   resource_count / monitored_count（04 圆环）、by_category（04 六类表格，by_subtype
 *   契约保留但前端不再消费）、probe_targets（拨测态势）、collection_health（采集健康）；
 *   by_app + unclassified_* 契约字段保留（应用覆盖明细表已按 design-proposal §2.4 删除，前端不再消费）；
 * - alertStatusApi 三条只读链路**单次请求**由 useAlertGovernance 持有：
 *   AM 通知状态（正在告警列表）+ 历史告警统计（四格）+ M02 历史告警（列表行 2 摘要回查），
 *   全部收敛到告警状态卡。
 * - 拨测态势实测来自 `dashboard.probe_targets[]`（决策 93 明细），由 HomePage 传入 ProbePanel
 *   受控渲染；静态预览（VITE_STATIC_PREVIEW=true）仍用 DASHBOARD_MOCK 明细与原型对齐。前端排序、分页，
 *   见 ProbePanel 头注释。
 */
import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Tooltip, Typography, theme } from 'antd'
import { EyeInvisibleOutlined, EyeOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import dayjs from 'dayjs'
import { dashboardApi } from '../../api/dashboard'
import { useProductName } from '../../skinContext'
import type { CloudSummary, DashboardSummary } from '../../api/dashboard'
import { alertStatusApi, ALERT_HISTORY_STEP_SECONDS } from '../../api/alertmanager'
import type {
  AlertEventStats,
  AlertHistoryData,
  AmAlertItem,
  AmAlertsData,
} from '../../types/alertmanager'
import type { ApiResponse } from '../../types/api'
import { MainLayout } from '../../layouts/MainLayout'
import { LoadingPlaceholder } from '../../components/LoadingPlaceholder'
import { AlertStatusCard, LATEST_ALERT_LIMIT } from './AlertStatusCard'
import type { AlertCounts } from './AlertStatusCard'
import { alertMatchKey } from '../alerts/alertmanagerConstants'
import { OnboardingSteps } from './OnboardingSteps'
import { ResourceTypeGrid } from './ResourceTypeGrid'
import { CoverageDonut } from './CoverageDonut'
import { SurfaceCard } from './SurfaceCard'
import { CloudDistributionPanel } from './CloudDistributionPanel'
import { PlatformAppMatrixPanel } from './PlatformAppMatrixPanel'
import { ProbePanel } from './ProbePanel'
import { CollectionHealthPanel } from './CollectionHealthPanel'
import { HOME_FONT } from './homeTypography'
import { useNarrowLayout } from './homeResponsive'
import {
  readResourcePanelsCollapsed,
  writeResourcePanelsCollapsed,
} from './homePanelVisibility'

/** 最新告警条数上限取自 AlertStatusCard.LATEST_ALERT_LIMIT（告警卡标题与本页截断共用一份） */

/**
 * 「按云分布」静态预览样例（M05 PRD v1.11 / 决策 100）：数值与原型
 * `docs/prototypes/module-05/src/mocks/module-05.ts` 的 `mockCloudSummaries` 一致
 * （PUB-TX 腾讯云 30/28/93%、GM-CU 政务云（联通）12/8/67%）。自洽约束：各云
 * `resource_count` 之和 = L1 主机类总数（42）、`monitored_count` 之和 = 主机类已采数（36）。
 * 后端 `by_cloud` 聚合就绪后优先后端取值，本样例仅作静态预览 / 缺失回退。
 */
const CLOUD_SUMMARY_MOCK: CloudSummary[] = [
  { cloud_code: 'PUB-TX', cloud_name: '腾讯云', resource_count: 30, monitored_count: 28, coverage_rate: 93 },
  { cloud_code: 'GM-CU', cloud_name: '政务云（联通）', resource_count: 12, monitored_count: 8, coverage_rate: 67 },
]

/**
 * 静态预览（无后端）用的聚合样例。数值与原型 `docs/prototypes/module-05/src/mocks/module-05.ts`
 * 逐项一致，便于生产页与原型同屏对照走查；同时满足全部不变量：
 * - `sum(by_category.resource_count) = 128 = resource_count`；`sum(monitored) = 96 = monitored_count`
 *   （42/36 主机 + 26/21 数据库 + 18/12 中间件 + 34/22 应用服务 + 8/5 其他监控目标）；
 * - `sum(by_app.resource_count) + unclassified_resource_count = 80 + 48 = 128`；
 *   `sum(by_app.monitored_count) + unclassified_monitored_count = 60 + 36 = 96`；
 * - `probe_target_count = 24` **不进** `resource_count`（拨测口径）；
 * - `sum(by_platform_app 行合计) = sum(by_platform_app 列合计) = 42 = by_category[host].resource_count`
 *   （见下方 by_platform_app 的自证注释）。
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
  /**
   * 「平台 × 应用 · 主机数」矩阵样例（反馈 11 §11.3 03 段）。
   *
   * 自洽不变量（行列合计均等于主机总数 = 42 = `by_category[host].resource_count`）：
   *   行合计：19 + 11 + 5 + 3 + 2 + 2 = 42
   *   列合计：支付 16 + 用户 16 + 数据网关 7 + 未指定应用 3 = 42
   * 右下角单一合计格 42 同时闭合两个方向。行序按平台主机台数降序（「其他」恒在
   * 「未指定平台」之前），列序由前端按列合计降序推导，两处 0 值单元格
   * （aliyun × 未指定应用、aws × 未指定应用）用于走查「0 是有效值、不显示成 -」的分支。
   *
   * 平台聚合语义与后端一致（platform/dashboard/summary.go）：Top 4 真实平台单独成行，
   * 落选平台合并进 `__other__`「其他」行，`platform_code` 空串行为「未指定平台」兜底行；
   * 「其他」与「未指定平台」两行在界面上不可下钻。
   */
  by_platform_app: [
    {
      platform_code: 'k8s-prod',
      platform_name: '私有云A平台（容器云）',
      host_count: 19,
      cells: [
        { app_code: 'payment', app_name: '支付平台', host_count: 8 },
        { app_code: 'user', app_name: '用户中心', host_count: 7 },
        { app_code: 'data-api', app_name: '数据网关', host_count: 3 },
        { app_code: '', app_name: '未指定应用', host_count: 1 },
      ],
    },
    {
      platform_code: 'openstack',
      platform_name: '私有云B平台',
      host_count: 11,
      cells: [
        { app_code: 'payment', app_name: '支付平台', host_count: 5 },
        { app_code: 'user', app_name: '用户中心', host_count: 3 },
        { app_code: 'data-api', app_name: '数据网关', host_count: 2 },
        { app_code: '', app_name: '未指定应用', host_count: 1 },
      ],
    },
    {
      platform_code: 'aliyun',
      platform_name: '公有云A平台',
      host_count: 5,
      cells: [
        { app_code: 'payment', app_name: '支付平台', host_count: 2 },
        { app_code: 'user', app_name: '用户中心', host_count: 2 },
        { app_code: 'data-api', app_name: '数据网关', host_count: 1 },
      ],
    },
    {
      platform_code: 'aws',
      platform_name: '公有云B平台',
      host_count: 3,
      cells: [
        { app_code: 'payment', app_name: '支付平台', host_count: 1 },
        { app_code: 'user', app_name: '用户中心', host_count: 1 },
        { app_code: 'data-api', app_name: '数据网关', host_count: 1 },
      ],
    },
    {
      platform_code: '__other__',
      platform_name: '其他',
      host_count: 2,
      cells: [{ app_code: 'user', app_name: '用户中心', host_count: 2 }],
    },
    {
      platform_code: '',
      platform_name: '未指定平台',
      host_count: 2,
      cells: [
        { app_code: 'user', app_name: '用户中心', host_count: 1 },
        { app_code: '', app_name: '未指定应用', host_count: 1 },
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
    { service_name: '支付平台', resource_category: 'interface_service', platform_names: '', url: 'https://pay-api.example.cn/healthz', status: 'down', network_domain_id: 'mc-prod-intranet', network_domain_name: '生产内网域', last_probe_at: '2026-09-19T09:36:00+08:00' },
    { service_name: '官网证书', resource_category: 'interface_service', platform_names: '', url: 'https://www.example.cn/cert-check', status: 'down', network_domain_id: 'mc-prod-intranet', network_domain_name: '生产内网域', last_probe_at: '2026-09-19T09:27:00+08:00' },
    { service_name: '官网', resource_category: 'interface_service', platform_names: '', url: 'https://www.example.cn/', status: 'up', network_domain_id: 'mc-prod-intranet', network_domain_name: '生产内网域', last_probe_at: '2026-09-19T09:38:00+08:00' },
    { service_name: '数据平台', resource_category: 'interface_service', platform_names: '', url: 'https://data-api.example.cn/health', status: 'up', network_domain_id: 'mc-edge-debug', network_domain_name: '腾讯云调试域', last_probe_at: '2026-09-19T09:38:00+08:00' },
    { service_name: '订单中心', resource_category: 'interface_service', platform_names: '', url: 'https://order.example.cn/submit', status: 'up', network_domain_id: 'mc-prod-intranet', network_domain_name: '生产内网域', last_probe_at: '2026-09-19T09:37:00+08:00' },
    { service_name: '库存服务', resource_category: 'interface_service', platform_names: '', url: 'tcp://mysql.pay.example.cn:3306', status: 'up', network_domain_id: 'mc-prod-intranet', network_domain_name: '生产内网域', last_probe_at: '2026-09-19T09:37:00+08:00' },
    { service_name: '大模型应用', resource_category: 'application', platform_names: '私有云A平台、私有云B平台', url: 'http://10.0.0.5/health', status: 'up', network_domain_id: 'mc-prod-intranet', network_domain_name: '生产内网域', last_probe_at: '2026-09-19T09:37:00+08:00' },
  ],
  // 「采集健康」静态预览样例（反馈 10 路线 B；反馈 12 起两态）。分母 `dispatched_count`
  // 恒等于 `monitored_count`=96（已选中资源数），两态计数之和 = 96；后端查询失败 / 未实现时
  // 字段缺失，面板渲染「不可用」（本样例仅用于静态预览 / 缺失回退，不改变口径）。
  collection_health: {
    dispatched_count: 96,
    collecting_count: 88,
    down_count: 8,
  },
}

const ALERT_MOCK: AlertCounts = {
  todayTotal: 12,
  todayResolvedTotal: 9,
  todayResolvedReal: 8,
  todayResolvedInferred: 1,
  legacyOpenTotal: 2,
  legacyResolvedTodayTotal: 3,
  legacyResolvedTodayReal: 3,
  legacyResolvedTodayInferred: 0,
  active: 2,
  silenced: 1,
  inhibited: 0,
  unprocessed: 0,
}

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
 * 历史告警取数参数：窗口按服务端上限 7d。
 *
 * 2026-10-26 起 M02 history 只用于「最新告警」行 2 的摘要回查（summary 优先），
 * 不再参与首屏四格计数；四格改由 `/alert-events/stats` 提供。
 *
 * - **必须显式传 `step`（决策 90）**：取 `ALERT_HISTORY_STEP_SECONDS`（30s，PRD 默认细粒度）。
 *   7d ÷ 30s = 20160 点超过 Prometheus 单序列 11000 点上限，服务端会按窗口抬高步长兜底，
 *   但调用侧仍显式传值，避免行为依赖服务端默认；
 * - 窗口直接取整 7d：服务端会把 > 7d 的窗口压缩为 `[end-7d, end]`。
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

/** 首屏四格使用的历史告警统计字段（其余字段保留在接口里供其他消费方使用）。 */
type AlertStatsCounts = Pick<
  AlertCounts,
  | 'todayTotal'
  | 'todayResolvedTotal'
  | 'todayResolvedReal'
  | 'todayResolvedInferred'
  | 'legacyOpenTotal'
  | 'legacyResolvedTodayTotal'
  | 'legacyResolvedTodayReal'
  | 'legacyResolvedTodayInferred'
>

/**
 * 历史告警四指标（GET /alert-events/stats）。
 *
 * 口径由服务端按 UTC+8 自然日计算：今日告警严格按 starts_at；今日恢复按 closed_at；
 * 历史遗留是当前未结且 starts_at 早于今天 0 点。字段缺失（契约异常）返回 null，
 * 由调用方把四格降级为 '-'（不显示 0）。
 */
function computeAlertStats(res: ApiResponse<AlertEventStats> | null): AlertStatsCounts | null {
  const d = res?.data
  if (
    !d ||
    typeof d.today_total !== 'number' ||
    typeof d.today_resolved_total !== 'number' ||
    typeof d.legacy_open_total !== 'number' ||
    typeof d.legacy_resolved_today_total !== 'number'
  ) {
    return null
  }
  return {
    todayTotal: d.today_total,
    todayResolvedTotal: d.today_resolved_total,
    todayResolvedReal: d.today_resolved_real ?? 0,
    todayResolvedInferred: d.today_resolved_inferred ?? 0,
    legacyOpenTotal: d.legacy_open_total,
    legacyResolvedTodayTotal: d.legacy_resolved_today_total,
    legacyResolvedTodayReal: d.legacy_resolved_today_real ?? 0,
    legacyResolvedTodayInferred: d.legacy_resolved_today_inferred ?? 0,
  }
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

/** 内部治理态计数：AM 通知四态（active / silenced / inhibited / unprocessed） */
function computeCounts(
  amRes: ApiResponse<AmAlertsData> | null,
): Pick<AlertCounts, 'active' | 'silenced' | 'inhibited' | 'unprocessed'> {
  // amRes 仅在信封 status === 'success' 时被写入（见 toSourceState），
  // 业务错误信封不会静默计 0，而是走 amError 呈现。
  const amAlerts: AmAlertItem[] = amRes?.data?.items ?? []
  return {
    active: amAlerts.filter((i) => i.notify_status === 'active').length,
    silenced: amAlerts.filter((i) => i.notify_status === 'silenced').length,
    inhibited: amAlerts.filter((i) => i.notify_status === 'inhibited').length,
    unprocessed: amAlerts.filter((i) => i.notify_status === 'unprocessed').length,
  }
}

/** 统计接口不可用时的占位值；由 AlertStatusCard 按 statsError 统一渲染 '-'。 */
const EMPTY_ALERT_STATS: AlertStatsCounts = {
  todayTotal: 0,
  todayResolvedTotal: 0,
  todayResolvedReal: 0,
  todayResolvedInferred: 0,
  legacyOpenTotal: 0,
  legacyResolvedTodayTotal: 0,
  legacyResolvedTodayReal: 0,
  legacyResolvedTodayInferred: 0,
}

interface AlertGovernance {
  counts: AlertCounts
  /** 最新告警：AM 条目按 starts_at 倒序取前 LATEST_ALERT_LIMIT 条，剔除 unprocessed（治理闭环 MVP 未实现） */
  latestAlerts: AmAlertItem[]
  /** 行 2 告警具体内容回查表（history summary 优先，AM annotations.summary 兜底） */
  summaryByAlert: Record<string, string>
  loading: boolean
  amError: string | null
  /** 历史告警统计链路错误：四格降级为 '-'，不影响 AM 正在告警展示 */
  statsError: string | null
  retry: () => void
}

/**
 * 首页告警治理态取数（三条只读链路各单次请求持有）：
 * AM 通知状态（正在告警列表）、历史告警统计（四格）、M02 历史告警（列表行 2 摘要回查）。
 * allSettled：任一端点失败不丢弃其他端点已成功数据，失败源局部降级提示。
 */
function useAlertGovernance(
  isStaticPreview: boolean,
  mockCounts: AlertCounts,
  mockLatest: AmAlertItem[],
): AlertGovernance {
  const [amRes, setAmRes] = useState<ApiResponse<AmAlertsData> | null>(null)
  const [historyRes, setHistoryRes] = useState<ApiResponse<AlertHistoryData> | null>(null)
  const [statsRes, setStatsRes] = useState<ApiResponse<AlertEventStats> | null>(null)
  const [amError, setAmError] = useState<string | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(() => !isStaticPreview)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    if (isStaticPreview) {
      return
    }
    let cancelled = false
    Promise.allSettled([
      alertStatusApi.getAlertmanagerAlerts(),
      alertStatusApi.getAlertHistory(historyQuery()),
      alertStatusApi.getAlertEventStats(),
    ]).then(([am, history, stats]) => {
      if (cancelled) return
      const a = toSourceState(am)
      const h = toSourceState(history)
      const s = toSourceState(stats)
      setAmRes(a.res)
      setHistoryRes(h.res)
      setStatsRes(s.res)
      setAmError(a.error)
      // history 只用于列表行 2 摘要回查，失败时静默回落 AM summary，不阻塞统计四格。
      // 统计四格字段缺失（信封成功但字段不全）同样视为不可用：显示 '-' 而非 0。
      setStatsError(
        s.error ?? (computeAlertStats(s.res) ? null : '历史告警统计响应缺少字段'),
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
    return {
      ...computeCounts(amRes),
      // 统计不可用时由 AlertStatusCard 按 statsError 统一渲染 '-'，此处仅提供占位数值
      ...(computeAlertStats(statsRes) ?? EMPTY_ALERT_STATS),
    }
  }, [isStaticPreview, mockCounts, amRes, statsRes])

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

  const summaryByAlert = useMemo(
    () => (isStaticPreview ? {} : buildSummaryMap(historyRes)),
    [isStaticPreview, historyRes],
  )

  const retry = () => {
    // 静态预览无后端：effect 提前 return，置 loading 会永久停在加载态，直接短路
    if (isStaticPreview) return
    setLoading(true)
    setAmError(null)
    setStatsError(null)
    setRetryKey((k) => k + 1)
  }

  return { counts, latestAlerts, summaryByAlert, loading, amError, statsError, retry }
}

export function HomePage() {
  // 引导语中的产品名随「外观设置」变化（用户 2026-09-18 补充）
  const { productName } = useProductName()
  // 04 区块头部整体纳管率的进度条色取自主题 token，不硬编码
  const { token } = theme.useToken()
  // 窄屏（≤767px）版式开关：手机竖屏下各区域降列/堆叠，桌面版式逐字不变
  const narrow = useNarrowLayout()
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(() =>
    IS_STATIC_PREVIEW ? DASHBOARD_MOCK : null,
  )
  const [dashboardLoading, setDashboardLoading] = useState(() => !IS_STATIC_PREVIEW)
  const [dashboardError, setDashboardError] = useState<string | null>(null)

  // 02/03「资源管理」展示组的隐藏偏好（第六轮走查）：初值读 localStorage，变更即写回——
  // 跨会话保留，切模块 / 刷新都不丢（同侧栏折叠偏好模式，见 homePanelVisibility.ts）。
  // 隐藏时 home-resource-row **整体不渲染**（不露面板标题），恢复入口是页头行开关。
  const [resourcePanelsCollapsed, setResourcePanelsCollapsed] = useState(
    readResourcePanelsCollapsed,
  )
  useEffect(() => {
    writeResourcePanelsCollapsed(resourcePanelsCollapsed)
  }, [resourcePanelsCollapsed])

  const {
    counts,
    latestAlerts,
    summaryByAlert,
    loading: alertLoading,
    amError,
    statsError,
    retry,
  } = useAlertGovernance(IS_STATIC_PREVIEW, ALERT_MOCK, ALERT_MOCK_LATEST)

  useEffect(() => {
    // Vercel 静态预览环境没有后端，不发起请求
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

  // 整体纳管率（04 区块头部，首页唯一呈现点）：已下发（被启用的采集任务覆盖）÷ 资源总数，
  // 取整百分数；任一字段缺失或资源总数为 0 时为 undefined → 渲染 '-'，不渲染 0% / NaN%。
  const resourceTotal = metricNumber(dashboard?.resource_count)
  const monitoredTotal = metricNumber(dashboard?.monitored_count)
  const coveragePercent =
    resourceTotal !== undefined && resourceTotal > 0 && monitoredTotal !== undefined
      ? Math.round((monitoredTotal / resourceTotal) * 100)
      : undefined

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
        {/* 页头行：引导语 + 「隐藏 / 显示资源分布」开关。2026-10-17 第五轮走查按产品
            负责人要求去除「版本 / 模式」系统状态后右侧留空；第六轮走查把「资源管理」
            （02+03）整组隐藏开关放在这里——隐藏时资源行整体不渲染、不露面板标题，
            恢复入口不能跟着一起消失，故开关常驻页头行。 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <Typography.Text type="secondary" style={{ fontSize: HOME_FONT.label }}>
            欢迎回到 {productName}，这里汇总监控资源、采集任务与告警的整体运行情况
          </Typography.Text>
          <Button
            type="link"
            size="small"
            data-testid="resource-panels-toggle"
            icon={resourcePanelsCollapsed ? <EyeOutlined /> : <EyeInvisibleOutlined />}
            onClick={() => setResourcePanelsCollapsed((v) => !v)}
          >
            {resourcePanelsCollapsed ? '显示资源分布' : '隐藏资源分布'}
          </Button>
        </div>

        {/* 聚合取数的加载态 / 失败态：原挂在已删除的 L0 区内，L0 移除后上移到页头行正下方，
            覆盖下方所有依赖 dashboard.summary 的区块（02/03/04）。取数失败不静默成 0（决策 68-2）。 */}
        {dashboardLoading && <LoadingPlaceholder />}
        {dashboardError && (
          <Alert message="请求失败" description={dashboardError} type="error" showIcon />
        )}

        {/* 资源管理行（02+03，2026-10-17 第六轮走查；整组可隐藏）：
            02「不同云的主机数量」+ 03「平台与应用的主机分布」同处一个 flex-wrap 行——
            本是同一类信息（主机在归属维度上的分布）。02 由 1 1 460px 收窄为
            **0 1 260px 固定窄列**（原两列行里被拉到 ≈530px，产品负责人原话「宽度过长」）；
            03 分享剩余宽度（1440 视口下 ≈890px，矩阵 4 应用列几乎不用横向滚动）。
            整组隐藏（页头行开关）：隐藏时本行**整体不渲染**——面板标题也不露出，
            藏得干净；偏好跨会话持久（homePanelVisibility.ts）。
            字段缺失 → 各面板各自的空态 / 不可用态（不静默成 0、不回落样例）。 */}
        {!resourcePanelsCollapsed && (
          <div
            data-testid="home-resource-row"
            style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'stretch' }}
          >
            <div style={{ flex: '0 1 260px', minWidth: 0 }}>
              <CloudDistributionPanel
                clouds={dashboard?.by_cloud ?? (IS_STATIC_PREVIEW ? CLOUD_SUMMARY_MOCK : [])}
              />
            </div>
            <div style={{ flex: '1 1 420px', minWidth: 0 }}>
              <PlatformAppMatrixPanel rows={dashboard?.by_platform_app} />
            </div>
          </div>
        )}

        {/* 「监控对象纳管进度 + 告警状态」一行（2026-10-17 第六轮走查定，产品负责人
            看过效果后修订）：04 是首页唯一整体纳管率呈现点（承接已删除的 L0 覆盖率卡），
            告警卡原独立整宽「太宽」——两者**对分**一行（flex 1:1，各 ≈568px @1440）。
            基础宽 460 + 460 + 16 ≈ 936px：1440 视口（内容 ≈1192px）一行放得下。
            第五轮改版：04 由「32px 大数字 + 进度条 + 六张类型卡」改为单卡内
            「左整体圆环 + 右六类表格」（六张平级卡与整体看不出共同体关系；圆环承担
            「整体」，表格承担「明细」）；区块标题进卡头（与 02/03 卡头同规格），
            标题 Tooltip 承载精确口径。 */}
        <div
          data-testid="home-coverage-alert-row"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'stretch' }}
        >
          <div
            data-testid="coverage-section"
            style={{ flex: '1 1 460px', minWidth: 0, display: 'flex' }}
          >
            <SurfaceCard
              data-testid="coverage-card"
              style={{ flex: 1, minWidth: 0 }}
              /* 采集任务入口（2026-10-17 第六轮走查）：纳管完成率的口径是「已配置采集任务」，
                 给一个到采集 Job 列表的深链，并预筛 `job_type=standard`（采集类型，
                 与拨测 blackbox 分开），落页即只看拉模型采集任务。 */
              extra={
                <Link to="/scrape-jobs?job_type=standard" style={{ fontSize: HOME_FONT.label }}>
                  查看采集任务 →
                </Link>
              }
              title={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  监控对象纳管完成率
                  {/* 角标只讲**边界**（按什么计数、哪些不算），计算式与「与采集健康的分工」
                      由卡底脚注一句话说完——两处不再重复同一段口径（2026-10-17 第六轮走查） */}
                  <Tooltip title="按资源条数计（同一资源多个实例只算一条），拨测目标不计入；分母含尚未配置采集任务的资源。">
                    <InfoCircleOutlined
                      aria-label="监控对象纳管完成率口径说明"
                      style={{ fontSize: HOME_FONT.body, color: token.colorTextTertiary, cursor: 'help' }}
                    />
                  </Tooltip>
                </span>
              }
            >
              {/* 圆环 + 表格：宽容器同行（圆环块 120 + 间距 24 + 表格基础宽 260），
                  圆环块纵向居中对齐表格（避免圆环短、表格高时圆环下方一片空）；
                  容器再窄（折行 / 窄屏）时 flex-wrap 自然纵堆，不写断点。

                  **alignItems 必须随方向切换（2026-10-17 第七轮走查手机端修复）**：
                  横向时 `center` 用于纵向居中圆环与表格；但窄屏转 `column` 后，
                  `center` 在纵轴布局里是**横向居中 + 按内容收缩**——表格容器只有
                  flex-basis 260px 宽并居中，卡内 340px 的宽度被白白浪费，表格只能用
                  内部横滚消化剩余 68px，表现就是产品负责人截图里「未配置」列被裁掉。
                  纵排时改 `stretch`：表格容器撑满卡宽，圆环靠自身 `alignSelf:center` 居中。 */}
              <div
                data-testid="coverage-body"
                style={{
                  display: 'flex',
                  flexDirection: narrow ? 'column' : 'row',
                  alignItems: narrow ? 'stretch' : 'center',
                  flexWrap: 'wrap',
                  gap: narrow ? 16 : 24,
                }}
              >
                {/* 左列：圆环 + 环下标签（第六轮定稿：口径注解不放圆环块内——150px 窄列
                    放长句挤成 5 行小字，产品负责人走查后改放卡底，见下方脚注）。
                    块宽 120 = 圆环宽；表格因此多让出 20px，纳管率列完整可见 */}
                <div
                  style={{
                    flex: '0 0 auto',
                    width: 120,
                    display: 'flex',
                    flexDirection: 'column',
                    // 纵排（手机）时块宽固定 120，父级 stretch 不会把它拉宽，
                    // 需显式居中，否则圆环贴左边缘
                    alignSelf: narrow ? 'center' : undefined,
                  }}
                >
                  <CoverageDonut percent={coveragePercent} monitored={monitoredTotal} total={resourceTotal} />
                </div>
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <ResourceTypeGrid byCategory={dashboard?.by_category ?? []} />
                </div>
              </div>

              {/* 口径注解（第六轮走查定稿位置）：**卡底、左对齐、整宽一行区**。
                  曾在圆环块内（百分比下方）——140px 窄列放 57 字长句挤成 5~6 行 11px
                  小字，产品负责人看后改回卡底；整宽下 528px 放不下整句则自然换行，
                  左对齐可读。与「采集健康」明确区分（那是工程师视角的实际采集情况）。 */}
              <div
                data-testid="overall-coverage-footnote"
                style={{
                  marginTop: 12,
                  fontSize: HOME_FONT.note,
                  lineHeight: '16px',
                  color: token.colorTextTertiary,
                }}
              >
                按「已配置采集任务的资源数 ÷ 资源总数」计算，只反映配置进度，不代表数据已采到；实际采集情况见下方「采集健康」。
              </div>
            </SurfaceCard>
          </div>
          <div data-testid="home-alert-section" style={{ flex: '1 1 460px', minWidth: 0 }}>
            <AlertStatusCard
              counts={counts}
              latestAlerts={latestAlerts}
              summaryByAlert={summaryByAlert}
              loading={alertLoading}
              amError={amError}
              statsError={statsError}
              onRetry={retry}
              isStaticPreview={IS_STATIC_PREVIEW}
            />
          </div>
        </div>

        {/* 「采集健康 + 拨测态势」一行（2026-10-17 第六轮走查定）：采集健康由
            「拨测之后」上移与拨测并排（工程师视角：数据到没到 + 探测通不通）。
            **两者 grow 填满整行**（采集 1 : 拨测 2，flex-grow 拉伸至行宽，不留右侧
            空白）：1440 视口下采集 ≈432px、拨测 ≈688px；更窄容器整行折为上下堆叠，
            拨测独占整宽。基础宽 360 + 560 + 16 ≈ 936px。
            注意：这与反馈 11 §11.2 ⑧「采集健康不与 04 相邻」的原约定冲突——产品负责人
            重新裁定：并排后仍是不同卡、不同口径、Tooltip 分隔，「分开展示」的实质不变
            （记录见 design-proposal §7）。
            05 拨测态势为**单张卡**（第六轮走查：区头与两个子版面样式上做成一体），
            内容形态不变（决策 93）；数据源为 dashboard.probe_targets[]（受控注入，
            空库 → 空态 + 去配置深链）。
            ⚠️ wrapper **不能**设 display:flex——卡作为 flex 子项只会按内容宽度排版，
            右侧会留一条空白（2026-10-17 手机走查实测：拨测卡 572px 卡在 731px 列里，
            右边 159px 空白被产品负责人截图指出）。普通块级 wrapper + 卡 height:100%
            即可：宽度自动撑满、高度随行 stretch（同采集健康面板模式）。 */}
        <div
          data-testid="home-health-probe-row"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'stretch' }}
        >
          <div data-testid="home-collection-health-section" style={{ flex: '1 1 360px', minWidth: 0 }}>
            <CollectionHealthPanel health={dashboard?.collection_health} />
          </div>
          <div
            data-testid="home-probe-section"
            style={{ flex: '2 1 560px', minWidth: 0 }}
          >
            <ProbePanel probeTargets={dashboard?.probe_targets ?? []} />
          </div>
        </div>

        {/* 06 使用指引（反馈 11 §11.2 ⑦）：独立整宽，纵向六步不折叠、不再与告警卡同排。 */}
        <div data-testid="home-onboarding-section" style={{ flex: 'none' }}>
          <OnboardingSteps />
        </div>
      </div>
    </MainLayout>
  )
}

export default HomePage
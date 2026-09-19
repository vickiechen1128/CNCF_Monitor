/**
 * Phase 5 首页 Dashboard 聚合概览 API 客户端。
 * 权威契约：GET /api/v2/platform/dashboard/summary
 * 返回统一 `ApiResponse<DashboardSummary>`，聚合 M06/M07/M01/M09 概览数据。
 */
import { apiClient } from './client'
import type { ApiResponse } from '../types/api'

/** 最近下发记录项（M09 deployment 精简字段） */
export interface RecentDeployment {
  id: string
  change_no: string
  network_domain_name: string
  status: string
  triggered_at: string
}

/** 单个采集类型子类的聚合（L1 资源类型卡「采集类型子类」行） */
export interface SubtypeSummary {
  /** 子类取值：host 取 os_type、database 取 database_type、middleware 取 middleware_type、
   *  generic_target 取 exporter_type；application 不设子类 */
  subtype: string
  resource_count: number
  monitored_count: number
}

/**
 * 单个资源类型（L1 卡）的聚合。
 * **不含告警字段**——「未恢复」数字由前端按 `/api/v1/alerts` 的 `resource_category`
 * 分组得到，后端零改动（决策 91）。
 */
export interface CategorySummary {
  resource_category: string
  resource_count: number
  monitored_count: number
  /** 采集类型子类明细；application 恒为空数组（应用服务不按语言 / 框架拆子类） */
  by_subtype: SubtypeSummary[]
}

/** 单个应用（L2 行）的资源聚合 */
export interface AppSummary {
  /** 不可变应用编码，`app` 标签取值来源（M07 §5.19 应用字典） */
  app_code: string
  /** 展示名：应用字典解析；字典无该条目时回落为 `app_code` */
  app_name: string
  /** 业务域编码（该应用下资源多数归因，决策 92/93/95；为空时前端显示 '-'） */
  biz_code: string
  /** 业务域展示名：业务字典解析；字典无该条目或空时回落为 biz_code */
  biz_name: string
  resource_count: number
  monitored_count: number
}

/**
 * 单个拨测目标（L3 拨测态势面板行，决策 93）。
 * 字段与后端 summary.go `ProbeTargetItem` 的 json tag 完全一致（snake_case）：
 * `status` MVP 阶段恒为空串（未知，不以 up/down 呈现）；`biz_name` / `app_name` MVP 恒为空串；
 * `last_probe_at` 为指针时间，序列化为 ISO 字符串，空（nil）时前端显示 '-'。
 */
export interface ProbeTargetItem {
  /** 拨测 URL，缺失时前端显示 '-' */
  url: string
  /** 拨测状态：MVP 恒 '' 表示未知；'up' / 'down' 为明确态（未来后端填充） */
  status: string
  /** 业务域，空串显示 '-' */
  biz_name: string
  /** 应用名，空串显示 '-' */
  app_name: string
  /** 最近拨测时间（RFC3339 / ISO 串）；空（后端 nil）显示 '-' */
  last_probe_at: string | undefined
}

/**
 * Dashboard 聚合概览。
 * 决策 72-3（M05 首页内容重构，design-proposals/homepage-mvp-content-restructure.md §4.2）
 * 新增 monitored_count / scrape_job_count / scrape_job_enabled_count 三个计数字段。
 *
 * 决策 91（M05 PRD v1.7 首页三层信息架构）新增分组聚合字段：
 * `by_category`（L1 资源类型区）/ `by_app`（L2 应用明细表）/
 * `unclassified_*`（未归类应用行）/ `probe_target_*`（拨测附注，永不进资源台账口径）。
 */
export interface DashboardSummary {
  /** 监控资源总数（M07 五类资源表合计；**不含拨测目标**） */
  resource_count: number
  /** 已监控资源数：被至少一个已启用（ready + enabled）采集任务覆盖到的资源数（去重） */
  monitored_count: number
  /** 采集任务总数（未软删） */
  scrape_job_count: number
  /** 采集任务中 enabled=true 的数量 */
  scrape_job_enabled_count: number
  /** 待确认配置草稿数（M09，status=pending） */
  pending_draft_count: number
  /** 最近下发记录（最多 5 条） */
  recent_deployments: RecentDeployment[]
  /** 已纳管网域数（is_monitored=true） */
  domain_count: number
  /** L1：按资源类型分组，五类固定齐全（缺则补 0 值条目） */
  by_category: CategorySummary[]
  /** L2：按应用分组（`app_code` 非空的资源） */
  by_app: AppSummary[]
  /** L2 未归类行：`app_code` 为空的资源数 */
  unclassified_resource_count: number
  /** L2 未归类行：其中已被监控数 */
  unclassified_monitored_count: number
  /** 拨测目标数（blackbox，不属 M07 资源台账对象） */
  probe_target_count: number
  /** 拨测异常目标数（当前实现恒为 0，见 summary.go 口径说明） */
  probe_target_abnormal_count: number
  /** L3 拨测态势面板明细（决策 93）；空库为空数组非 null */
  probe_targets: ProbeTargetItem[]
}

export const dashboardApi = {
  getSummary(): Promise<ApiResponse<DashboardSummary>> {
    return apiClient.get<DashboardSummary>('/api/v2/platform/dashboard/summary')
  },
}
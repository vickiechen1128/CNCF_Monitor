import type { ReactNode } from 'react'
import { Alert, Button, Typography } from 'antd'
import type { CoverageState } from '../../types/query'

const { Text } = Typography

export interface ResourceListAlertsProps {
  /** 采集状态筛选值（有值时展示「前端过滤」限制提示） */
  monitorState: CoverageState | undefined
  hasDeepLinkFilter: boolean
  deepLinkCloud: string | null
  deepLinkAppCode: string | null
  deepLinkSubtype: string | null
  /** 深链预筛后的行数（提示条「共 N 条」） */
  visibleCount: number
  resolveCloudName: (code?: string) => string
  onClearDeepLink: () => void
  /**
   * 两条提示之间的内容（资源类别 Tabs）。
   * 保留在原位渲染，确保 DOM 顺序与拆分前完全一致。
   */
  betweenAlerts?: ReactNode
}

/**
 * 资源列表提示区（T07-R6 从 ResourcesPage 原样迁出，行为等价）。
 *
 * 1. 「采集状态」为前端过滤的显式披露（M02 coverage 派生字段，M07 资源表无该列）；
 * 2. 首页下钻预筛提示（决策 91 / design-proposal §2.1），含云名解析与一键清除。
 *
 * 纯展示组件：不请求数据、不持有状态。
 */
export function ResourceListAlerts({
  monitorState,
  hasDeepLinkFilter,
  deepLinkCloud,
  deepLinkAppCode,
  deepLinkSubtype,
  visibleCount,
  resolveCloudName,
  onClearDeepLink,
  betweenAlerts,
}: ResourceListAlertsProps) {
  return (
    <>
      {/*
        F-18 遗留风险的**显式化**：采集状态（`monitor_state`）是 M02 coverage API 的派生字段，
        M07 资源表**无该列**，故这一维筛选仍在前端按当页过滤——分页`total` 来自后端统计，
        不随该筛选变化。此前该限制完全静默（用户会以为看到的是全量筛选结果），
        这里显式提示，避免误读。其余五维（业务 / 运行状态 / 平台 / 应用 / 服务）已全部下沉后端，
        分页总数一致。
      */}
      {monitorState && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="「采集状态」为前端过滤"
          description={
            <Text style={{ fontSize: 12 }}>
              采集状态来自 M02 覆盖聚合（M07 资源表无此列），仅过滤当前页；分页总数仍为未按此条件过滤的总数。
              其余筛选条件均已由服务端过滤。
            </Text>
          }
        />
      )}

      {betweenAlerts}

      {/* 下钻来源提示（决策 91）：从首页子类行 / 应用行 / 云卡跳转而来时说明筛选条件，
          并提供一键清除（清除后回落到本页自己的筛选条件，不做导航）。
          云名展示名经云字典解析（缺条目回落 cloud_code，§2.1 第 4 条）。 */}
      {hasDeepLinkFilter && (
        <div data-testid="deep-link-hint" style={{ marginBottom: 12 }}>
          <Alert
            type="info"
            showIcon
            message={
              <span>
                已按首页下钻条件预筛选：
                {deepLinkCloud
                  ? ` 云 ${resolveCloudName(deepLinkCloud ?? undefined)}（${deepLinkCloud}）`
                  : ''}
                {deepLinkAppCode ? ` 应用 ${deepLinkAppCode}` : ''}
                {deepLinkSubtype ? ` 子类 ${deepLinkSubtype}` : ''}
                （共 {visibleCount} 条）
              </span>
            }
            /* 与「采集状态」同源的当页限制（§2.1 第 5 条）：下钻条件一律为前端过滤，
               分页 total 仍来自后端统计，不随该条件变化——此前该限制完全静默，
               用户会以为看到的是全量筛选结果。 */
            description={
              <Text style={{ fontSize: 12 }}>
                该条件为前端过滤，仅作用于当前页；分页总数为未按此条件过滤的总数。
              </Text>
            }
            action={
              <Button size="small" type="link" onClick={onClearDeepLink}>
                清除
              </Button>
            }
          />
        </div>
      )}
    </>
  )
}

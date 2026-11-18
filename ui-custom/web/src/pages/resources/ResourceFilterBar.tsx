import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Checkbox, Divider, Drawer, Dropdown, Input, Select, Space, Tag, theme, Typography } from 'antd'
import { FilterOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import type { NetworkDomain } from '../../types/domain'
import type {
  ApplicationDict,
  BusinessDomain,
  PlatformDict,
  ResourceCategory,
} from '../../types/resource'
import type { CoverageState } from '../../types/query'
import type { ResourceFilters } from './useResources'
import { MONITOR_STATE_FILTER_OPTIONS, STATUS_FILTER_OPTIONS } from './resourceFilterOptions'
import {
  COLUMN_GROUP_ORDER,
  RESOURCE_COLUMN_META,
  isDefaultVisibleColumnKeys,
} from './resourceColumnPrefs'

const { Text } = Typography

export interface ResourceFilterBarProps {
  /** 当前筛选条件（全部走后端，采集状态除外） */
  filters: ResourceFilters
  onFiltersChange: (filters: ResourceFilters) => void
  networkDomains: NetworkDomain[]
  platformDicts: PlatformDict[]
  /** 「应用」下拉候选：启用应用 ∩ 所选平台关联集合（由父页字典 Hook 计算） */
  filterAppOptions: ApplicationDict[]
  businessDomains: BusinessDomain[]
  /** 采集状态筛选（M09 coverage 派生字段，前端当页过滤） */
  monitorState: CoverageState | undefined
  onMonitorStateChange: (state: CoverageState | undefined) => void
  /** 当前资源类别 Tab（列设置按类别分区） */
  category: ResourceCategory
  visibleColumnKeys: string[]
  columnSettingsOpen: boolean
  setColumnSettingsOpen: (open: boolean) => void
  columnSettingsLabel: string
  handleVisibleColumnKeysChange: (next: string[]) => void
  handleResetColumnKeys: () => void
}

/**
 * 资源列表筛选区（P1 筛选器收敛）。
 *
 * 首屏只保留**全局搜索 + 筛选入口 + 列设置**；网域 / 平台 / 应用 / 业务 / 运行状态 /
 * 采集状态收进右侧筛选抽屉，避免顶部一排下拉框挤压表格。默认可见列（网域 / 运行状态 /
 * 采集状态）另有列头筛选，与抽屉共用同一筛选状态；隐藏列（平台 / 应用 / 业务）仍从抽屉进入，
 * 避免「先打开列设置才能找到筛选」。
 *
 * 纯展示组件：不请求数据、不持有业务筛选状态；仅维护抽屉展开这一 UI 态。
 */
export function ResourceFilterBar({
  filters,
  onFiltersChange,
  networkDomains,
  platformDicts,
  filterAppOptions,
  businessDomains,
  monitorState,
  onMonitorStateChange,
  category,
  visibleColumnKeys,
  columnSettingsOpen,
  setColumnSettingsOpen,
  columnSettingsLabel,
  handleVisibleColumnKeysChange,
  handleResetColumnKeys,
}: ResourceFilterBarProps) {
  // 列设置浮层的视觉 token：popupRender 自定义内容没有 `.ant-dropdown-menu`，
  // 而 antd 5 的白底/圆角/阴影都定义在 Menu 上 → 不补背景浮层就是透明的，
  // 表格内容会直接透出来（用户可见缺陷）。走 theme token 以兼容皮肤/暗色。
  const { token } = theme.useToken()
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false)

  const activeFilterCount = [
    filters.network_domain_id,
    filters.platform_code,
    filters.app_code,
    filters.biz_code,
    filters.status,
    monitorState,
  ].filter(Boolean).length

  const clearFilter = (patch: Partial<ResourceFilters>) => {
    onFiltersChange({ ...filters, ...patch })
  }

  const clearAllFilters = () => {
    clearFilter({
      network_domain_id: undefined,
      platform_code: undefined,
      app_code: undefined,
      biz_code: undefined,
      status: undefined,
    })
    onMonitorStateChange(undefined)
  }

  const networkDomainName = filters.network_domain_id
    ? (networkDomains.find((d) => d.id === filters.network_domain_id)?.name ?? filters.network_domain_id)
    : ''
  const platformName = filters.platform_code
    ? (platformDicts.find((d) => d.platform_code === filters.platform_code)?.platform_name ??
      filters.platform_code)
    : ''
  const appName = filters.app_code
    ? (filterAppOptions.find((d) => d.app_code === filters.app_code)?.app_name ?? filters.app_code)
    : ''
  const bizName = filters.biz_code
    ? (businessDomains.find((d) => d.code === filters.biz_code)?.name ?? filters.biz_code)
    : ''
  const statusName = STATUS_FILTER_OPTIONS.find((o) => o.value === filters.status)?.label ?? ''
  const monitorStateName =
    MONITOR_STATE_FILTER_OPTIONS.find((o) => o.value === monitorState)?.label ?? ''

  const activeTags = [
    networkDomainName && {
      key: 'network_domain_id',
      label: `网域：${networkDomainName}`,
      onClose: () => clearFilter({ network_domain_id: undefined }),
    },
    platformName && {
      key: 'platform_code',
      label: `平台：${platformName}`,
      onClose: () => clearFilter({ platform_code: undefined }),
    },
    appName && {
      key: 'app_code',
      label: `应用：${appName}`,
      onClose: () => clearFilter({ app_code: undefined }),
    },
    bizName && {
      key: 'biz_code',
      label: `业务：${bizName}`,
      onClose: () => clearFilter({ biz_code: undefined }),
    },
    statusName && {
      key: 'status',
      label: `运行状态：${statusName}`,
      onClose: () => clearFilter({ status: undefined }),
    },
    monitorStateName && {
      key: 'monitor_state',
      label: `采集状态：${monitorStateName}`,
      onClose: () => onMonitorStateChange(undefined),
    },
  ].filter(Boolean) as { key: string; label: string; onClose: () => void }[]

  /** 抽屉内单个筛选项：统一「标签在上、控件在下」布局 */
  const filterField = (label: string, control: ReactNode) => (
    <div>
      <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>
        {label}
      </Text>
      {control}
    </div>
  )

  const filterFields = (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {filterField(
        '网域',
        <Select
          placeholder="全部网域"
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ width: '100%' }}
          value={filters.network_domain_id}
          onChange={(v) => clearFilter({ network_domain_id: v })}
        >
          {networkDomains.map((d) => (
            <Select.Option key={d.id} value={d.id} label={`${d.name} (${d.id})`}>
              {d.name} ({d.id})
            </Select.Option>
          ))}
        </Select>,
      )}
      {/* F-18 / 决策 110：平台筛选（四层模型查询侧首级）。选项取平台字典启用条目，
          展示 platform_name、回退 platform_code（与「平台」列同一解析口径）。 */}
      {filterField(
        '平台',
        <Select
          placeholder="全部平台"
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ width: '100%' }}
          value={filters.platform_code}
          // 切换平台时清空已选应用：应用下拉按平台级联，跨平台后原选应用可能已不在候选内
          onChange={(v) => clearFilter({ platform_code: v, app_code: undefined })}
        >
          {platformDicts
            .filter((d) => d.enabled)
            .map((d) => (
              <Select.Option key={d.platform_code} value={d.platform_code} label={d.platform_name}>
                {d.platform_name}
              </Select.Option>
            ))}
        </Select>,
      )}
      {/* F-18 / 决策 92 + 111：应用筛选，按所选平台级联（数据源 app_platform_rel，
          与资源表单三级级联同源）。未选平台时列出全部启用应用。 */}
      {filterField(
        '应用',
        <Select
          placeholder="全部应用"
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ width: '100%' }}
          value={filters.app_code}
          onChange={(v) => clearFilter({ app_code: v })}
        >
          {filterAppOptions.map((d) => (
            <Select.Option key={d.app_code} value={d.app_code} label={`${d.app_name} (${d.app_code})`}>
              {d.app_name} ({d.app_code})
            </Select.Option>
          ))}
        </Select>,
      )}
      {filterField(
        '业务',
        <Select
          placeholder="全部业务"
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ width: '100%' }}
          value={filters.biz_code}
          onChange={(v) => clearFilter({ biz_code: v })}
        >
          {businessDomains
            .filter((d) => d.enabled)
            .map((d) => (
              <Select.Option key={d.code} value={d.code} label={`${d.name} (${d.code})`}>
                {d.name} ({d.code})
              </Select.Option>
            ))}
        </Select>,
      )}
      {filterField(
        '运行状态',
        <Select
          placeholder="全部"
          allowClear
          style={{ width: '100%' }}
          value={filters.status}
          onChange={(v) => clearFilter({ status: v })}
        >
          {STATUS_FILTER_OPTIONS.map((o) => (
            <Select.Option key={o.value} value={o.value}>
              {o.label}
            </Select.Option>
          ))}
        </Select>,
      )}
      {filterField(
        '采集状态',
        <Select
          placeholder="全部"
          allowClear
          style={{ width: '100%' }}
          value={monitorState}
          onChange={(v) => onMonitorStateChange(v as CoverageState | undefined)}
        >
          {MONITOR_STATE_FILTER_OPTIONS.map((o) => (
            <Select.Option key={o.value} value={o.value}>
              {o.label}
            </Select.Option>
          ))}
        </Select>,
      )}
    </Space>
  )

  return (
    <>
      <FilterBar>
        <FilterItem label="搜索" width={340}>
          <Input.Search
            placeholder="搜索实例名 / IP / 应用"
            allowClear
            onSearch={(v) => onFiltersChange({ ...filters, keyword: v || undefined })}
            style={{ width: 280 }}
          />
        </FilterItem>
        <FilterItem label="筛选" width={200}>
          <Button
            icon={<FilterOutlined />}
            onClick={() => setFilterDrawerOpen(true)}
            aria-label={activeFilterCount > 0 ? `筛选，已生效 ${activeFilterCount} 项` : '筛选'}
          >
            筛选{activeFilterCount > 0 ? `（${activeFilterCount}）` : ''}
          </Button>
        </FilterItem>
        {/* F-17「列设置」：收敛 tablePresets.ts「列数 ≤ 8」超标宽表。与筛选器同区
            （FilterBar 内），不塞进表格浮层。偏好按 resource_category 分区持久化，
            切 Tab 各自恢复；主标识列与操作列 disabled，不可取消勾选。 */}
        <FilterItem label="列" width={260}>
          {/*
            受控 open（frontend-reviewer H-1）：`rc-dropdown` 的 `onPopupClick` 对浮层内
            任意元素的冒泡点击**无条件** `setTriggerVisible(false)`（Dropdown.js:61-67
            经 :123 绑到浮层根节点）。当前 `popupRender` 路径因 antd `OverrideProvider`
            的 `onMenuClick` 短路（依赖 menu.selectable/multiple，popupRender 无 menu）
            才恰好不关闭——**属依赖内部实现，antd 升级即可能回归为「一点就关」**。
            F-17 的全部 UX 价值建立在「能连续勾选多列」上（generic_target 需勾 11 列），
            故显式受控 + stopPropagation 兜底，不依赖该短路。
          */}
          <Dropdown
            trigger={['click']}
            open={columnSettingsOpen}
            onOpenChange={setColumnSettingsOpen}
            popupRender={() => (
              // 阻断冒泡，避免点击 Checkbox / 按钮触发浮层关闭
              <div
                style={{
                  padding: 8,
                  minWidth: 200,
                  maxHeight: 420,
                  overflowY: 'auto',
                  // antd 5 背景色挂在 .ant-dropdown-menu 上，popupRender 自定义
                  // 内容必须自带白底/圆角/阴影，否则浮层透明遮不住下方表格
                  background: token.colorBgElevated,
                  borderRadius: token.borderRadiusLG,
                  boxShadow: token.boxShadowSecondary,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <Checkbox.Group
                  aria-label="列显示设置"
                  value={visibleColumnKeys}
                  onChange={handleVisibleColumnKeysChange}
                >
                  {COLUMN_GROUP_ORDER.map((group) => {
                    const metas = RESOURCE_COLUMN_META[category].filter((m) => m.group === group)
                    if (metas.length === 0) return null
                    // 固定列（主标识 / 操作）不可取消勾选
                    const groupLocked = group === '固定列'
                    return (
                      // role="group" + aria-label：让屏幕阅读器能读出分组归属——
                      // 这正是 F-17 保留 F-13 语义分组认知的核心价值（frontend-reviewer L-4）
                      <div key={group} role="group" aria-label={group} style={{ marginBottom: 8 }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {group}
                        </Text>
                        {metas.map((m) => (
                          <div key={m.key}>
                            <Checkbox value={m.key} disabled={groupLocked}>
                              {m.label}
                            </Checkbox>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </Checkbox.Group>
                {/* F-17 附加：一键恢复默认列集，避免取消到极简后需手动逐个勾回。
                    已是默认列集时禁用，避免无意义点击。 */}
                <Divider style={{ margin: '8px 0' }} />
                <Button
                  type="link"
                  size="small"
                  icon={<ReloadOutlined />}
                  disabled={isDefaultVisibleColumnKeys(category, visibleColumnKeys)}
                  onClick={handleResetColumnKeys}
                  style={{ paddingInline: 0 }}
                >
                  恢复默认列
                </Button>
              </div>
            )}
          >
            <Button icon={<SettingOutlined />}>{columnSettingsLabel}</Button>
          </Dropdown>
        </FilterItem>
      </FilterBar>
      {activeTags.length > 0 && (
        <Space size={[8, 8]} wrap style={{ marginBottom: 12 }}>
          {activeTags.map((tag) => (
            <Tag key={tag.key} closable onClose={tag.onClose}>
              {tag.label}
            </Tag>
          ))}
          <Button type="link" size="small" onClick={clearAllFilters} style={{ paddingInline: 0 }}>
            清除全部
          </Button>
        </Space>
      )}
      <Drawer
        title="筛选资源"
        open={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        width={380}
        destroyOnHidden
        footer={
          <div style={{ textAlign: 'right' }}>
            <Space>
              <Button onClick={clearAllFilters}>清空筛选</Button>
              <Button type="primary" onClick={() => setFilterDrawerOpen(false)}>
                完成
              </Button>
            </Space>
          </div>
        }
      >
        {filterFields}
      </Drawer>
    </>
  )
}

import { Button, Checkbox, Divider, Dropdown, Input, Select, theme, Typography } from 'antd'
import { ReloadOutlined, SettingOutlined } from '@ant-design/icons'
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
  /** 采集状态筛选（M02 coverage 派生字段，前端当页过滤） */
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
 * 资源列表筛选区（T07-R6 从 ResourcesPage 原样迁出，行为等价）。
 *
 * 包含网域 / 平台 / 应用 / 业务 / 运行状态 / 采集状态 / 搜索 / 列设置八组筛选，
 * 以及「列设置」受控 Dropdown 的完整交互（连续勾选不关闭、固定列 disabled、
 * 分组 aria-label、恢复默认列）。纯展示组件：不请求数据、不持有额外状态源。
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

  return (
    <FilterBar>
      <FilterItem label="网域" width={240}>
        <Select
          placeholder="全部网域"
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ width: 180 }}
          value={filters.network_domain_id}
          onChange={(v) => onFiltersChange({ ...filters, network_domain_id: v })}
        >
          {networkDomains.map((d) => (
            <Select.Option key={d.id} value={d.id} label={`${d.name} (${d.id})`}>
              {d.name} ({d.id})
            </Select.Option>
          ))}
        </Select>
      </FilterItem>
      {/* F-18 / 决策 110：平台筛选（四层模型查询侧首级）。选项取平台字典启用条目，
          展示 platform_name、回退 platform_code（与「平台」列同一解析口径）。 */}
      <FilterItem label="平台" width={240}>
        <Select
          placeholder="全部平台"
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ width: 180 }}
          value={filters.platform_code}
          // 切换平台时清空已选应用：应用下拉按平台级联，跨平台后原选应用可能已不在候选内
          onChange={(v) => onFiltersChange({ ...filters, platform_code: v, app_code: undefined })}
        >
          {platformDicts
            .filter((d) => d.enabled)
            .map((d) => (
              <Select.Option key={d.platform_code} value={d.platform_code} label={d.platform_name}>
                {d.platform_name}
              </Select.Option>
            ))}
        </Select>
      </FilterItem>
      {/* F-18 / 决策 92 + 111：应用筛选，按所选平台级联（数据源 app_platform_rel，
          与资源表单三级级联同源）。未选平台时列出全部启用应用。 */}
      <FilterItem label="应用" width={240}>
        <Select
          placeholder="全部应用"
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ width: 180 }}
          value={filters.app_code}
          onChange={(v) => onFiltersChange({ ...filters, app_code: v })}
        >
          {filterAppOptions.map((d) => (
            <Select.Option key={d.app_code} value={d.app_code} label={`${d.app_name} (${d.app_code})`}>
              {d.app_name} ({d.app_code})
            </Select.Option>
          ))}
        </Select>
      </FilterItem>
      <FilterItem label="业务" width={240}>
        <Select
          placeholder="全部业务"
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ width: 180 }}
          value={filters.biz_code}
          onChange={(v) => onFiltersChange({ ...filters, biz_code: v })}
        >
          {businessDomains
            .filter((d) => d.enabled)
            .map((d) => (
              <Select.Option key={d.code} value={d.code} label={`${d.name} (${d.code})`}>
                {d.name} ({d.code})
              </Select.Option>
            ))}
        </Select>
      </FilterItem>
      <FilterItem label="运行状态" width={200}>
        <Select
          placeholder="全部"
          allowClear
          style={{ width: 120 }}
          value={filters.status}
          onChange={(v) => onFiltersChange({ ...filters, status: v })}
        >
          <Select.Option value="online">在线</Select.Option>
          <Select.Option value="offline">离线</Select.Option>
          <Select.Option value="maintenance">维护中</Select.Option>
        </Select>
      </FilterItem>
      <FilterItem label="采集状态" width={240}>
        <Select
          placeholder="全部"
          allowClear
          style={{ width: 180 }}
          value={monitorState}
          onChange={(v) => onMonitorStateChange(v as CoverageState | undefined)}
        >
          <Select.Option value="collecting">采集中</Select.Option>
          <Select.Option value="partial_collecting">部分采集中</Select.Option>
          <Select.Option value="pending_down">已下发未采到</Select.Option>
          <Select.Option value="not_monitored">未监控</Select.Option>
        </Select>
      </FilterItem>
      <FilterItem label="搜索" width={340}>
        <Input.Search
          placeholder="搜索实例名 / IP / 应用"
          allowClear
          onSearch={(v) => onFiltersChange({ ...filters, keyword: v || undefined })}
          style={{ width: 280 }}
        />
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
  )
}

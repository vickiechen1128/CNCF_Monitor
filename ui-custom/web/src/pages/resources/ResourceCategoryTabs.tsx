import { Tabs } from 'antd'
import type { ResourceCategory } from '../../types/resource'
import { RESOURCE_TYPES, RESOURCE_TYPE_MAP } from './resourceMeta'

export interface ResourceCategoryTabsProps {
  category: ResourceCategory
  onChange: (category: ResourceCategory) => void
}

/**
 * 资源类别 Tab 切换（T07-R6 从 ResourcesPage 原样迁出，行为等价）。
 * 纯展示组件：类别集合与展示名统一取自 `resourceMeta`。
 */
export function ResourceCategoryTabs({ category, onChange }: ResourceCategoryTabsProps) {
  return (
    <Tabs
      activeKey={category}
      onChange={(key) => {
        onChange(key as ResourceCategory)
      }}
      items={RESOURCE_TYPES.map((type) => ({ key: type, label: RESOURCE_TYPE_MAP[type] }))}
      style={{ marginBottom: 16 }}
    />
  )
}

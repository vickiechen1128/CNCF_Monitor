import { MainLayout } from '../../layouts/MainLayout'
import { CollectorTemplatesTab } from './CollectorTemplatesTab'

/**
 * 采集器管理独立页（F-09 用户裁定拆分，路由 /collectors，2026-08-23）。
 * 动线先行：先登记采集器 / 配置默认采集，再创建采集 Job（创建时自动套用默认值），
 * 故「采集器管理」由采集 Job 页内 Tab 提升为「采集策略」一级 tab 下的独立二级页面。
 * 复用 CollectorTemplatesTab 组件主体（页内 Tab 与独立页共用同一列表/抽屉逻辑）。
 */
export function CollectorListPage() {
  return (
    <MainLayout>
      <CollectorTemplatesTab />
    </MainLayout>
  )
}

export default CollectorListPage
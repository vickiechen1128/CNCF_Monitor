import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TemplateDetailTabs from './TemplateDetailTabs'
import type { LabelSourceType, LabelTemplate, Mapping, TemplateInstanceItem } from '../../types/label'

const resourcesMock = vi.fn()
const replaceMappingsMock = vi.fn()

vi.mock('../../api/labelTemplates', () => ({
  labelTemplateApi: {
    resources: (...args: unknown[]) => resourcesMock(...args),
    replaceMappings: (...args: unknown[]) => replaceMappingsMock(...args),
  },
}))

function mapping(
  source_field: string,
  source_type: LabelSourceType,
  target_label: string,
  over: Partial<Mapping> = {},
): Mapping {
  return { source_field, source_type, target_label, enabled: true, ...over }
}

function template(over: Partial<LabelTemplate> = {}): LabelTemplate {
  return {
    id: 1,
    name: '主机模板',
    resource_category: 'host',
    is_default: false,
    mappings: [
      mapping('app_code', 'resource_field', 'app'),
      mapping('instance_ip:port', 'composite', 'instance', { transform: 'lower' }),
    ],
    created_at: '2026-08-21T00:00:00Z',
    updated_at: '2026-08-21T00:00:00Z',
    ...over,
  }
}

function instanceItem(resourceId: string, name: string, status: string): TemplateInstanceItem {
  return { resource_id: resourceId, instance_name: name, status }
}

function instancePage(items: TemplateInstanceItem[], total?: number) {
  return { status: 'success', data: { items, total: total ?? items.length, page: 1, page_size: 10 } }
}

function renderTabs(tpl: LabelTemplate | null, over: { referencingJobCount?: number } = {}) {
  const onMappingsChange = vi.fn()
  render(<TemplateDetailTabs template={tpl} onMappingsChange={onMappingsChange} {...over} />)
  return { onMappingsChange }
}

describe('TemplateDetailTabs', () => {
  beforeEach(() => {
    resourcesMock.mockReset()
    replaceMappingsMock.mockReset()
    resourcesMock.mockResolvedValue(instancePage([]))
  })

  it('shows placeholder when no template selected and does not fetch instances', () => {
    renderTabs(null)
    expect(screen.getByText('请选择左侧模板查看详情')).toBeInTheDocument()
    expect(resourcesMock).not.toHaveBeenCalled()
  })

  it('loads instances on mount with template id and page/page_size=10 (application only)', async () => {
    renderTabs(template({ resource_category: 'application' }))
    await waitFor(() => expect(resourcesMock).toHaveBeenCalledWith(1, { page: 1, page_size: 10 }))
  })

  it('hides instances tab and does not fetch for static resource categories (host)', async () => {
    renderTabs(template())
    await waitFor(() => expect(resourcesMock).not.toHaveBeenCalled())
    expect(screen.queryByRole('tab', { name: /关联实例/ })).not.toBeInTheDocument()
    // 静态资源仍保留「映射明细 / 被引用采集 Job」两 Tab
    expect(screen.getByRole('tab', { name: /映射明细/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /被引用采集 Job/ })).toBeInTheDocument()
  })

  it('groups mappings by source type in Tab1', async () => {
    renderTabs(template())
    expect(await screen.findByText('组合字段（1）')).toBeInTheDocument()
    expect(screen.getByText('资源字段（1）')).toBeInTheDocument()
    // 来源字段 / 目标标签 / 转换规则
    expect(screen.getByText('app_code')).toBeInTheDocument()
    expect(screen.getByText('instance_ip:port')).toBeInTheDocument()
    expect(screen.getByText('app')).toBeInTheDocument()
    expect(screen.getByText('转小写')).toBeInTheDocument()
  })

  it('renders dict transform with Chinese label', async () => {
    renderTabs(template({ mappings: [mapping('app_code', 'resource_field', 'app', { transform: 'dict' })] }))
    expect(await screen.findByText('字典翻译')).toBeInTheDocument()
  })

  it('shows empty hint when template has no mappings', async () => {
    renderTabs(template({ mappings: [] }))
    expect(await screen.findByText('该模板暂无映射，点击「编辑」添加')).toBeInTheDocument()
  })

  it('renders instance table and filters by keyword search', async () => {
    resourcesMock.mockResolvedValue(
      instancePage([instanceItem('r1', 'web-01', 'online'), instanceItem('r2', 'db-01', 'offline')]),
    )
    renderTabs(template({ resource_category: 'application' }))
    fireEvent.click(await screen.findByRole('tab', { name: /关联实例/ }))
    expect(await screen.findByText('web-01')).toBeInTheDocument()
    expect(screen.getByText('db-01')).toBeInTheDocument()
    const search = screen.getByPlaceholderText('搜索实例名 / 资源 ID')
    fireEvent.change(search, { target: { value: 'db' } })
    expect(screen.queryByText('web-01')).not.toBeInTheDocument()
    expect(screen.getByText('db-01')).toBeInTheDocument()
  })

  it('filters instances by status and shows 无匹配实例 when none match', async () => {
    resourcesMock.mockResolvedValue(
      instancePage([instanceItem('r1', 'web-01', 'online'), instanceItem('r2', 'db-01', 'offline')]),
    )
    renderTabs(template({ resource_category: 'application' }))
    fireEvent.click(await screen.findByRole('tab', { name: /关联实例/ }))
    await screen.findByText('web-01')
    // 状态筛选选「维护中」（数据无维护中实例 → 无匹配）
    fireEvent.mouseDown(screen.getByText('全部状态'))
    fireEvent.click(await screen.findByText('维护中'))
    expect(await screen.findByText('无匹配实例')).toBeInTheDocument()
  })

  it('shows jobs tab empty state with explanation text', async () => {
    renderTabs(template())
    fireEvent.click(await screen.findByRole('tab', { name: /被引用采集 Job/ }))
    expect(await screen.findByText('暂无采集 Job 引用本模板')).toBeInTheDocument()
    // #19 通病修复后：MappingDrawer forceRender 常驻挂载，其保存提示也含「无版本回滚能力」，
    // 此处按 jobs tab 空态特有「只读修改快照」子串匹配，避免 getByText 多匹配
    expect(screen.getByText(/只读修改快照/)).toBeInTheDocument()
  })

  it('opens batch editing and shows save impact after one unified save', async () => {
    replaceMappingsMock.mockResolvedValue({ status: 'success', data: [] })
    const { onMappingsChange } = renderTabs(template(), { referencingJobCount: 3 })
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(await screen.findByRole('dialog', { name: '编辑映射' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '统一保存' }))
    await waitFor(() => expect(replaceMappingsMock).toHaveBeenCalledWith(1, expect.any(Array)))
    expect(replaceMappingsMock).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('保存已生效')).toBeInTheDocument()
    const alertDesc = document.querySelector('.ant-alert-description')
    expect(alertDesc?.textContent).toContain('被 3 个采集 Job 引用')
    expect(onMappingsChange).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /查看引用 Job/ }))
    expect(await screen.findByText('暂无采集 Job 引用本模板')).toBeInTheDocument()
  })

  it('default template is read-only with a disabled edit entry and tooltip', async () => {
    renderTabs(template({ is_default: true }))
    expect(await screen.findByText('组合字段（1）')).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: /删\s*除/ })).toHaveLength(0)
    const editBtn = screen.getByRole('button', { name: '编辑' })
    expect(editBtn).toBeDisabled()
    fireEvent.mouseOver(editBtn)
    expect(await screen.findByText(/默认模板只读保护/)).toBeInTheDocument()
  })
})

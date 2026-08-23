import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import TemplateDetailTabs from './TemplateDetailTabs'
import type { LabelSourceType, LabelTemplate, Mapping, TemplateInstanceItem } from '../../types/label'

const resourcesMock = vi.fn()
const addMappingMock = vi.fn()
const updateMappingMock = vi.fn()
const removeMappingMock = vi.fn()

vi.mock('../../api/labelTemplates', () => ({
  labelTemplateApi: {
    resources: (...args: unknown[]) => resourcesMock(...args),
    addMapping: (...args: unknown[]) => addMappingMock(...args),
    updateMapping: (...args: unknown[]) => updateMappingMock(...args),
    removeMapping: (...args: unknown[]) => removeMappingMock(...args),
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
      mapping('app_name', 'resource_field', 'app'),
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
    addMappingMock.mockReset()
    updateMappingMock.mockReset()
    removeMappingMock.mockReset()
    resourcesMock.mockResolvedValue(instancePage([]))
  })

  it('shows placeholder when no template selected and does not fetch instances', () => {
    renderTabs(null)
    expect(screen.getByText('请选择左侧模板查看详情')).toBeInTheDocument()
    expect(resourcesMock).not.toHaveBeenCalled()
  })

  it('loads instances on mount with template id and page/page_size=10', async () => {
    renderTabs(template())
    await waitFor(() => expect(resourcesMock).toHaveBeenCalledWith(1, { page: 1, page_size: 10 }))
  })

  it('groups mappings by source type in Tab1', async () => {
    renderTabs(template())
    expect(await screen.findByText('组合字段（1）')).toBeInTheDocument()
    expect(screen.getByText('资源字段（1）')).toBeInTheDocument()
    // 来源字段 / 目标标签 / 转换规则
    expect(screen.getByText('app_name')).toBeInTheDocument()
    expect(screen.getByText('instance_ip:port')).toBeInTheDocument()
    expect(screen.getByText('app')).toBeInTheDocument()
    expect(screen.getByText('lower')).toBeInTheDocument()
  })

  it('shows empty hint when template has no mappings', async () => {
    renderTabs(template({ mappings: [] }))
    expect(await screen.findByText('该模板暂无映射，点击「新增映射」添加')).toBeInTheDocument()
  })

  it('renders instance table and filters by keyword search', async () => {
    resourcesMock.mockResolvedValue(
      instancePage([instanceItem('r1', 'web-01', 'online'), instanceItem('r2', 'db-01', 'offline')]),
    )
    renderTabs(template())
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
    renderTabs(template())
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
    expect(screen.getByText(/无版本回滚能力/)).toBeInTheDocument()
  })

  it('shows save impact Alert after deleting a mapping and 查看引用 Job jumps to jobs tab', async () => {
    removeMappingMock.mockResolvedValue({ status: 'success', data: { mapping_id: 1 } })
    const { onMappingsChange } = renderTabs(template(), { referencingJobCount: 3 })
    // 定位 resource_field 分组的映射行（globalIndex 0 → mapping_id 1）内的删除按钮
    const resourceFieldRow = (await screen.findByText('app_name')).closest('tr')!
    fireEvent.click(within(resourceFieldRow).getByRole('button', { name: /删\s*除/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /删\s*除/ }))
    await waitFor(() => expect(removeMappingMock).toHaveBeenCalledWith(1, 1))
    // 保存影响反馈 Alert（含被引用 Job 数；描述跨多节点，用整段 textContent 断言）
    expect(await screen.findByText('保存已生效')).toBeInTheDocument()
    const alertDesc = document.querySelector('.ant-alert-description')
    expect(alertDesc?.textContent).toContain('被 3 个采集 Job 引用')
    expect(onMappingsChange).toHaveBeenCalled()
    // 「查看引用 Job」跳转 Tab3
    fireEvent.click(screen.getByRole('button', { name: /查看引用 Job/ }))
    expect(await screen.findByText('暂无采集 Job 引用本模板')).toBeInTheDocument()
  })

  it('default template is read-only: no delete buttons and 新增映射 disabled with tooltip', async () => {
    renderTabs(template({ is_default: true }))
    expect(await screen.findByText('组合字段（1）')).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: /删\s*除/ })).toHaveLength(0)
    const addBtn = screen.getByRole('button', { name: /新增映射/ })
    expect(addBtn).toBeDisabled()
    fireEvent.mouseOver(addBtn)
    expect(await screen.findByText(/默认模板只读保护/)).toBeInTheDocument()
  })
})

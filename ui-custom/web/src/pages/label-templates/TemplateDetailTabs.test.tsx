import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import TemplateDetailTabs from './TemplateDetailTabs'
import type { LabelSourceType, LabelTemplate, Mapping } from '../../types/label'

const replaceMappingsMock = vi.fn()
const setDefaultMock = vi.fn()

vi.mock('../../api/labelTemplates', () => ({
  labelTemplateApi: {
    replaceMappings: (...args: unknown[]) => replaceMappingsMock(...args),
    setDefault: (...args: unknown[]) => setDefaultMock(...args),
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
    id: 'lt-1',
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

function renderTabs(tpl: LabelTemplate | null, over: { referencingJobCount?: number } = {}) {
  const onMappingsChange = vi.fn()
  const onTemplateChange = vi.fn()
  render(
    <TemplateDetailTabs
      template={tpl}
      onMappingsChange={onMappingsChange}
      onTemplateChange={onTemplateChange}
      {...over}
    />,
  )
  return { onMappingsChange, onTemplateChange }
}

describe('TemplateDetailTabs', () => {
  beforeEach(() => {
    replaceMappingsMock.mockReset()
    setDefaultMock.mockReset()
  })

  it('shows placeholder when no template selected', () => {
    renderTabs(null)
    expect(screen.getByText('请选择左侧模板查看详情')).toBeInTheDocument()
  })

  it('only renders 映射明细 / 被引用采集 Job tabs (v3 has no 关联实例 tab)', async () => {
    renderTabs(template({ resource_category: 'application' }))
    expect(await screen.findByRole('tab', { name: /映射明细/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /被引用采集 Job/ })).toBeInTheDocument()
    // v3 模板由 M01 Job / 映射引用、不绑定资源实例，关联实例 Tab 已移除
    expect(screen.queryByRole('tab', { name: /关联实例/ })).not.toBeInTheDocument()
    expect(screen.queryByText('搜索实例名 / 资源 ID')).not.toBeInTheDocument()
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
    await waitFor(() => expect(replaceMappingsMock).toHaveBeenCalledWith('lt-1', expect.any(Array)))
    expect(replaceMappingsMock).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('保存已生效')).toBeInTheDocument()
    const alertDesc = document.querySelector('.ant-alert-description')
    expect(alertDesc?.textContent).toContain('被 3 个采集 Job 引用')
    expect(onMappingsChange).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /查看引用 Job/ }))
    expect(await screen.findByText('暂无采集 Job 引用本模板')).toBeInTheDocument()
  })

  it('sets a custom template as default after confirmation (v2.56)', async () => {
    setDefaultMock.mockResolvedValue({ status: 'success', data: template({ is_default: true }) })
    const { onTemplateChange } = renderTabs(template())

    fireEvent.click(await screen.findByRole('button', { name: /设为默认/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/原默认模板会自动取消默认/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: /设为默认/ }))

    await waitFor(() => expect(setDefaultMock).toHaveBeenCalledWith('lt-1'))
    await waitFor(() => expect(onTemplateChange).toHaveBeenCalledWith(expect.objectContaining({ is_default: true })))
  })

  it('hides the set-default action for a default template', async () => {
    renderTabs(template({ is_default: true }))
    expect(await screen.findByText('组合字段（1）')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /设为默认/ })).not.toBeInTheDocument()
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

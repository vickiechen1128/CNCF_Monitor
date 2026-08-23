import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MappingDrawer from './MappingDrawer'
import type { LabelSourceType, LabelTemplate, Mapping } from '../../types/label'

const addMappingMock = vi.fn()
const updateMappingMock = vi.fn()

vi.mock('../../api/labelTemplates', () => ({
  labelTemplateApi: {
    addMapping: (...args: unknown[]) => addMappingMock(...args),
    updateMapping: (...args: unknown[]) => updateMappingMock(...args),
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
    mappings: [mapping('app_name', 'resource_field', 'app')],
    created_at: '2026-08-21T00:00:00Z',
    updated_at: '2026-08-21T00:00:00Z',
    ...over,
  }
}

interface RenderOver {
  template?: LabelTemplate | null
  editingMapping?: Mapping | null
  editingIndex?: number | null
}

function renderDrawer(over: RenderOver = {}) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(
    <MappingDrawer
      open
      template={template()}
      editingMapping={null}
      editingIndex={null}
      onClose={onClose}
      onSaved={onSaved}
      {...over}
    />,
  )
  return { onClose, onSaved }
}

/** 在指定下标（0=来源类型 1=来源字段 2=转换规则）的 Select 中选择选项 */
async function selectOption(index: number, optionText: string) {
  const combos = screen.getAllByRole('combobox')
  fireEvent.mouseDown(combos[index])
  // 首选项同时带有 aria-label 与内容节点，取最后一个（选项内容）点击
  const options = await screen.findAllByText(optionText)
  fireEvent.click(options[options.length - 1])
}

describe('MappingDrawer', () => {
  beforeEach(() => {
    addMappingMock.mockReset()
    updateMappingMock.mockReset()
  })

  it('opens in add mode with resource_field defaults', () => {
    renderDrawer()
    expect(screen.getByText('新增映射')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('如 instance')).toBeInTheDocument()
    // 转换规则默认「无（原样透传）」
    expect(screen.getByText('无（原样透传）')).toBeInTheDocument()
  })

  it('rejects protected label as target with field error', async () => {
    renderDrawer()
    await selectOption(1, 'app_name')
    const targetInput = screen.getByPlaceholderText('如 instance')
    fireEvent.change(targetInput, { target: { value: 'job' } })
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
    expect(await screen.findByText(/是 Prometheus 保护 label/)).toBeInTheDocument()
    expect(addMappingMock).not.toHaveBeenCalled()
  })

  it('rejects duplicate target_label within same template', async () => {
    renderDrawer({ template: template({ mappings: [mapping('app_name', 'resource_field', 'app')] }) })
    await selectOption(1, 'instance_name')
    const targetInput = screen.getByPlaceholderText('如 instance')
    fireEvent.change(targetInput, { target: { value: 'app' } })
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
    expect(await screen.findByText(/target_label 重复、必须唯一/)).toBeInTheDocument()
    expect(addMappingMock).not.toHaveBeenCalled()
  })

  it('saves new mapping via addMapping and notifies onSaved', async () => {
    addMappingMock.mockResolvedValue({ status: 'success', data: [mapping('app_name', 'resource_field', 'app')] })
    const { onSaved } = renderDrawer()
    await selectOption(1, 'app_name')
    // 目标标签自动预填为来源字段；转换规则选 lower
    await selectOption(2, 'lower（转小写）')
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
    await waitFor(() =>
      expect(addMappingMock).toHaveBeenCalledWith(1, {
        target_label: 'app_name',
        source_type: 'resource_field',
        source_field: 'app_name',
        transform_rule: 'lower',
      }),
    )
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('pre-fills values in edit mode and calls updateMapping', async () => {
    const existing = mapping('app_name', 'resource_field', 'app', { enabled: true })
    updateMappingMock.mockResolvedValue({ status: 'success', data: [existing] })
    const { onSaved } = renderDrawer({
      template: template({ mappings: [existing] }),
      editingMapping: existing,
      editingIndex: 1,
    })
    expect(screen.getByPlaceholderText('如 instance')).toHaveValue('app')
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
    await waitFor(() =>
      expect(updateMappingMock).toHaveBeenCalledWith(1, 1, {
        target_label: 'app',
        source_type: 'resource_field',
        source_field: 'app_name',
        transform_rule: '',
      }),
    )
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('allows composite→instance mapping in edit mode (protected label exception)', async () => {
    const existing = mapping('instance_ip:port', 'composite', 'instance', { enabled: true })
    updateMappingMock.mockResolvedValue({ status: 'success', data: [existing] })
    renderDrawer({
      template: template({ mappings: [existing] }),
      editingMapping: existing,
      editingIndex: 1,
    })
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
    await waitFor(() =>
      expect(updateMappingMock).toHaveBeenCalledWith(1, 1, {
        target_label: 'instance',
        source_type: 'composite',
        source_field: 'instance_ip:port',
        transform_rule: '',
      }),
    )
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MappingDrawer from './MappingDrawer'
import { setupAntdTest } from '@/test/antdTestUtils'
import type { LabelSourceType, LabelTemplate, Mapping } from '../../types/label'

const replaceMappingsMock = vi.fn()

vi.mock('../../api/labelTemplates', () => ({
  labelTemplateApi: {
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
    mappings: [mapping('app_code', 'resource_field', 'app')],
    created_at: '2026-08-21T00:00:00Z',
    updated_at: '2026-08-21T00:00:00Z',
    ...over,
  }
}

function renderDrawer(tpl: LabelTemplate | null = template()) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(<MappingDrawer open template={tpl} onClose={onClose} onSaved={onSaved} />)
  return { onClose, onSaved }
}

async function selectOption(name: string, optionText: string) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox', { name }))
  const options = await screen.findAllByText(optionText)
  await user.click(options[options.length - 1])
}

describe('MappingDrawer', () => {
  setupAntdTest()

  beforeEach(() => {
    replaceMappingsMock.mockReset()
  })

  it('opens the full mapping table with existing values', () => {
    renderDrawer(template({ mappings: [mapping('app_code', 'resource_field', 'app'), mapping('env', 'resource_field', 'environment')] }))
    expect(screen.getByRole('dialog', { name: '编辑映射' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '目标标签 1' })).toHaveValue('app')
    expect(screen.getByRole('textbox', { name: '目标标签 2' })).toHaveValue('environment')
    expect(screen.getByRole('button', { name: '新增一行' })).toBeInTheDocument()
  })

  it('adds multiple rows and saves them in one request', async () => {
    const user = userEvent.setup()
    replaceMappingsMock.mockResolvedValue({ status: 'success', data: [] })
    const { onSaved, onClose } = renderDrawer(template({ mappings: [] }))

    await user.click(screen.getByRole('button', { name: '新增一行' }))
    await user.click(screen.getByRole('button', { name: '新增一行' }))
    await selectOption('来源字段 1', 'app_code')
    await selectOption('来源字段 2', 'env')
    await user.click(screen.getByRole('button', { name: '统一保存' }))

    await waitFor(() =>
      expect(replaceMappingsMock).toHaveBeenCalledWith(1, [
        { target_label: 'app_code', source_type: 'resource_field', source_field: 'app_code', transform_rule: '', enabled: true },
        { target_label: 'env', source_type: 'resource_field', source_field: 'env', transform_rule: '', enabled: true },
      ]),
    )
    expect(replaceMappingsMock).toHaveBeenCalledTimes(1)
    expect(onSaved).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('edits and deletes rows locally before one unified save', async () => {
    const user = userEvent.setup()
    replaceMappingsMock.mockResolvedValue({ status: 'success', data: [] })
    renderDrawer(template({ mappings: [mapping('app_code', 'resource_field', 'app'), mapping('env', 'resource_field', 'env')] }))

    const target = screen.getByRole('textbox', { name: '目标标签 1' })
    await user.clear(target)
    await user.type(target, 'application')
    await user.click(screen.getByRole('button', { name: '删除第 2 行' }))
    expect(screen.queryByRole('textbox', { name: '目标标签 2' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '统一保存' }))

    await waitFor(() =>
      expect(replaceMappingsMock).toHaveBeenCalledWith(1, [
        { target_label: 'application', source_type: 'resource_field', source_field: 'app_code', transform_rule: '', enabled: true },
      ]),
    )
    expect(replaceMappingsMock).toHaveBeenCalledTimes(1)
  })

  it('does not call the API when cancelling local edits', async () => {
    const user = userEvent.setup()
    const { onClose } = renderDrawer()
    const target = screen.getByRole('textbox', { name: '目标标签 1' })
    await user.clear(target)
    await user.type(target, 'draft_only')
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(onClose).toHaveBeenCalled()
    expect(replaceMappingsMock).not.toHaveBeenCalled()
  })

  it('rejects protected labels without saving', async () => {
    const user = userEvent.setup()
    renderDrawer()
    const target = screen.getByRole('textbox', { name: '目标标签 1' })
    await user.clear(target)
    await user.type(target, 'job')
    await user.click(screen.getByRole('button', { name: '统一保存' }))
    expect(await screen.findByText(/是 Prometheus 保护 label/)).toBeInTheDocument()
    expect(replaceMappingsMock).not.toHaveBeenCalled()
  })

  it('rejects duplicate target labels across draft rows', async () => {
    const user = userEvent.setup()
    renderDrawer(template({ mappings: [mapping('app_code', 'resource_field', 'app'), mapping('env', 'resource_field', 'env')] }))
    const target = screen.getByRole('textbox', { name: '目标标签 2' })
    await user.clear(target)
    await user.type(target, 'app')
    await user.click(screen.getByRole('button', { name: '统一保存' }))
    expect(await screen.findByText(/在该模板内已存在/)).toBeInTheDocument()
    expect(replaceMappingsMock).not.toHaveBeenCalled()
  })

  it('keeps the draft when the server rejects the batch', async () => {
    const user = userEvent.setup()
    replaceMappingsMock.mockRejectedValue(new Error('保存失败'))
    const { onClose } = renderDrawer()
    const target = screen.getByRole('textbox', { name: '目标标签 1' })
    await user.clear(target)
    await user.type(target, 'application')
    await user.click(screen.getByRole('button', { name: '统一保存' }))
    expect(await screen.findByText('保存失败')).toBeInTheDocument()
    expect(target).toHaveValue('application')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('supports dict transforms and composite instance mappings', async () => {
    const user = userEvent.setup()
    replaceMappingsMock.mockResolvedValue({ status: 'success', data: [] })
    renderDrawer(template({ mappings: [mapping('instance_ip:port', 'composite', 'instance')] }))
    expect(screen.getByRole('textbox', { name: '目标标签 1' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '统一保存' }))
    await waitFor(() =>
      expect(replaceMappingsMock).toHaveBeenCalledWith(1, [
        { target_label: 'instance', source_type: 'composite', source_field: 'instance_ip:port', transform_rule: '', enabled: true },
      ]),
    )
  })
})

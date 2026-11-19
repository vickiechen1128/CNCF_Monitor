import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockAntdModal, setupAntdTest } from '../../test/antdTestUtils'
import { CIModelPage } from './CIModelPage'
import type { CIModel } from '../../types/attribute'

const { listModelsMock, listDefsMock, createMock, updateMock, removeMock } = vi.hoisted(() => ({
  listModelsMock: vi.fn(),
  listDefsMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  removeMock: vi.fn(),
}))

vi.mock('../../api/attributes', () => ({
  ciModelApi: { list: listModelsMock, get: vi.fn() },
  attributeDefinitionApi: {
    list: listDefsMock,
    create: createMock,
    update: updateMock,
    remove: removeMock,
  },
}))

vi.mock('../../layouts/MainLayout', () => ({
  MainLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const GROUPS = [
  { value: 'identity' as const, label: '身份信息' },
  { value: 'ownership' as const, label: '归属信息' },
  { value: 'runtime' as const, label: '运行信息' },
  { value: 'collection' as const, label: '采集信息' },
  { value: 'capability' as const, label: '能力信息' },
  { value: 'profile' as const, label: '画像信息' },
]

function hostModel(overrides: Partial<CIModel> = {}): CIModel {
  return {
    resource_category: 'host',
    category_label: '主机',
    builtin_fields: [
      {
        key: 'instance_name',
        label: '实例名',
        display_group: 'identity',
        display_group_label: '身份信息',
        display_order: 0,
        value_type: 'text',
        required: true,
        immutable: true,
      },
      {
        key: 'has_npu',
        label: 'NPU 芯片',
        display_group: 'capability',
        display_group_label: '能力信息',
        display_order: 0,
        value_type: 'boolean',
        required: false,
        immutable: true,
      },
    ],
    custom_fields: [
      {
        id: 'def-1',
        attribute_key: 'rack_position',
        display_name: '机柜位置',
        value_type: 'text',
        resource_category: 'host',
        required: false,
        status: 'active',
        enabled: true,
        display_group: 'profile',
        display_group_label: '画像信息',
        display_order: 1,
      },
    ],
    available_groups: GROUPS,
    ...overrides,
  }
}

describe('CIModelPage', () => {
  setupAntdTest()

  beforeEach(() => {
    listModelsMock.mockReset()
    listDefsMock.mockReset()
    createMock.mockReset()
    updateMock.mockReset()
    removeMock.mockReset()
    listModelsMock.mockResolvedValue({ status: 'success', data: { list: [hostModel()] } })
    listDefsMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0 } })
  })

  it('内置字段只读展示并按分组归类，不提供任何操作入口', async () => {
    render(<CIModelPage />)

    expect(await screen.findByText('实例名')).toBeInTheDocument()
    expect(screen.getByText('NPU 芯片')).toBeInTheDocument()
    expect(screen.getAllByText('平台内置').length).toBeGreaterThan(0)

    const builtin = screen.getByTestId('builtin-field-section')
    expect(within(builtin).queryByRole('button', { name: /编\s*辑/ })).not.toBeInTheDocument()
    expect(within(builtin).queryByRole('button', { name: /移\s*除/ })).not.toBeInTheDocument()
    expect(within(builtin).getAllByText('身份信息').length).toBeGreaterThan(0)
    expect(within(builtin).getAllByText('能力信息').length).toBeGreaterThan(0)
  })

  it('自定义字段按分组与排序展示，并可登记新字段', async () => {
    createMock.mockResolvedValue({ status: 'success', data: { id: 'def-2' } })
    const user = userEvent.setup()
    render(<CIModelPage />)

    const customSection = await screen.findByTestId('custom-field-section')
    expect(within(customSection).getByText('机柜位置')).toBeInTheDocument()
    expect(within(customSection).getByText('画像信息')).toBeInTheDocument()

    await user.click(screen.getByTestId('create-custom-field'))
    expect(await screen.findByText('新增自定义字段 · host')).toBeInTheDocument()

    await user.type(screen.getByLabelText('字段 key'), 'dpu_model')
    await user.type(screen.getByLabelText('展示名'), 'DPU 型号')
    await user.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => expect(createMock).toHaveBeenCalled())
    const payload = createMock.mock.calls[0][0]
    expect(payload).toMatchObject({
      attribute_key: 'dpu_model',
      display_name: 'DPU 型号',
      resource_category: 'host',
      display_group: 'profile',
      display_order: 0,
    })
  })

  it('移除有引用的字段：提示已移出模型并说明历史值保留', async () => {
    const modal = mockAntdModal()
    removeMock.mockResolvedValue({
      status: 'success',
      data: { id: 'def-1', mode: 'removed', usage_count: 3 },
    })
    const user = userEvent.setup()
    render(<CIModelPage />)

    const customSection = await screen.findByTestId('custom-field-section')
    await user.click(within(customSection).getByRole('button', { name: /移\s*除/ }))

    expect(modal.confirm).toHaveBeenCalled()
    expect(modal.confirm.mock.calls[0][0].title).toContain('机柜位置')
    const onOk = modal.confirm.mock.calls[0][0].onOk
    await onOk?.()

    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('def-1'))
    await waitFor(() => expect(listModelsMock).toHaveBeenCalledTimes(2))
  })

  it('零引用移除：按删除处理', async () => {
    const modal = mockAntdModal()
    removeMock.mockResolvedValue({ status: 'success', data: { id: 'def-1', mode: 'deleted', usage_count: 0 } })
    const user = userEvent.setup()
    render(<CIModelPage />)

    const customSection = await screen.findByTestId('custom-field-section')
    await user.click(within(customSection).getByRole('button', { name: /移\s*除/ }))
    await modal.confirm.mock.calls[0][0].onOk?.()

    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('def-1'))
  })

  it('切换到「已移出字段」视图时加载并展示已移出字段', async () => {
    listDefsMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          {
            id: 'def-old',
            attribute_key: 'old_field',
            display_name: '旧字段',
            value_type: 'text',
            resource_category: 'host',
            required: false,
            status: 'removed',
            enabled: false,
            display_group: 'profile',
            display_group_label: '画像信息',
            display_order: 0,
          },
        ],
        total: 1,
      },
    })
    const user = userEvent.setup()
    render(<CIModelPage />)

    await screen.findByTestId('custom-field-section')
    await user.click(screen.getByRole('button', { name: '查看已移出字段' }))

    expect(await screen.findByText('旧字段')).toBeInTheDocument()
    expect(listDefsMock).toHaveBeenCalledWith('host', 'removed')
  })
})

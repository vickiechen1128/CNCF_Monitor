import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockAntdModal, setupAntdTest } from '../../test/antdTestUtils'
import { CIModelPage } from './CIModelPage'
import type { AttributeDefinition, CIModel } from '../../types/attribute'

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

// vitest jsdom 的 window.localStorage 不受控，用内存 Map 承载登录态（角色判定走 getStoredUser）。
const storageMap = new Map<string, string>()
const localStorageMock: Storage = {
  get length() {
    return storageMap.size
  },
  clear: () => storageMap.clear(),
  getItem: (key) => storageMap.get(key) ?? null,
  key: (index) => Array.from(storageMap.keys())[index] ?? null,
  removeItem: (key) => storageMap.delete(key),
  setItem: (key, value) => storageMap.set(key, String(value)),
}
Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true })

const USER_STORAGE_KEY = 'metriccenter:auth:user'

function setRole(role: 'admin' | 'user' | null) {
  if (!role) {
    storageMap.delete(USER_STORAGE_KEY)
    return
  }
  storageMap.set(
    USER_STORAGE_KEY,
    JSON.stringify({
      id: 'u1',
      username: 'u1',
      display_name: '测试用户',
      tenant_id: 'platform_admin',
      role,
    }),
  )
}

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
    setRole('admin')
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
    expect(await screen.findByText('新增自定义字段 · 主机')).toBeInTheDocument()

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

  it('新增字段可直接在抽屉内选择 CI 类型，无需先切换左侧类别', async () => {
    listModelsMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          hostModel(),
          hostModel({ resource_category: 'database', category_label: '数据库', custom_fields: [] }),
        ],
      },
    })
    createMock.mockResolvedValue({ status: 'success', data: { id: 'def-3' } })
    const user = userEvent.setup()
    render(<CIModelPage />)

    await screen.findByTestId('custom-field-section')
    // 左侧当前类别仍是 host，直接在抽屉里改选 database
    await user.click(screen.getByTestId('create-custom-field'))
    fireEvent.mouseDown(screen.getByLabelText('CI 类型'))
    fireEvent.click(await screen.findByText('数据库', { selector: '.ant-select-item-option-content' }))

    await user.type(screen.getByLabelText('字段 key'), 'db_engine_version')
    await user.type(screen.getByLabelText('展示名'), '数据库版本')
    await user.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => expect(createMock).toHaveBeenCalled())
    expect(createMock.mock.calls[0][0]).toMatchObject({
      attribute_key: 'db_engine_version',
      resource_category: 'database',
    })
    // 保存后详情跟随到所选类型
    expect(await screen.findByText('共 2 个内置字段、0 个自定义字段')).toBeInTheDocument()
  })

  it('左侧只平铺六类 CI，切换类别即整页切到该类型的完整模型', async () => {
    listModelsMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          hostModel(),
          hostModel({ resource_category: 'database', category_label: '数据库', custom_fields: [] }),
        ],
      },
    })
    const user = userEvent.setup()
    render(<CIModelPage />)

    const menu = await screen.findByTestId('ci-category-menu')
    expect(within(menu).getByText('主机')).toBeInTheDocument()
    expect(within(menu).getByText('数据库')).toBeInTheDocument()
    // 分组 / 自定义 / 已移出 / 全部字段 都不再是导航节点
    expect(within(menu).queryByText('身份信息')).not.toBeInTheDocument()
    expect(within(menu).queryByText('自定义字段')).not.toBeInTheDocument()
    expect(within(menu).queryByText('已移出字段')).not.toBeInTheDocument()
    expect(within(menu).queryByText('全部字段')).not.toBeInTheDocument()

    await user.click(within(menu).getByText('数据库'))
    expect(await screen.findByText('共 2 个内置字段、0 个自定义字段')).toBeInTheDocument()
    expect(screen.getByTestId('builtin-field-section')).toBeInTheDocument()
    expect(screen.getByTestId('custom-field-section')).toBeInTheDocument()
  })

  it('内置字段按分组汇总为一张只读表，六组字段同时可见', async () => {
    render(<CIModelPage />)

    const builtin = await screen.findByTestId('builtin-field-section')
    expect(within(builtin).getByText('身份信息')).toBeInTheDocument()
    expect(within(builtin).getByText('能力信息')).toBeInTheDocument()
    expect(within(builtin).getByText('实例名')).toBeInTheDocument()
    expect(within(builtin).getByText('NPU 芯片')).toBeInTheDocument()
    expect(within(builtin).queryByRole('button', { name: /编\s*辑/ })).not.toBeInTheDocument()
  })

  it('自定义字段列表带分页，超过一页时只渲染当前页', async () => {
    const manyFields: AttributeDefinition[] = Array.from({ length: 12 }, (_, index) => ({
      id: `def-${index}`,
      attribute_key: `field_${index}`,
      display_name: `字段 ${index}`,
      value_type: 'text',
      resource_category: 'host',
      required: false,
      status: 'active',
      enabled: true,
      display_group: 'profile',
      display_group_label: '画像信息',
      display_order: index,
    }))
    listModelsMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostModel({ custom_fields: manyFields })] },
    })
    render(<CIModelPage />)

    const customSection = await screen.findByTestId('custom-field-section')
    expect(screen.getByText('共 12 个字段')).toBeInTheDocument()
    expect(document.querySelector('.ant-pagination')).toBeTruthy()
    expect(within(customSection).getAllByText(/^字段 \d+$/)).toHaveLength(10)
  })

  it('内置字段的分组列可按分组筛选', async () => {
    render(<CIModelPage />)

    const builtin = await screen.findByTestId('builtin-field-section')
    const groupHeader = within(builtin).getByRole('columnheader', { name: /分组/ })
    const trigger = groupHeader.querySelector('.ant-table-filter-trigger') as HTMLElement | null
    expect(trigger, '分组列应有筛选入口').toBeTruthy()
    fireEvent.click(trigger!)

    const dropdown = document.querySelector('.ant-table-filter-dropdown') as HTMLElement | null
    expect(dropdown, '列头筛选浮层应已打开').toBeTruthy()
    fireEvent.click(await within(dropdown!).findByText('能力信息'))
    const confirm = within(dropdown!).queryByRole('button', { name: /确\s*定|OK/ })
    if (confirm) fireEvent.click(confirm)

    await waitFor(() => {
      expect(within(builtin).queryByText('实例名')).not.toBeInTheDocument()
    })
    expect(within(builtin).getByText('NPU 芯片')).toBeInTheDocument()
  })

  it('普通用户只能查看 CI 模型：隐藏新增/编辑/移除入口并提示联系管理员', async () => {
    setRole('user')
    render(<CIModelPage />)

    const customSection = await screen.findByTestId('custom-field-section')
    expect(screen.getByTestId('ci-model-readonly-notice')).toBeInTheDocument()
    expect(screen.queryByTestId('create-custom-field')).not.toBeInTheDocument()
    expect(within(customSection).queryByRole('button', { name: /编\s*辑/ })).not.toBeInTheDocument()
    expect(within(customSection).queryByRole('button', { name: /移\s*除/ })).not.toBeInTheDocument()
    // 只读视图仍展示字段内容，便于资源登记时了解可用字段。
    expect(within(customSection).getByText('机柜位置')).toBeInTheDocument()
  })
})

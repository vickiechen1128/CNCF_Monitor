import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setupAntdTest } from '../../test/antdTestUtils'
import { MonitorTypePage } from './MonitorTypePage'

const listMock = vi.fn()
const scopeFieldsMock = vi.fn()
const createMock = vi.fn()
const updateMock = vi.fn()

vi.mock('../../api/monitorTypes', () => ({
  monitorTypeApi: {
    list: (...args: unknown[]) => listMock(...args),
    scopeFields: (...args: unknown[]) => scopeFieldsMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    remove: vi.fn(),
    impact: vi.fn(),
  },
}))

const HOST_LINUX = {
  code: 'host_linux',
  name: 'Linux 主机',
  resource_category: 'host',
  rule_logic: 'all',
  sort_order: 10,
  enabled: true,
  is_builtin: true,
  rules: [{ field: 'os_family', operator: 'eq', values: ['linux'] }],
}

const HOST_NPU = {
  code: 'host_npu',
  name: 'NPU 主机',
  resource_category: 'host',
  rule_logic: 'all',
  sort_order: 30,
  enabled: true,
  is_builtin: true,
  rules: [{ field: 'has_npu', operator: 'eq', values: ['true'] }],
}

const SCOPE_FIELDS = [
  { key: 'os_family', label: '操作系统家族', kind: 'os_family', categories: ['host'] },
  { key: 'has_npu', label: '是否带 NPU', kind: 'boolean', categories: ['host'] },
]

beforeEach(() => {
  listMock.mockReset()
  scopeFieldsMock.mockReset()
  createMock.mockReset()
  updateMock.mockReset()
  listMock.mockResolvedValue({ status: 'success', data: { list: [HOST_LINUX, HOST_NPU], total: 2 } })
  scopeFieldsMock.mockResolvedValue({ status: 'success', data: { list: SCOPE_FIELDS, total: 2 } })
})

describe('MonitorTypePage', () => {
  setupAntdTest()

  it('lists configurable monitor types with their derivation rules', async () => {
    render(
      <MemoryRouter>
        <MonitorTypePage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('host_linux')).toBeInTheDocument()
    expect(screen.getByText('host_npu')).toBeInTheDocument()
    expect(screen.getByText('Linux 主机')).toBeInTheDocument()
    // 规则以「字段 + 操作符 + 取值」的形式展示，便于核对候选收敛口径
    expect(screen.getByText(/os_family 等于 linux/)).toBeInTheDocument()
    expect(screen.getByText(/has_npu 等于 true/)).toBeInTheDocument()
    // 内置类型不提供删除入口（只能停用）
    expect(screen.queryByTestId('delete-host_linux')).not.toBeInTheDocument()
  })

  it('shows an error banner when the registry cannot be loaded', async () => {
    listMock.mockRejectedValue(new Error('boom'))
    render(
      <MemoryRouter>
        <MonitorTypePage />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument())
  })

  it('opens the create drawer with a capability rule prefilled', async () => {
    render(
      <MemoryRouter>
        <MonitorTypePage />
      </MemoryRouter>,
    )
    await screen.findByText('host_npu')

    fireEvent.click(screen.getByTestId('create-monitor-type'))
    expect(await screen.findByText('新增监控对象类型')).toBeInTheDocument()
    expect(screen.getByTestId('submit-monitor-type')).toBeInTheDocument()
  })
})

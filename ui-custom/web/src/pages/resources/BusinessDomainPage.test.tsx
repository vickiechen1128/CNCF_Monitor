import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { setupAntdTest } from '../../test/antdTestUtils'
import { BusinessDomainPage } from './BusinessDomainPage'
import { BusinessDomainDrawer } from './BusinessDomainDrawer'
import { DICT_LIFECYCLE_NOTICE } from './DictLifecycleNotice'
import type { BusinessDomain } from '../../types/resource'

const listMock = vi.fn()
const createMock = vi.fn()
const updateMock = vi.fn()
const revokeMock = vi.fn()
const mergeMock = vi.fn()
const auditListMock = vi.fn()

vi.mock('../../api/resources', () => ({
  businessDomainApi: {
    list: (...args: unknown[]) => listMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    revoke: (...args: unknown[]) => revokeMock(...args),
    merge: (...args: unknown[]) => mergeMock(...args),
  },
  dictionaryAuditApi: {
    list: (...args: unknown[]) => auditListMock(...args),
  },
}))

const domains: BusinessDomain[] = [
  {
    code: 'infra',
    name: '公共基础设施',
    description: '无业务归属设备的兜底分组',
    enabled: true,
    status: 'enabled',
    reference_count: 3,
  },
  {
    code: 'payment',
    name: '支付业务',
    description: '支付域',
    enabled: true,
    status: 'enabled',
    reference_count: 0,
  },
  {
    code: 'data-api',
    name: '数据接口业务',
    description: '数据接口域',
    enabled: false,
    status: 'disabled',
    reference_count: 1,
  },
  {
    code: 'legacy-biz',
    name: '旧业务',
    description: '已并入支付',
    enabled: false,
    status: 'merged',
    merged_into: 'payment',
    reference_count: 0,
  },
  {
    code: 'revoked-biz',
    name: '撤销业务',
    description: '建错后撤销',
    enabled: false,
    status: 'revoked',
    reference_count: 0,
  },
]

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/business-domains']}>
      <Routes>
        <Route path="/business-domains" element={<BusinessDomainPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('BusinessDomainPage', () => {
  setupAntdTest()

  beforeEach(() => {
    listMock.mockReset()
    createMock.mockReset()
    updateMock.mockReset()
    revokeMock.mockReset()
    mergeMock.mockReset()
    auditListMock.mockReset()
    listMock.mockResolvedValue({ status: 'success', data: { list: domains, total: domains.length } })
    createMock.mockResolvedValue({
      status: 'success',
      data: { code: 'risk-control', name: '风控业务', enabled: true, status: 'enabled', reference_count: 0 },
    })
    updateMock.mockResolvedValue({
      status: 'success',
      data: { code: 'payment', name: '支付业务', enabled: true, status: 'enabled', reference_count: 0 },
    })
    revokeMock.mockResolvedValue({
      status: 'success',
      data: { code: 'payment', name: '支付业务', enabled: false, status: 'revoked', reference_count: 0 },
    })
    mergeMock.mockResolvedValue({
      status: 'success',
      data: { source: 'payment', target: 'infra', moved_references: 0 },
    })
    auditListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0 } })
  })

  it('默认只展示有效条目，停用条目以「名称（已停用）」标识', async () => {
    renderPage()
    expect(await screen.findByText('infra')).toBeInTheDocument()
    expect(screen.getByText('支付业务')).toBeInTheDocument()
    // 停用条目按「业务名（已停用）」展示（决策 22）
    expect(screen.getByText('数据接口业务（已停用）')).toBeInTheDocument()
    // 终态默认不出现在「有效条目」视图中（SRS FR-24）
    expect(screen.queryByText('旧业务（已合并）')).toBeNull()
    expect(screen.queryByText('撤销业务（已撤销）')).toBeNull()
    expect(listMock).toHaveBeenCalledTimes(1)
  })

  it('切换到「全部」后展示已合并 / 已撤销及合并目标', async () => {
    renderPage()
    await screen.findByText('infra')

    await userEvent.click(screen.getByText('全部'))

    expect(await screen.findByText('旧业务（已合并）')).toBeInTheDocument()
    expect(screen.getByText('已合并 → payment')).toBeInTheDocument()
    expect(screen.getByText('撤销业务（已撤销）')).toBeInTheDocument()
    expect(screen.getByText('已撤销')).toBeInTheDocument()
  })

  it('展示引用数；有引用的条目撤销按钮禁用并提示先停用或合并', async () => {
    renderPage()
    await screen.findByText('infra')

    const infraRow = screen.getByText('infra').closest('tr')!
    expect(within(infraRow).getByText('3')).toBeInTheDocument()
    const revoke = within(infraRow).getByRole('button', { name: '撤销' })
    expect(revoke).toBeDisabled()

    // 零引用条目可撤销：二次确认后调用 revoke
    const paymentRow = screen.getByText('payment').closest('tr')!
    await userEvent.click(within(paymentRow).getByRole('button', { name: '撤销' }))
    await userEvent.click(await screen.findByRole('button', { name: /确认撤销/ }))
    await waitFor(() => expect(revokeMock).toHaveBeenCalledWith('payment'))
  })

  it('合并弹窗展示历史数据提示，确认后把源编码与目标编码提交给后端', async () => {
    renderPage()
    await screen.findByText('infra')

    const paymentRow = screen.getByText('payment').closest('tr')!
    await userEvent.click(within(paymentRow).getByRole('button', { name: '合并' }))

    expect(await screen.findByText('合并会迁移引用，历史监控数据不追溯改写')).toBeInTheDocument()
    fireEvent.mouseDown(document.querySelector('.ant-modal .ant-select-selector') as HTMLElement)
    fireEvent.click(await screen.findByText('公共基础设施（infra）', { selector: '.ant-select-item-option-content' }))
    await userEvent.click(screen.getByRole('button', { name: /确认合并/ }))

    await waitFor(() => expect(mergeMock).toHaveBeenCalledWith('payment', 'infra'))
  })

  it('终态条目不可编辑、启停、撤销或再次合并', async () => {
    renderPage()
    await screen.findByText('infra')
    await userEvent.click(screen.getByText('全部'))

    const mergedRow = (await screen.findByText('旧业务（已合并）')).closest('tr')!
    expect(within(mergedRow).getByRole('button', { name: /编\s*辑/ })).toBeDisabled()
    expect(within(mergedRow).queryByRole('button', { name: '停用' })).toBeNull()
    expect(within(mergedRow).queryByRole('button', { name: '撤销' })).toBeNull()
    expect(within(mergedRow).queryByRole('button', { name: '合并' })).toBeNull()

    const revokedRow = screen.getByText('撤销业务（已撤销）').closest('tr')!
    expect(within(revokedRow).getByRole('button', { name: /编\s*辑/ })).toBeDisabled()
  })

  it('点击「登记业务」打开登记抽屉（标题可见），表单覆盖登记态', async () => {
    renderPage()
    await screen.findByText('infra')

    await userEvent.click(screen.getByRole('button', { name: /登记业务/ }))
    expect(await screen.findByText('登记业务分组')).toBeInTheDocument()
    // 登记态：编码可填、名称可填
    expect(await screen.findByLabelText('业务编码')).toBeInTheDocument()
    expect(screen.getByText('编码创建后不可改')).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()
  })

  // F7 / 决策 112：字典 ≠ 可删除对象——顶部定位说明 + 无删除入口（停用不删除红线）
  it('渲染生命周期说明，且不提供删除入口', async () => {
    renderPage()
    await screen.findByText('infra')

    expect(screen.getByText(DICT_LIFECYCLE_NOTICE)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /删除/ })).toBeNull()
    expect(within(screen.getByText('payment').closest('tr')!).getByRole('button', { name: '停用' })).toBeInTheDocument()
  })

  it('infra 不再有兜底特例，「停用」按钮可正常使用', async () => {
    renderPage()
    await screen.findByText('infra')

    const infraRow = screen.getByText('infra').closest('tr')!
    expect(within(infraRow).getByRole('button', { name: '停用' })).toBeEnabled()
  })
})

describe('BusinessDomainDrawer', () => {
  setupAntdTest()

  beforeEach(() => {
    listMock.mockReset()
    createMock.mockReset()
    updateMock.mockReset()
    createMock.mockResolvedValue({
      status: 'success',
      data: { code: 'risk-control', name: '风控业务', enabled: true, status: 'enabled', reference_count: 0 },
    })
    updateMock.mockResolvedValue({
      status: 'success',
      data: { code: 'payment', name: '支付业务', enabled: true, status: 'enabled', reference_count: 0 },
    })
  })

  it('登记校验失败：编码不规范时字段下方提示，且不调用 create', async () => {
    render(<BusinessDomainDrawer open record={null} onCancel={() => {}} onSuccess={() => {}} />)

    await userEvent.type(screen.getByLabelText('业务编码'), 'Bad_Ops')
    await userEvent.type(screen.getByLabelText('业务名称'), '风控业务')
    // antd Button 对 2 字中文自动加空格渲染为「提 交」，用正则去空白匹配
    await userEvent.click(screen.getByText(/提\s*交/))

    expect(await screen.findByText('编码仅允许小写字母、数字、连字符（≤ 64 字符）')).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('登记合法编码调用 create 提交 {code,name,description}', async () => {
    render(<BusinessDomainDrawer open record={null} onCancel={() => {}} onSuccess={() => {}} />)

    await userEvent.type(screen.getByLabelText('业务编码'), 'risk-control')
    await userEvent.type(screen.getByLabelText('业务名称'), '风控业务')
    await userEvent.click(screen.getByText(/提\s*交/))

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        code: 'risk-control',
        name: '风控业务',
        description: undefined,
      }),
    )
  })

  it('受限编辑仅提交 name/description/enabled，不携带 code', async () => {
    render(<BusinessDomainDrawer open record={domains[1]} onCancel={() => {}} onSuccess={() => {}} />)

    // 编码只读展示，名称可改
    const codeInput = await screen.findByLabelText('业务编码')
    expect(codeInput).toBeDisabled()

    const nameInput = screen.getByLabelText('业务名称')
    expect(nameInput).toHaveValue('支付业务')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, '支付业务(新)')

    await userEvent.click(screen.getByText(/保\s*存/))

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith('payment', {
        name: '支付业务(新)',
        description: '支付域',
        enabled: true,
      }),
    )
    // 断言请求体不含 code：update 仅收到 code 键 + 三个可编辑字段
    const [codeArg, bodyArg] = updateMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(codeArg).toBe('payment')
    expect(bodyArg).not.toHaveProperty('code')
  })
})

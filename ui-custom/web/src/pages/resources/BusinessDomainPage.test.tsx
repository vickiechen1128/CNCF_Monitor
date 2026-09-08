import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { setupAntdTest } from '../../test/antdTestUtils'
import { BusinessDomainPage, BusinessDomainDrawer } from './BusinessDomainPage'
import type { BusinessDomain } from '../../types/resource'

const listMock = vi.fn()
const createMock = vi.fn()
const updateMock = vi.fn()

vi.mock('../../api/resources', () => ({
  businessDomainApi: {
    list: (...args: unknown[]) => listMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
  },
}))

const domains: BusinessDomain[] = [
  { code: 'infra', name: '公共基础设施', description: '无业务归属设备的兜底分组', enabled: true },
  { code: 'payment', name: '支付业务', description: '支付域', enabled: true },
  { code: 'data-api', name: '数据接口业务', description: '数据接口域', enabled: false },
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
    listMock.mockResolvedValue({ status: 'success', data: { list: domains, total: domains.length } })
    createMock.mockResolvedValue({ status: 'success', data: { code: 'risk-control', name: '风控业务', enabled: true } })
    updateMock.mockResolvedValue({ status: 'success', data: { code: 'payment', name: '支付业务', enabled: true } })
  })

  it('加载并渲染业务分组列表，停用条目以「名称（已停用）」标识', async () => {
    renderPage()
    expect(await screen.findByText('infra')).toBeInTheDocument()
    expect(screen.getByText('支付业务')).toBeInTheDocument()
    // 停用条目按「业务名（已停用）」展示（决策 22）
    expect(screen.getByText('数据接口业务（已停用）')).toBeInTheDocument()
    expect(listMock).toHaveBeenCalledTimes(1)
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

  it('infra 兜底条目「停用」按钮禁用，并带不可停用提示', async () => {
    renderPage()
    await screen.findByText('infra')

    const infraRow = screen.getByText('infra').closest('tr')!
    const stopBtn = within(infraRow).getByRole('button', { name: '停用' })
    expect(stopBtn).toBeDisabled()

    // hover 触发 Tooltip 文案
    await userEvent.hover(stopBtn)
    expect(await screen.findByText('infra 为无业务归属设备的兜底分组，不可停用')).toBeInTheDocument()
  })
})

describe('BusinessDomainDrawer', () => {
  setupAntdTest()

  beforeEach(() => {
    listMock.mockReset()
    createMock.mockReset()
    updateMock.mockReset()
    createMock.mockResolvedValue({ status: 'success', data: { code: 'risk-control', name: '风控业务', enabled: true } })
    updateMock.mockResolvedValue({ status: 'success', data: { code: 'payment', name: '支付业务', enabled: true } })
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
    render(
      <BusinessDomainDrawer
        open
        record={domains[1]}
        onCancel={() => {}}
        onSuccess={() => {}}
      />,
    )

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
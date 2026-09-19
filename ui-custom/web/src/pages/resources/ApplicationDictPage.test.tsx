import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { setupAntdTest } from '../../test/antdTestUtils'
import { ApplicationDictPage, ApplicationDictDrawer } from './ApplicationDictPage'
import type { ApplicationDict } from '../../types/resource'

const listMock = vi.fn()
const createMock = vi.fn()
const updateMock = vi.fn()

vi.mock('../../api/resources', () => ({
  applicationDictApi: {
    list: (...args: unknown[]) => listMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
  },
}))

const apps: ApplicationDict[] = [
  { app_code: 'order-service', app_name: '订单服务', description: '订单主链路', status: 'enabled' },
  { app_code: 'pay-service', app_name: '支付服务', description: '支付域', status: 'enabled' },
  { app_code: 'legacy-portal', app_name: '已下线应用', description: '停用中', status: 'disabled' },
]

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/application-dict']}>
      <Routes>
        <Route path="/application-dict" element={<ApplicationDictPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ApplicationDictPage', () => {
  setupAntdTest()

  beforeEach(() => {
    listMock.mockReset()
    createMock.mockReset()
    updateMock.mockReset()
    listMock.mockResolvedValue({ status: 'success', data: { list: apps, total: apps.length } })
    createMock.mockResolvedValue({ status: 'success', data: { app_code: 'gateway-service', app_name: '网关服务', status: 'enabled' } })
    updateMock.mockResolvedValue({ status: 'success', data: { app_code: 'pay-service', app_name: '支付服务', status: 'enabled' } })
  })

  it('加载并渲染应用字典列表，停用条目以「应用名（已停用）」标识', async () => {
    renderPage()
    expect(await screen.findByText('order-service')).toBeInTheDocument()
    expect(screen.getByText('支付服务')).toBeInTheDocument()
    // 停用条目按「应用名（已停用）」展示（§5.19 / 决策 22 同口径）
    expect(screen.getByText('已下线应用（已停用）')).toBeInTheDocument()
    expect(listMock).toHaveBeenCalledTimes(1)
  })

  it('点击「登记应用」打开登记抽屉（标题可见），表单覆盖登记态', async () => {
    renderPage()
    await screen.findByText('order-service')

    await userEvent.click(screen.getByRole('button', { name: /登记应用/ }))
    // 抽屉标题与触发按钮同名，用登记态提示文案确认抽屉已打开
    expect(await screen.findByText('应用编码创建后不可改')).toBeInTheDocument()
    // 登记态：编码可填、名称可填
    expect(await screen.findByLabelText('应用编码')).toBeInTheDocument()
    expect(screen.getByText('应用编码创建后不可改')).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('停用 / 启用走确认弹层并按 status 枚举提交', async () => {
    renderPage()
    await screen.findByText('order-service')

    const row = screen.getByText('order-service').closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: '停用' }))
    await userEvent.click(await screen.findByText('确认停用'))
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('order-service', { status: 'disabled' }))
  })
})

describe('ApplicationDictDrawer', () => {
  setupAntdTest()

  beforeEach(() => {
    listMock.mockReset()
    createMock.mockReset()
    updateMock.mockReset()
    createMock.mockResolvedValue({ status: 'success', data: { app_code: 'gateway-service', app_name: '网关服务', status: 'enabled' } })
    updateMock.mockResolvedValue({ status: 'success', data: { app_code: 'pay-service', app_name: '支付服务', status: 'enabled' } })
  })

  it('登记校验失败：编码不规范时字段下方提示，且不调用 create', async () => {
    render(<ApplicationDictDrawer open record={null} onCancel={() => {}} onSuccess={() => {}} />)

    await userEvent.type(screen.getByLabelText('应用编码'), 'Bad_Ops')
    await userEvent.type(screen.getByLabelText('应用名'), '网关服务')
    // antd Button 对 2 字中文自动加空格渲染为「提 交」，用正则去空白匹配
    await userEvent.click(screen.getByText(/提\s*交/))

    expect(await screen.findByText('编码仅允许小写字母、数字、连字符（≤ 64 字符）')).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('登记合法编码调用 create 提交 {app_code,app_name,description}', async () => {
    render(<ApplicationDictDrawer open record={null} onCancel={() => {}} onSuccess={() => {}} />)

    await userEvent.type(screen.getByLabelText('应用编码'), 'gateway-service')
    await userEvent.type(screen.getByLabelText('应用名'), '网关服务')
    await userEvent.click(screen.getByText(/提\s*交/))

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        app_code: 'gateway-service',
        app_name: '网关服务',
        description: undefined,
      }),
    )
  })

  it('受限编辑仅提交 app_name/description/status，不携带 app_code', async () => {
    render(
      <ApplicationDictDrawer
        open
        record={apps[1]}
        onCancel={() => {}}
        onSuccess={() => {}}
      />,
    )

    // 编码只读展示，名称可改
    const codeInput = await screen.findByLabelText('应用编码')
    expect(codeInput).toBeDisabled()

    const nameInput = screen.getByLabelText('应用名')
    expect(nameInput).toHaveValue('支付服务')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, '支付服务(新)')

    await userEvent.click(screen.getByText(/保\s*存/))

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith('pay-service', {
        app_name: '支付服务(新)',
        description: '支付域',
        status: 'enabled',
      }),
    )
    // 断言请求体不含 app_code：update 仅收到 app_code 键 + 三个可编辑字段（§5.19 红线①）
    const [codeArg, bodyArg] = updateMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(codeArg).toBe('pay-service')
    expect(bodyArg).not.toHaveProperty('app_code')
  })
})

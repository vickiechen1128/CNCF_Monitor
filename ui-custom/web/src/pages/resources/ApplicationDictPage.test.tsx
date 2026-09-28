import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { setupAntdTest } from '../../test/antdTestUtils'
import { ApplicationDictPage, ApplicationDictDrawer } from './ApplicationDictPage'
import type { ApplicationDict, PlatformDict } from '../../types/resource'

const listMock = vi.fn()
const createMock = vi.fn()
const updateMock = vi.fn()
const platformListMock = vi.fn()

vi.mock('../../api/resources', () => ({
  applicationDictApi: {
    list: (...args: unknown[]) => listMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
  },
  platformDictApi: {
    list: (...args: unknown[]) => platformListMock(...args),
  },
}))

const apps: ApplicationDict[] = [
  { app_code: 'order-service', app_name: '订单服务', description: '订单主链路', status: 'enabled', platform_code: 'ecommerce' },
  { app_code: 'pay-service', app_name: '支付服务', description: '支付域', status: 'enabled' },
  { app_code: 'legacy-portal', app_name: '已下线应用', description: '停用中', status: 'disabled', platform_code: 'legacy-pf' },
  // 字典缺条分支：platform_code 不在平台字典中 → 回退展示编码
  { app_code: 'ghost-app', app_name: '幽灵应用', description: '缺条回退', status: 'enabled', platform_code: 'ghost-pf' },
]

/** 平台字典：ecommerce 启用、legacy-pf 停用 */
const platforms: PlatformDict[] = [
  { platform_code: 'ecommerce', platform_name: '电商中台', description: '交易主链路', enabled: true },
  { platform_code: 'legacy-pf', platform_name: '已下线平台', description: '停用中', enabled: false },
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
    platformListMock.mockReset()
    platformListMock.mockResolvedValue({ status: 'success', data: { list: platforms, total: platforms.length } })
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

  it('「所属平台」列：启用展示平台名 / 停用加标识 / 字典缺条回退编码 / 未挂显示 -', async () => {
    renderPage()
    await screen.findByText('order-service')

    expect(within(screen.getByText('order-service').closest('tr')!).getByText('电商中台')).toBeInTheDocument()
    expect(
      within(screen.getByText('legacy-portal').closest('tr')!).getByText('已下线平台（已停用）'),
    ).toBeInTheDocument()
    // 字典缺条：回退显示 platform_code（契约快照 §5A 展示名解析）
    expect(within(screen.getByText('ghost-app').closest('tr')!).getByText('ghost-pf')).toBeInTheDocument()
    // 未挂平台：'-'
    expect(within(screen.getByText('pay-service').closest('tr')!).getByText('-')).toBeInTheDocument()
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
        platform_code: null,
        status: 'enabled',
      }),
    )
    // 断言请求体不含 app_code：update 仅收到 app_code 键 + 三个可编辑字段（§5.19 红线①）
    const [codeArg, bodyArg] = updateMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(codeArg).toBe('pay-service')
    expect(bodyArg).not.toHaveProperty('app_code')
  })

  it('「所属平台」下拉仅列启用平台条目', async () => {
    render(<ApplicationDictDrawer open record={apps[0]} platforms={platforms} onCancel={() => {}} onSuccess={() => {}} />)

    await userEvent.click(await screen.findByLabelText('所属平台'))
    // 已选中项与下拉选项同名，用 option 角色区分
    expect(await screen.findByRole('option', { name: '电商中台（ecommerce）' })).toBeInTheDocument()
    // 停用平台不出现在下拉（仅启用项可被选用）
    expect(screen.queryByRole('option', { name: /已下线平台/ })).not.toBeInTheDocument()
  })

  it('「所属平台」可清空，清空后提交 platform_code=null 表达摘除', async () => {
    render(<ApplicationDictDrawer open record={apps[0]} platforms={platforms} onCancel={() => {}} onSuccess={() => {}} />)

    // 回显当前所属平台
    expect(await screen.findByTitle('电商中台（ecommerce）')).toBeInTheDocument()
    // antd clear 图标由 CSS 控制显隐，jsdom 下用 fireEvent 直接触发（绕过 pointer-events 检查）
    const clear = document.querySelector('.ant-select-clear') as HTMLElement
    expect(clear).toBeTruthy()
    fireEvent.mouseDown(clear)
    fireEvent.click(clear)
    await waitFor(() => expect(document.querySelector('.ant-select-selection-item')).toBeNull())

    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith('order-service', {
        app_name: '订单服务',
        description: '订单主链路',
        platform_code: null,
        status: 'enabled',
      }),
    )
  })
})

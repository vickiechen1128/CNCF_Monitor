import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { setupAntdTest } from '../../test/antdTestUtils'
import { ApplicationDictPage, ApplicationDictDrawer } from './ApplicationDictPage'
import { DICT_LIFECYCLE_NOTICE } from './DictLifecycleNotice'
import type { AppPlatformRel, ApplicationDict, PlatformDict } from '../../types/resource'

const listMock = vi.fn()
const createMock = vi.fn()
const updateMock = vi.fn()
const platformListMock = vi.fn()
const relListMock = vi.fn()
const relCreateMock = vi.fn()
const relUpdateMock = vi.fn()
const relRemoveMock = vi.fn()

vi.mock('../../api/resources', () => ({
  applicationDictApi: {
    list: (...args: unknown[]) => listMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
  },
  platformDictApi: {
    list: (...args: unknown[]) => platformListMock(...args),
  },
  // 决策 111：应用↔平台关联（app_platform_rel）——平台关系权威
  appPlatformRelApi: {
    list: (...args: unknown[]) => relListMock(...args),
    create: (...args: unknown[]) => relCreateMock(...args),
    update: (...args: unknown[]) => relUpdateMock(...args),
    remove: (...args: unknown[]) => relRemoveMock(...args),
  },
}))

const apps: ApplicationDict[] = [
  { app_code: 'order-service', app_name: '订单服务', description: '订单主链路', status: 'enabled' },
  { app_code: 'pay-service', app_name: '支付服务', description: '支付域', status: 'enabled' },
  { app_code: 'legacy-portal', app_name: '已下线应用', description: '停用中', status: 'disabled' },
  // 无关联分支：无任何 app_platform_rel → 平台列 '-'
  { app_code: 'orphan-app', app_name: '孤立应用', description: '无平台关联', status: 'enabled' },
]

/** 平台字典：ecommerce / public-data-auth 启用，legacy-pf 停用 */
const platforms: PlatformDict[] = [
  { platform_code: 'ecommerce', platform_name: '电商中台', description: '交易主链路', enabled: true },
  { platform_code: 'public-data-auth', platform_name: '公共数据授权平台', description: '数据授权', enabled: true },
  { platform_code: 'legacy-pf', platform_name: '已下线平台', description: '停用中', enabled: false },
]

/**
 * 应用↔平台关联：订单服务跨「电商中台（主）」+「已下线平台（历史停用关联）」；
 * 已下线应用挂电商中台（主）；孤立应用无关联。
 */
const rels: AppPlatformRel[] = [
  { rel_id: 'rel-1', app_code: 'order-service', platform_code: 'ecommerce', is_primary: true },
  { rel_id: 'rel-3', app_code: 'order-service', platform_code: 'legacy-pf', is_primary: false },
  { rel_id: 'rel-4', app_code: 'legacy-portal', platform_code: 'ecommerce', is_primary: true },
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

/**
 * 等待抽屉的存量关联反查回填完成（多选回显项渲染出停用历史关联即为信号）。
 * 注意「电商中台」同时出现在所属平台（多选回显）与主平台（单选回显）两处，
 * 故以仅存在于停用回显项的文案作为唯一信号。
 */
async function waitRelsLoaded() {
  await waitFor(() => expect(screen.getAllByTitle('已下线平台（已停用）').length).toBeGreaterThanOrEqual(1))
}

/**
 * antd 下拉选项定位：选项文本包在 `.ant-select-item-option-content` 内。
 * 用该选择器限定，避免与「已选 tag」的 `.ant-select-selection-item`（同名文本）误匹配。
 * 选项点击统一用 `fireEvent.click`（jsdom 下 `userEvent.click` 对多选下拉的选中不生效）。
 */
async function findOption(text: string) {
  return screen.findByText(text, { selector: '.ant-select-item-option-content' })
}

describe('ApplicationDictPage', () => {
  setupAntdTest()

  beforeEach(() => {
    listMock.mockReset()
    createMock.mockReset()
    updateMock.mockReset()
    platformListMock.mockReset()
    relListMock.mockReset()
    relCreateMock.mockReset()
    relUpdateMock.mockReset()
    relRemoveMock.mockReset()
    platformListMock.mockResolvedValue({ status: 'success', data: { list: platforms, total: platforms.length } })
    listMock.mockResolvedValue({ status: 'success', data: { list: apps, total: apps.length } })
    // 列表列反查走全量关联（不带 app_code 过滤）
    relListMock.mockImplementation((params?: { app_code?: string }) =>
      Promise.resolve({
        status: 'success' as const,
        data: { list: params?.app_code ? rels.filter((r) => r.app_code === params.app_code) : rels, total: rels.length },
      }),
    )
    relCreateMock.mockResolvedValue({ status: 'success', data: { rel_id: 'rel-new', app_code: 'x', platform_code: 'y', is_primary: false } })
    relUpdateMock.mockResolvedValue({ status: 'success', data: { rel_id: 'rel-1', app_code: 'x', platform_code: 'y', is_primary: true } })
    relRemoveMock.mockResolvedValue({ status: 'success', data: { rel_id: 'rel-1' } })
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

  // F7 / 决策 112：字典 ≠ 可删除对象——顶部定位说明 + 无删除入口（停用不删除红线）
  it('渲染「字典 ≠ 可删除对象」定位说明，且不提供删除入口', async () => {
    renderPage()
    await screen.findByText('order-service')

    expect(screen.getByText(DICT_LIFECYCLE_NOTICE)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /删除/ })).toBeNull()
    const row = screen.getByText('order-service').closest('tr')!
    expect(within(row).getByRole('button', { name: /编\s*辑/ })).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /删除/ })).toBeNull()
  })

  it('停用 / 启用走确认弹层并按 status 枚举提交', async () => {
    renderPage()
    await screen.findByText('order-service')

    const row = screen.getByText('order-service').closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: '停用' }))
    await userEvent.click(await screen.findByText('确认停用'))
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('order-service', { status: 'disabled' }))
  })

  // F2 / 决策 111：列表「平台」列罗列全部关联平台（主平台「（主）」、停用「（已停用）」、无关联 '-'）
  it('决策 111：「所属平台」列罗列多平台，主平台带「（主）」、停用带标识、无关联显示 -', async () => {
    renderPage()
    await screen.findByText('order-service')

    const orderRow = within(screen.getByText('order-service').closest('tr')!)
    expect(orderRow.getByText('电商中台（主）')).toBeInTheDocument()
    expect(orderRow.getByText('已下线平台（已停用）')).toBeInTheDocument()

    // 已下线应用：单关联 + 主平台标记
    const legacyRow = within(screen.getByText('legacy-portal').closest('tr')!)
    expect(legacyRow.getByText('电商中台（主）')).toBeInTheDocument()

    // 无关联：'-'
    expect(within(screen.getByText('orphan-app').closest('tr')!).getByText('-')).toBeInTheDocument()
  })
})

describe('ApplicationDictDrawer', () => {
  setupAntdTest()

  beforeEach(() => {
    listMock.mockReset()
    createMock.mockReset()
    updateMock.mockReset()
    relListMock.mockReset()
    relCreateMock.mockReset()
    relUpdateMock.mockReset()
    relRemoveMock.mockReset()
    createMock.mockResolvedValue({ status: 'success', data: { app_code: 'gateway-service', app_name: '网关服务', status: 'enabled' } })
    updateMock.mockResolvedValue({ status: 'success', data: { app_code: 'order-service', app_name: '订单服务', status: 'enabled' } })
    relListMock.mockImplementation((params?: { app_code?: string }) =>
      Promise.resolve({
        status: 'success' as const,
        data: { list: params?.app_code ? rels.filter((r) => r.app_code === params.app_code) : rels, total: rels.length },
      }),
    )
    relCreateMock.mockResolvedValue({ status: 'success', data: { rel_id: 'rel-new', app_code: 'order-service', platform_code: 'public-data-auth', is_primary: false } })
    relUpdateMock.mockResolvedValue({ status: 'success', data: { rel_id: 'rel-3', app_code: 'order-service', platform_code: 'legacy-pf', is_primary: true } })
    relRemoveMock.mockResolvedValue({ status: 'success', data: { rel_id: 'rel-3' } })
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

  it('登记合法编码调用 create 提交 {app_code,app_name,description}（不含 platform_code）', async () => {
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
    const [bodyArg] = createMock.mock.calls[0] as [Record<string, unknown>]
    // 决策 111：应用字典写链路不再承载 platform_code
    expect(bodyArg).not.toHaveProperty('platform_code')
  })

  it('受限编辑仅提交 app_name/description/status，不携带 app_code 与 platform_code', async () => {
    render(
      <ApplicationDictDrawer
        open
        record={apps[1]}
        platforms={platforms}
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
    const [codeArg, bodyArg] = updateMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(codeArg).toBe('pay-service')
    expect(bodyArg).not.toHaveProperty('app_code')
    expect(bodyArg).not.toHaveProperty('platform_code')
  })

  // F2：多选下拉 = 启用平台项 ∪ 已选停用项回显，且按编码去重（不重复渲染）
  it('决策 111：「所属平台」多选下拉仅列启用项 + 停用历史关联回显，且按编码去重', async () => {
    render(<ApplicationDictDrawer open record={apps[0]} platforms={platforms} onCancel={() => {}} onSuccess={() => {}} />)

    // 等待存量关联反查回填（电商中台 + 已下线平台）
    await waitRelsLoaded()
    fireEvent.mouseDown(screen.getByLabelText('所属平台'))

    expect(await findOption('电商中台（ecommerce）')).toBeInTheDocument()
    expect(await findOption('公共数据授权平台（public-data-auth）')).toBeInTheDocument()
    // 停用平台原不在启用项内，因存量关联回显为「已下线平台（已停用）」
    expect(await findOption('已下线平台（已停用）')).toBeInTheDocument()
    // 去重：启用项与回显项各只渲染一次——下拉恰好 3 个选项（电商中台 / 公共数据授权平台 / 已下线平台），无重复渲染
    expect(document.querySelectorAll('.ant-select-item-option').length).toBe(3)
  })

  // F2：主平台选项恒为已选平台子集——未选平台不可选，选中后即时纳入
  it('决策 111：「主平台」下拉选项恒为已选平台子集，随多选联动', async () => {
    render(<ApplicationDictDrawer open record={apps[0]} platforms={platforms} onCancel={() => {}} onSuccess={() => {}} />)

    await waitRelsLoaded()
    fireEvent.mouseDown(screen.getByLabelText('主平台'))

    expect(await screen.findByRole('option', { name: '电商中台（ecommerce）' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '已下线平台（已停用）' })).toBeInTheDocument()
    // 未选平台不出现在主平台下拉
    expect(screen.queryByRole('option', { name: '公共数据授权平台（public-data-auth）' })).toBeNull()

    // 在「所属平台」中补选该平台后，主平台下拉即时纳入
    fireEvent.mouseDown(screen.getByLabelText('所属平台'))
    fireEvent.click(await findOption('公共数据授权平台（public-data-auth）'))
    fireEvent.mouseDown(screen.getByLabelText('主平台'))
    expect(await screen.findByRole('option', { name: '公共数据授权平台（public-data-auth）' })).toBeInTheDocument()
  })

  // F2：rel diff ① 新增关联 → POST /app-platform-rel
  it('决策 111：新增关联走 POST /app-platform-rel（先 PUT 应用基础字段）', async () => {
    render(<ApplicationDictDrawer open record={apps[0]} platforms={platforms} onCancel={() => {}} onSuccess={() => {}} />)

    await waitRelsLoaded()
    fireEvent.mouseDown(screen.getByLabelText('所属平台'))
    fireEvent.click(await findOption('公共数据授权平台（public-data-auth）'))
    const saveBtn = screen.getByRole('button', { name: /保\s*存/ })
    await userEvent.click(saveBtn)

    await waitFor(() =>
      expect(relCreateMock).toHaveBeenCalledWith({
        app_code: 'order-service',
        platform_code: 'public-data-auth',
        is_primary: false,
      }),
    )
    // 提交序列：先应用基础字段，再关联
    expect(updateMock.mock.invocationCallOrder[0]).toBeLessThan(relCreateMock.mock.invocationCallOrder[0])
  })

  // F2：rel diff ② 解绑关联 → DELETE /app-platform-rel/:rel_id
  it('决策 111：清空所属平台即解绑，走 DELETE /app-platform-rel/:rel_id', async () => {
    render(<ApplicationDictDrawer open record={apps[0]} platforms={platforms} onCancel={() => {}} onSuccess={() => {}} />)

    await waitRelsLoaded()
    // antd clear 图标由 CSS 控制显隐，jsdom 下用 fireEvent 直接触发（绕过 pointer-events 检查）
    const clear = document.querySelector('.ant-select-clear') as HTMLElement
    expect(clear).toBeTruthy()
    fireEvent.mouseDown(clear)
    fireEvent.click(clear)
    await waitFor(() => expect(document.querySelector('.ant-select-selection-item')).toBeNull())

    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
    await waitFor(() => expect(relRemoveMock).toHaveBeenCalledWith('rel-1'))
    expect(relRemoveMock).toHaveBeenCalledWith('rel-3')
    expect(relCreateMock).not.toHaveBeenCalled()
  })

  // F2：rel diff ③ 主平台切换 → PUT /app-platform-rel/:rel_id {is_primary:true}
  it('决策 111：主平台切换走 PUT /app-platform-rel/:rel_id', async () => {
    render(<ApplicationDictDrawer open record={apps[0]} platforms={platforms} onCancel={() => {}} onSuccess={() => {}} />)

    await waitRelsLoaded()
    fireEvent.mouseDown(screen.getByLabelText('主平台'))
    fireEvent.click(await findOption('已下线平台（已停用）'))
    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => expect(relUpdateMock).toHaveBeenCalledWith('rel-3', { is_primary: true }))
  })

  // F2：关联写失败须显式报错（不静默丢关系）
  it('决策 111：关联写入失败时提示错误，不静默丢弃关系变更', async () => {
    relCreateMock.mockRejectedValue(new Error('平台已停用，禁止新增关联'))
    render(<ApplicationDictDrawer open record={apps[0]} platforms={platforms} onCancel={() => {}} onSuccess={() => {}} />)

    await waitRelsLoaded()
    fireEvent.mouseDown(screen.getByLabelText('所属平台'))
    fireEvent.click(await findOption('公共数据授权平台（public-data-auth）'))
    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    expect(await screen.findByText('平台已停用，禁止新增关联')).toBeInTheDocument()
    expect(screen.getByText('保存失败')).toBeInTheDocument()
  })
})

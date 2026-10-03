/**
 * 通知渠道管理页测试（PL-3 通知渲染桥，T08-F10 / T08-F13）。
 * 覆盖：列表渲染与脱敏展示 / 空态 / 权限不足 / 接口错误 / 新增表单校验 + 提交 payload /
 * 编辑不回填脱敏值且留空不提交 webhook_url / 删除二次确认 /
 * 「接收人配置」片段抽屉（展示 / 复制 / 令牌未配置告警 / 403 友好提示 / 接口错误可重试 / 加载态）。
 * antd 稳定模式见 src/test/antdTestUtils.tsx（Step 3.6）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { App } from 'antd'
import { setupAntdTest, mockAntdModal } from '../../test/antdTestUtils'
import { ApiError } from '../../api/client'
import { NotifyChannelsPage } from './NotifyChannelsPage'
import type { NotifyChannel, NotifyTemplate } from '../../types/alertmanager'

const useNotifyChannelsMock = vi.fn()
vi.mock('./useNotifyChannels', () => ({
  useNotifyChannels: (...a: unknown[]) => useNotifyChannelsMock(...a),
}))

const useDerivedReceiversMock = vi.fn()
vi.mock('./useDerivedReceivers', () => ({
  useDerivedReceivers: (...a: unknown[]) => useDerivedReceiversMock(...a),
}))

const getReceiverSnippetMock = vi.fn()
const listTemplatesMock = vi.fn()
vi.mock('../../api/alertmanager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/alertmanager')>()
  return {
    ...actual,
    notifyChannelsApi: {
      ...actual.notifyChannelsApi,
      getReceiverSnippet: (...a: unknown[]) => getReceiverSnippetMock(...a),
    },
    notifyTemplatesApi: {
      ...actual.notifyTemplatesApi,
      list: (...a: unknown[]) => listTemplatesMock(...a),
    },
  }
})

const reloadMock = vi.fn()
const createMock = vi.fn()
const updateMock = vi.fn()
const removeMock = vi.fn()

const channelRow = (over: Partial<NotifyChannel> = {}): NotifyChannel => ({
  id: '1',
  name: 'SRE 飞书群',
  type: 'feishu',
  webhook_url: 'https://open.feishu.cn/***',
  secret_set: true,
  enabled: true,
  created_at: '2026-09-28T10:00:00Z',
  ...over,
})

/** 通知模板行（渠道抽屉模板下拉数据源） */
const templateRow = (over: Partial<NotifyTemplate> = {}): NotifyTemplate => ({
  id: '9',
  name: '自定义卡片',
  channel_type: 'feishu',
  content: '{"msg_type":"text"}',
  is_builtin: false,
  checksum: 'ck',
  status: 'applied',
  created_at: '2026-09-30T00:00:00Z',
  ...over,
})

/** 接收人片段端点响应（B 路线 wire 格式：桥令牌走 authorization 头，不含 URL query token） */
function snippetResponse(over: Record<string, unknown> = {}) {
  const data = {
    receiver_name: 'sre',
    url: 'http://127.0.0.1:18081/api/v1/webhooks/notify?channel=1',
    snippet:
      "  - name: sre\n    webhook_configs:\n      - url: 'http://127.0.0.1:18081/api/v1/webhooks/notify?channel=1'\n        send_resolved: true\n        http_config:\n          authorization:\n            type: Bearer\n            credentials: tok-abc\n",
    token_configured: true,
    ...over,
  }
  return { status: 'success', data }
}

function result(over: Record<string, unknown> = {}) {
  return {
    channels: [],
    loading: false,
    error: null,
    permissionDenied: false,
    reload: reloadMock,
    create: createMock,
    update: updateMock,
    remove: removeMock,
    ...over,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <App>
        <NotifyChannelsPage />
      </App>
    </MemoryRouter>,
  )
}

describe('NotifyChannelsPage（通知渠道管理）', () => {
  setupAntdTest()

  beforeEach(() => {
    useNotifyChannelsMock.mockReset()
    reloadMock.mockReset()
    createMock.mockReset()
    createMock.mockResolvedValue(channelRow())
    updateMock.mockReset()
    updateMock.mockResolvedValue(channelRow())
    removeMock.mockReset()
    removeMock.mockResolvedValue(undefined)
    getReceiverSnippetMock.mockReset()
    getReceiverSnippetMock.mockResolvedValue(snippetResponse())
    listTemplatesMock.mockReset()
    listTemplatesMock.mockResolvedValue({ status: 'success', data: { items: [], total: 0 } })
    // 派生接收人默认空态（无已启用渠道 / 未取到片段）；具体断言在各自用例内覆盖返回值
    useDerivedReceiversMock.mockReset()
    useDerivedReceiversMock.mockReturnValue({
      rows: [],
      loading: false,
      error: null,
      permissionDenied: false,
      reload: vi.fn(),
    })
  })

  it('页头渲染渠道名称与新增入口', () => {
    useNotifyChannelsMock.mockReturnValue(result())
    renderPage()
    // MainLayout 侧边栏二级菜单 + 页面 Card 标题均出现「通知渠道」
    expect(screen.getAllByText('通知渠道').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /新增渠道/ })).toBeInTheDocument()
  })

  // B 路线（决策 74）：需说明「本页是接收人来源」，并给出「自动写入、配置即生效」心智，
  // 同时指向「告警配置」页，避免两页各说一套。
  // 2026-10-02 四页说明区统一：说明收进「这个页面管什么」折叠区（默认收起），需先展开。
  it('B 路线：说明区讲清接收人来源、自动写入心智并指向 /alert-config', () => {
    useNotifyChannelsMock.mockReturnValue(result())
    renderPage()
    fireEvent.click(screen.getByTestId('notify-channels-intro-guide-label'))
    expect(screen.getByText(/本页是告警接收人的来源/)).toBeInTheDocument()
    expect(screen.getByText(/会被平台在下发配置时自动写入/)).toBeInTheDocument()
    // 说明区与片段抽屉都指向「告警配置」页（forceRender 下抽屉内容常驻，故用 getAll）
    const configLinks = screen.getAllByRole('link', { name: '「告警配置」' })
    expect(configLinks.length).toBeGreaterThan(0)
    expect(configLinks.every((l) => l.getAttribute('href') === '/alert-config')).toBe(true)
  })

  // 2026-10-02 四页说明区统一（components/PageIntro.tsx）：页头=标题+一行副标+主按钮，
  // 机制说明收进默认收起的「这个页面管什么」折叠区。
  it('PageIntro：页头副标一行定位 + 主按钮，机制说明默认收起', () => {
    useNotifyChannelsMock.mockReturnValue(result())
    renderPage()
    expect(screen.getByTestId('notify-channels-intro')).toBeInTheDocument()
    expect(screen.getByTestId('notify-channels-intro-subtitle').textContent ?? '').toContain(
      '登记告警送达的机器人渠道',
    )
    // 主按钮仍在页头右侧操作位
    expect(screen.getByRole('button', { name: /新增渠道/ })).toBeInTheDocument()
    // 说明区默认收起：要点不在 DOM
    expect(screen.getByTestId('notify-channels-intro-guide-label')).toBeInTheDocument()
    expect(screen.queryByTestId('notify-channels-intro-guide-points')).toBeNull()
  })

  it('渲染渠道列表：类型展示名 + 脱敏 webhook + 加签已设置', async () => {
    useNotifyChannelsMock.mockReturnValue(result({ channels: [channelRow()] }))
    renderPage()
    expect(await screen.findByText('SRE 飞书群')).toBeInTheDocument()
    expect(screen.getAllByText('飞书').length).toBeGreaterThan(0)
    // webhook 仅展示脱敏值，原值不回显
    expect(screen.getAllByText('https://open.feishu.cn/***').length).toBeGreaterThan(0)
    expect(screen.getByText('已设置')).toBeInTheDocument()
  })

  it('空态：无渠道时不渲染具体渠道行', () => {
    useNotifyChannelsMock.mockReturnValue(result())
    renderPage()
    expect(screen.getByRole('button', { name: /新增渠道/ })).toBeInTheDocument()
    expect(screen.queryByText('SRE 飞书群')).toBeNull()
  })

  it('权限不足：显示权限不足空态', () => {
    useNotifyChannelsMock.mockReturnValue(result({ permissionDenied: true }))
    renderPage()
    expect(screen.getByText('当前账号无此页面查看权限')).toBeInTheDocument()
  })

  it('接口错误：Alert + 重新加载触发 reload', () => {
    useNotifyChannelsMock.mockReturnValue(result({ error: 'boom' }))
    renderPage()
    expect(screen.getByText('通知渠道加载失败，请稍后重试')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重新加载/ }))
    expect(reloadMock).toHaveBeenCalled()
  })

  it('新增渠道：必填校验拦截，填齐后提交 payload', async () => {
    const user = userEvent.setup()
    useNotifyChannelsMock.mockReturnValue(result())
    renderPage()
    await user.click(screen.getByRole('button', { name: /新增渠道/ }))
    // 直接提交：客户端必填校验拦截，不触发请求
    await user.click(screen.getByRole('button', { name: /创建渠道/ }))
    expect(await screen.findByText('请填写渠道名称')).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('渠道名称'), '数据库团队群')
    await user.type(
      screen.getByLabelText('机器人 Webhook'),
      'https://oapi.dingtalk.com/robot/send?access_token=abc',
    )
    await user.click(screen.getByRole('button', { name: /创建渠道/ }))
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        name: '数据库团队群',
        type: 'feishu',
        webhook_url: 'https://oapi.dingtalk.com/robot/send?access_token=abc',
        enabled: true,
      }),
    )
  })

  it('编辑：不回填脱敏 webhook_url，留空提交不含 webhook_url / secret', async () => {
    const user = userEvent.setup()
    useNotifyChannelsMock.mockReturnValue(result({ channels: [channelRow()] }))
    renderPage()
    await user.click(await screen.findByRole('button', { name: /编辑/ }))

    // 名称回显，但 webhook_url 不回填脱敏值（仅作占位提示）
    expect((screen.getByLabelText('渠道名称') as HTMLInputElement).value).toBe('SRE 飞书群')
    expect((screen.getByLabelText('机器人 Webhook') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('签名密钥（选填）') as HTMLInputElement).value).toBe('')

    await user.click(screen.getByRole('button', { name: /保存修改/ }))
    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    const [id, payload] = updateMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(id).toBe('1')
    // 未选模板 → default_template_id: 0（显式解绑，回落内置默认）
    expect(payload).toEqual({ name: 'SRE 飞书群', type: 'feishu', enabled: true, default_template_id: 0 })
    expect(payload).not.toHaveProperty('webhook_url')
    expect(payload).not.toHaveProperty('secret')
  })

  // 渠道 ↔ 模板一等绑定（dev-feedback #30）：抽屉可选绑定模板，payload 带 default_template_id；
  // 并给出「复制内置模板」引流入口（指向 /notify-templates）。
  it('新增渠道：可选绑定通知模板，payload 带 default_template_id 且提供模板页引流入口', async () => {
    const user = userEvent.setup()
    listTemplatesMock.mockResolvedValue({
      status: 'success',
      data: { items: [templateRow({ id: '9', name: '自定义卡片' })], total: 1 },
    })
    useNotifyChannelsMock.mockReturnValue(result())
    renderPage()
    await user.click(screen.getByRole('button', { name: /新增渠道/ }))
    await user.type(screen.getByLabelText('渠道名称'), '数据库团队群')
    await user.type(screen.getByLabelText('机器人 Webhook'), 'https://open.feishu.cn/hook/x')

    // 引流入口指向通知模板页
    const tplLinks = screen.getAllByRole('link', { name: '通知模板' })
    expect(tplLinks.some((l) => l.getAttribute('href') === '/notify-templates')).toBe(true)

    // 打开模板下拉并选择绑定
    fireEvent.mouseDown(screen.getByLabelText('通知模板'))
    await user.click(await screen.findByTitle('自定义卡片'))

    await user.click(screen.getByRole('button', { name: /创建渠道/ }))
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        name: '数据库团队群',
        type: 'feishu',
        webhook_url: 'https://open.feishu.cn/hook/x',
        enabled: true,
        default_template_id: 9,
      }),
    )
  })

  it('删除：二次确认后调用 remove', async () => {
    useNotifyChannelsMock.mockReturnValue(result({ channels: [channelRow()] }))
    const modal = mockAntdModal()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /删除/ }))
    expect(modal.confirm).toHaveBeenCalled()
    const conf = modal.confirm.mock.calls[0][0]
    expect(conf.title).toContain('SRE 飞书群')
    expect(conf.okText).toBe('删除')
    await (conf.onOk as () => Promise<void>)()
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('1'))
  })

  // B 路线（决策 74 / 安全 H-1）：抽屉展示平台派生的接收人片段供「自定义接收人」参考；
  // 桥令牌走 authorization 请求头，URL 中不得出现 token=。
  it('接收人配置：抽屉展示接收人名 / 桥接地址 / 片段，令牌走 authorization 头且 URL 不含 token', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    useNotifyChannelsMock.mockReturnValue(result({ channels: [channelRow()] }))
    renderPage()

    await user.click(await screen.findByRole('button', { name: /接收人配置/ }))

    expect(await screen.findByText('sre')).toBeInTheDocument()
    expect(screen.getByText('接收人名')).toBeInTheDocument()
    expect(screen.getByText('桥接地址')).toBeInTheDocument()
    expect(screen.getAllByText(/webhooks\/notify\?channel=1/).length).toBeGreaterThan(0)
    expect(screen.getByText(/send_resolved: true/)).toBeInTheDocument()
    // 安全（H-1）：桥令牌不得出现在 URL query，改走 authorization 请求头
    expect(screen.queryByText(/token=/)).toBeNull()
    expect(screen.getByText(/authorization:/)).toBeInTheDocument()
    // 说明该片段要用在哪，并给出「告警配置」页入口
    const configLinks = screen.getAllByRole('link', { name: '「告警配置」' })
    expect(configLinks.length).toBeGreaterThan(0)
    expect(configLinks.every((l) => l.getAttribute('href') === '/alert-config')).toBe(true)
    // 安全文案（#27）：片段含内网凭据降级为片段标题右侧行内 tag（Tooltip 展开说明），不再整块 Alert
    expect(screen.getByText('含内网凭据')).toBeInTheDocument()
    // L3（#26 / #28.5，T08-F9）：归属边界说明贴在 receiver 片段块上——平台自动写入 receivers 定义；
    // 具体分流 route.routes[] 由用户写；根兜底 route.receiver 在用户选定默认接收人后由平台接管。
    expect(screen.getByText(/在你选定默认接收人后由平台接管/)).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toContain('route 段由你手写维护')

    await user.click(screen.getByRole('button', { name: /复制配置片段/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(snippetResponse().data.snippet))
  })

  it('接收人配置：桥令牌未配置时显式告警（片段不可直接使用）', async () => {
    const user = userEvent.setup()
    getReceiverSnippetMock.mockResolvedValue(
      snippetResponse({ token_configured: false, url: 'http://127.0.0.1:18081/api/v1/webhooks/notify?channel=1' }),
    )
    useNotifyChannelsMock.mockReturnValue(result({ channels: [channelRow()] }))
    renderPage()

    await user.click(await screen.findByRole('button', { name: /接收人配置/ }))
    expect(await screen.findByText('通知暂不可用')).toBeInTheDocument()
    expect(screen.getByText(/平台尚未配置通知桥令牌，该片段当前不可用/)).toBeInTheDocument()
  })

  it('接收人配置：非管理员（403）给出友好中文提示，不暴露技术错误串', async () => {
    const user = userEvent.setup()
    getReceiverSnippetMock.mockRejectedValue(
      new ApiError('forbidden', 403, 'forbidden', { status: 'error', error: 'forbidden', errorType: 'forbidden' }),
    )
    useNotifyChannelsMock.mockReturnValue(result({ channels: [channelRow()] }))
    renderPage()

    await user.click(await screen.findByRole('button', { name: /接收人配置/ }))
    expect(await screen.findByText('权限不足')).toBeInTheDocument()
    expect(screen.getByText(/仅管理员可获取/)).toBeInTheDocument()
    expect(screen.queryByText(/forbidden/)).toBeNull()
    expect(screen.getByRole('button', { name: /复制配置片段/ })).toBeDisabled()
  })

  it('接收人配置：接口错误时展示可重试错误条（非 403 走通用错误态）', async () => {
    const user = userEvent.setup()
    getReceiverSnippetMock.mockRejectedValueOnce(new ApiError('服务暂时不可用', 500, 'internal'))
    getReceiverSnippetMock.mockResolvedValue(snippetResponse())
    useNotifyChannelsMock.mockReturnValue(result({ channels: [channelRow()] }))
    renderPage()

    await user.click(await screen.findByRole('button', { name: /接收人配置/ }))
    expect(await screen.findByText('接收人配置获取失败')).toBeInTheDocument()
    expect(screen.queryByText('权限不足')).toBeNull()

    // 重试后成功：错误条消失、片段正常展示
    await user.click(screen.getByRole('button', { name: /重试/ }))
    expect(await screen.findByText('sre')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('接收人配置获取失败')).toBeNull())
  })

  it('接收人配置：打开时为独立加载态，加载完成后展示片段', async () => {
    const user = userEvent.setup()
    let resolveSnippet: (v: unknown) => void = () => {}
    getReceiverSnippetMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSnippet = resolve
        }),
    )
    useNotifyChannelsMock.mockReturnValue(result({ channels: [channelRow()] }))
    renderPage()

    await user.click(await screen.findByRole('button', { name: /接收人配置/ }))
    expect(await screen.findByText('加载中…')).toBeInTheDocument()

    resolveSnippet(snippetResponse())
    await waitFor(() => expect(screen.queryByText('加载中…')).toBeNull())
    expect(await screen.findByText('sre')).toBeInTheDocument()
  })

  it('编辑抽屉关闭后重新打开仍正确回显（forceRender 回归，Step 3.7）', async () => {
    const user = userEvent.setup()
    useNotifyChannelsMock.mockReturnValue(result({ channels: [channelRow()] }))
    renderPage()
    await user.click(await screen.findByRole('button', { name: /编辑/ }))
    expect((screen.getByLabelText('渠道名称') as HTMLInputElement).value).toBe('SRE 飞书群')

    // 关闭后再打开：回显不得丢失，且脱敏字段仍不回填
    // 页面内两个抽屉均 forceRender（常驻 DOM），须按表单所在抽屉定位关闭按钮，避免误关片段抽屉
    const editDrawer = screen.getByLabelText('渠道名称').closest('.ant-drawer') as HTMLElement
    fireEvent.click(editDrawer.querySelector('.ant-drawer-close') as HTMLElement)
    await user.click(screen.getByRole('button', { name: /编辑/ }))
    expect((await screen.findByLabelText('渠道名称') as HTMLInputElement).value).toBe('SRE 飞书群')
    expect((screen.getByLabelText('机器人 Webhook') as HTMLInputElement).value).toBe('')
  })

  // =====================================================================
  // 2026-10-02 用户意见：「平台自动生成的接收人」由告警配置页高级区迁入本页表格，
  // 落为「平台接收人」列——它是**渠道的产物**，只在渠道上下文里有意义；原先放在告警配置页
  // 既割裂又与本页行内「接收人配置」抽屉形成「同源能力两份」。
  // 列内只给结论（接收人名 / 模板绑定 / 可用性）；片段 YAML 与复制仍由抽屉承载（单一来源）。
  // =====================================================================
  const derivedRow = (over: Record<string, unknown> = {}) => ({
    channelId: '1',
    channelName: 'SRE 飞书群',
    receiverName: 'sre-feishu-qun',
    snippet: "  - name: sre-feishu-qun\n    webhook_configs:\n      - url: 'http://127.0.0.1:18081/api/v1/webhooks/notify?channel=1'\n",
    tokenConfigured: true,
    defaultTemplateId: 10,
    channelType: 'feishu',
    ...over,
  })

  it('平台接收人列：展示平台为已启用渠道生成的接收人名与模板绑定', async () => {
    useNotifyChannelsMock.mockReturnValue(
      result({ channels: [channelRow(), channelRow({ id: '2', name: '运维钉钉群', type: 'dingtalk' })] }),
    )
    useDerivedReceiversMock.mockReturnValue({
      rows: [
        derivedRow(),
        derivedRow({ channelId: '2', channelName: '运维钉钉群', receiverName: 'ops-dingtalk-qun', defaultTemplateId: undefined, channelType: 'dingtalk' }),
      ],
      loading: false,
      error: null,
      permissionDenied: false,
      reload: vi.fn(),
    })
    listTemplatesMock.mockResolvedValue({
      status: 'success',
      data: { items: [templateRow({ id: '10', name: '飞书卡片-默认', channel_type: 'feishu' })], total: 1 },
    })
    renderPage()
    // 列标题与页头说明各出现一次（页头说明里以「见「平台接收人」列」形式指引）
    expect(screen.getAllByText('平台接收人').length).toBeGreaterThanOrEqual(1)
    expect(await screen.findByText('sre-feishu-qun')).toBeInTheDocument()
    // 已绑定 → 解析出模板名（dev-feedback #32口径随区块迁入）
    expect(screen.getByText('模板：飞书卡片-默认')).toBeInTheDocument()
    // 未绑定 → 提示回落该渠道类型的内置默认模板
    expect(screen.getByText('回落钉钉 内置默认模板')).toBeInTheDocument()
    // 片段 YAML 不在列内重复（单一来源：行内「接收人配置」抽屉）
    expect(document.body.textContent ?? '').not.toContain('webhook_configs')
    // 重名提醒收进统一的说明区（不再悬在表格下方，避免与说明重复）
    fireEvent.click(screen.getByTestId('notify-channels-intro-guide-label'))
    expect(screen.getByText(/请勿手写与自动生成同名/)).toBeInTheDocument()
  })

  it('平台接收人列：停用渠道显示「停用后不再生成」（不参与派生）', async () => {
    useNotifyChannelsMock.mockReturnValue(result({ channels: [channelRow({ enabled: false })] }))
    useDerivedReceiversMock.mockReturnValue({
      rows: [],
      loading: false,
      error: null,
      permissionDenied: false,
      reload: vi.fn(),
    })
    renderPage()
    expect(await screen.findByText('停用后不再生成')).toBeInTheDocument()
  })

  it('平台接收人列：桥令牌未配置时标「暂不可用」', async () => {
    useNotifyChannelsMock.mockReturnValue(result({ channels: [channelRow()] }))
    useDerivedReceiversMock.mockReturnValue({
      rows: [derivedRow({ tokenConfigured: false })],
      loading: false,
      error: null,
      permissionDenied: false,
      reload: vi.fn(),
    })
    renderPage()
    expect(await screen.findByText('sre-feishu-qun')).toBeInTheDocument()
    expect(screen.getByText('暂不可用')).toBeInTheDocument()
  })

  it('平台接收人列：模板列表无权限时降级为「模板 #<id>」，不阻断整列', async () => {
    useNotifyChannelsMock.mockReturnValue(result({ channels: [channelRow()] }))
    useDerivedReceiversMock.mockReturnValue({
      rows: [derivedRow()],
      loading: false,
      error: null,
      permissionDenied: false,
      reload: vi.fn(),
    })
    listTemplatesMock.mockRejectedValue(new ApiError('forbidden', 403, 'forbidden'))
    renderPage()
    expect(await screen.findByText('模板 #10')).toBeInTheDocument()
    expect(screen.queryByText(/模板：/)).toBeNull()
  })

  it('平台接收人列：片段接口 403 时降级为「需管理员权限查看」，不误报空态', async () => {
    useNotifyChannelsMock.mockReturnValue(result({ channels: [channelRow()] }))
    useDerivedReceiversMock.mockReturnValue({
      rows: [],
      loading: false,
      error: null,
      permissionDenied: true,
      reload: vi.fn(),
    })
    renderPage()
    expect(await screen.findByText('需管理员权限查看')).toBeInTheDocument()
    expect(screen.queryByText('暂不可见')).toBeNull()
  })
})
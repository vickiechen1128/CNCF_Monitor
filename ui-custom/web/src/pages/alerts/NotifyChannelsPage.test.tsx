/**
 * 通知渠道管理页测试（2026-10-22 渠道/模板/路由解耦后）。
 * 覆盖：列表渲染与脱敏 / 路由引用提示 / 被引用渠道删除拦截 / 新增与编辑 payload /
 * 模板绑定 / 接收人配置片段 / 权限不足 / 接口错误。
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
  receiver_name: 'notify-1',
  route_reference_count: 0,
  default_template_id: undefined,
  created_at: '2026-09-28T10:00:00Z',
  ...over,
})

const templateRow = (over: Partial<NotifyTemplate> = {}): NotifyTemplate => ({
  id: '9',
  name: '自定义卡片',
  channel_type: 'feishu',
  is_builtin: false,
  bound_channel_count: 0,
  created_at: '2026-09-30T00:00:00Z',
  updated_at: '2026-09-30T00:00:00Z',
  ...over,
})

function snippetResponse(over: Record<string, unknown> = {}) {
  const data = {
    receiver_name: 'notify-1',
    url: 'http://127.0.0.1:18081/api/v1/webhooks/notify?id=1',
    snippet:
      "  - name: notify-1\n    webhook_configs:\n      - url: 'http://127.0.0.1:18081/api/v1/webhooks/notify?id=1'\n        send_resolved: true\n        http_config:\n          authorization:\n            type: Bearer\n            credentials: tok-abc\n",
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
    listTemplatesMock.mockResolvedValue({
      status: 'success',
      data: { items: [templateRow()], total: 1 },
    })
  })

  it('页头渲染与新增入口', () => {
    useNotifyChannelsMock.mockReturnValue(result())
    renderPage()
    expect(screen.getAllByText('通知渠道').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /新增渠道/ })).toBeInTheDocument()
  })

  it('说明区讲清「只有被路由引用的渠道才物化」', () => {
    useNotifyChannelsMock.mockReturnValue(result())
    renderPage()
    fireEvent.click(screen.getByTestId('notify-channels-intro-guide-label'))
    expect(screen.getByText(/只有被路由规则引用的渠道才会写入 alertmanager.yml/)).toBeInTheDocument()
  })

  it('列表渲染：脱敏 webhook、receiver 名、路由引用数、模板绑定', async () => {
    useNotifyChannelsMock.mockReturnValue(
      result({ channels: [channelRow({ route_reference_count: 2, default_template_id: 9 })] }),
    )
    renderPage()
    expect(await screen.findByText('SRE 飞书群')).toBeInTheDocument()
    expect(screen.getAllByText('飞书').length).toBeGreaterThan(0)
    expect(screen.getAllByText('https://open.feishu.cn/***').length).toBeGreaterThan(0)
    expect(screen.getByText('已设置')).toBeInTheDocument()
    expect(screen.getByText('notify-1')).toBeInTheDocument()
    expect(screen.getByText('被 2 条路由引用')).toBeInTheDocument()
    expect(await screen.findByText('模板：自定义卡片')).toBeInTheDocument()
  })

  it('未被路由引用是正常状态：不显示提示标记', async () => {
    useNotifyChannelsMock.mockReturnValue(result({ channels: [channelRow()] }))
    renderPage()
    expect(await screen.findByText('notify-1')).toBeInTheDocument()
    expect(screen.queryByText('未被路由引用')).toBeNull()
  })

  it('删除被路由引用的渠道：只提示去改绑，不调用 remove', async () => {
    useNotifyChannelsMock.mockReturnValue(result({ channels: [channelRow({ route_reference_count: 2 })] }))
    const modal = mockAntdModal()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /删除/ }))
    expect(modal.warning).toHaveBeenCalled()
    expect(modal.confirm).not.toHaveBeenCalled()
    expect(removeMock).not.toHaveBeenCalled()
  })

  it('删除未引用渠道：二次确认后调用 remove', async () => {
    useNotifyChannelsMock.mockReturnValue(result({ channels: [channelRow()] }))
    const modal = mockAntdModal()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /删除/ }))
    expect(modal.confirm).toHaveBeenCalled()
    const conf = modal.confirm.mock.calls[0][0]
    expect(conf.title).toContain('SRE 飞书群')
    await (conf.onOk as () => Promise<void>)()
    expect(removeMock).toHaveBeenCalledWith('1')
  })

  it('新增渠道：必填校验拦截，填齐后提交 payload（不含 enabled）', async () => {
    const user = userEvent.setup()
    useNotifyChannelsMock.mockReturnValue(result())
    renderPage()
    await user.click(screen.getByRole('button', { name: /新增渠道/ }))
    await user.click(screen.getByRole('button', { name: /创建渠道/ }))
    expect(await screen.findByText('请填写渠道名称')).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('渠道名称'), '数据库团队群')
    await user.type(
      screen.getByLabelText('机器人 Webhook'),
      'https://open.feishu.cn/open-apis/bot/v2/hook/abc',
    )
    await user.click(screen.getByRole('button', { name: /创建渠道/ }))
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        name: '数据库团队群',
        type: 'feishu',
        webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc',
      }),
    )
  })

  it('编辑：不回填脱敏 webhook_url，提交不含 enabled / webhook_url / secret', async () => {
    const user = userEvent.setup()
    useNotifyChannelsMock.mockReturnValue(result({ channels: [channelRow()] }))
    renderPage()
    await user.click(await screen.findByRole('button', { name: /编辑/ }))
    expect((screen.getByLabelText('渠道名称') as HTMLInputElement).value).toBe('SRE 飞书群')
    expect((screen.getByLabelText('机器人 Webhook') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('签名密钥（选填）') as HTMLInputElement).value).toBe('')

    await user.click(screen.getByRole('button', { name: /保存修改/ }))
    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    const [id, payload] = updateMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(id).toBe('1')
    expect(payload).toEqual({ name: 'SRE 飞书群', type: 'feishu', default_template_id: 0 })
    expect(payload).not.toHaveProperty('enabled')
    expect(payload).not.toHaveProperty('webhook_url')
    expect(payload).not.toHaveProperty('secret')
  })

  it('新增渠道：可选绑定通知模板，payload 带 default_template_id', async () => {
    const user = userEvent.setup()
    useNotifyChannelsMock.mockReturnValue(result())
    renderPage()
    await user.click(screen.getByRole('button', { name: /新增渠道/ }))
    await user.type(screen.getByLabelText('渠道名称'), '数据库团队群')
    await user.type(screen.getByLabelText('机器人 Webhook'), 'https://open.feishu.cn/hook/x')

    fireEvent.mouseDown(screen.getByLabelText('通知模板'))
    await user.click(await screen.findByTitle('自定义卡片'))

    await user.click(screen.getByRole('button', { name: /创建渠道/ }))
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        name: '数据库团队群',
        type: 'feishu',
        webhook_url: 'https://open.feishu.cn/hook/x',
        default_template_id: 9,
      }),
    )
  })

  it('接收人配置：展示 notify-<id> 与 ?id= 桥地址，复制片段', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    useNotifyChannelsMock.mockReturnValue(result({ channels: [channelRow()] }))
    renderPage()

    await user.click(await screen.findByRole('button', { name: /接收人配置/ }))
    expect((await screen.findAllByText('notify-1')).length).toBeGreaterThan(0)
    expect(screen.getByText('接收人名')).toBeInTheDocument()
    expect(screen.getByText('桥接地址')).toBeInTheDocument()
    expect(screen.getAllByText(/webhooks\/notify\?id=1/).length).toBeGreaterThan(0)
    expect(screen.getByText(/send_resolved: true/)).toBeInTheDocument()
    expect(screen.queryByText(/token=/)).toBeNull()
    expect(screen.getByText(/authorization:/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /复制配置片段/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(snippetResponse().data.snippet))
  })

  it('接收人配置：非管理员（403）给出友好中文提示', async () => {
    const user = userEvent.setup()
    getReceiverSnippetMock.mockRejectedValue(
      new ApiError('forbidden', 403, 'forbidden', { status: 'error', error: 'forbidden', errorType: 'forbidden' }),
    )
    useNotifyChannelsMock.mockReturnValue(result({ channels: [channelRow()] }))
    renderPage()

    await user.click(await screen.findByRole('button', { name: /接收人配置/ }))
    expect(await screen.findByText('权限不足')).toBeInTheDocument()
    expect(screen.getByText(/仅管理员可获取/)).toBeInTheDocument()
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
})

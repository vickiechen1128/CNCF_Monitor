/**
 * 通知渠道管理页测试（2026-10-22 渠道/模板/路由解耦后）。
 * 覆盖：通用列表渲染 / 被引用次数 / 被引用渠道删除拦截 / 新增与编辑 payload /
 * 模板绑定 / 签名开关 / 权限不足 / 接口错误。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { App } from 'antd'
import { setupAntdTest, mockAntdModal } from '../../test/antdTestUtils'
import { NotifyChannelsPage } from './NotifyChannelsPage'
import type { NotifyChannel, NotifyTemplate } from '../../types/alertmanager'

const useNotifyChannelsMock = vi.fn()
vi.mock('./useNotifyChannels', () => ({
  useNotifyChannels: (...a: unknown[]) => useNotifyChannelsMock(...a),
}))

const listTemplatesMock = vi.fn()

vi.mock('../../api/alertmanager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/alertmanager')>()
  return {
    ...actual,
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

const builtinTemplate = (over: Partial<NotifyTemplate> = {}): NotifyTemplate => ({
  id: '1',
  name: '飞书卡片-默认',
  channel_type: 'feishu',
  is_builtin: true,
  bound_channel_count: 0,
  created_at: '2026-09-30T00:00:00Z',
  updated_at: '2026-09-30T00:00:00Z',
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
    listTemplatesMock.mockReset()
    listTemplatesMock.mockResolvedValue({
      status: 'success',
      data: { items: [builtinTemplate(), templateRow()], total: 2 },
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

  it('列表只展示通用字段：名称 / 类型 / 被引用次数 / 创建时间', async () => {
    useNotifyChannelsMock.mockReturnValue(
      result({ channels: [channelRow({ route_reference_count: 2, default_template_id: 9 })] }),
    )
    renderPage()
    expect(await screen.findByText('SRE 飞书群')).toBeInTheDocument()
    expect(screen.getAllByText('飞书').length).toBeGreaterThan(0)
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getAllByText('被引用次数').length).toBeGreaterThan(0)
    // 类型独有配置不再出现在列表
    expect(screen.queryByText('https://open.feishu.cn/***')).toBeNull()
    expect(screen.queryByText('已设置')).toBeNull()
    expect(screen.queryByText('notify-1')).toBeNull()
    expect(screen.queryByText('模板：自定义卡片')).toBeNull()
  })

  it('未被路由引用是正常状态：被引用次数显示 0，不做提示', async () => {
    useNotifyChannelsMock.mockReturnValue(result({ channels: [channelRow()] }))
    renderPage()
    expect(await screen.findByText('SRE 飞书群')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
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
      screen.getByLabelText('Webhook 地址'),
      'https://open.feishu.cn/open-apis/bot/v2/hook/abc',
    )
    await user.click(screen.getByRole('button', { name: /创建渠道/ }))
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        name: '数据库团队群',
        type: 'feishu',
        webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc',
        default_template_id: 1,
      }),
    )
  })

  it('自定义 Webhook：隐藏模板与签名，地址必填，payload 不带模板', async () => {
    const user = userEvent.setup()
    useNotifyChannelsMock.mockReturnValue(result())
    renderPage()
    await user.click(screen.getByRole('button', { name: /新增渠道/ }))
    fireEvent.mouseDown(screen.getByLabelText('渠道类型'))
    await user.click(await screen.findByTitle('自定义 Webhook'))
    expect(screen.queryByLabelText('通知模板')).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()

    await user.type(screen.getByLabelText('渠道名称'), '自建告警网关')
    await user.type(screen.getByLabelText('Webhook 地址'), 'https://alert-gateway.example/hook')
    await user.click(screen.getByRole('button', { name: /创建渠道/ }))
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        name: '自建告警网关',
        type: 'webhook',
        webhook_url: 'https://alert-gateway.example/hook',
      }),
    )
  })

  it('钉钉未选模板：提交被必填校验拦截', async () => {
    const user = userEvent.setup()
    useNotifyChannelsMock.mockReturnValue(result())
    renderPage()
    await user.click(screen.getByRole('button', { name: /新增渠道/ }))
    fireEvent.mouseDown(screen.getByLabelText('渠道类型'))
    await user.click(await screen.findByTitle('钉钉'))
    await user.type(screen.getByLabelText('渠道名称'), '钉钉群')
    await user.type(screen.getByLabelText('Webhook 地址'), 'https://oapi.dingtalk.com/robot/send?access_token=x')
    await user.click(screen.getByRole('button', { name: /创建渠道/ }))
    expect(await screen.findByText('请选择通知模板')).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('编辑：回填脱敏地址与 *** 密钥，模板必填并自动选内置模板', async () => {
    const user = userEvent.setup()
    useNotifyChannelsMock.mockReturnValue(result({ channels: [channelRow()] }))
    renderPage()
    await user.click(await screen.findByRole('button', { name: /编辑/ }))
    expect((screen.getByLabelText('渠道名称') as HTMLInputElement).value).toBe('SRE 飞书群')
    // 编辑时回填脱敏值：用户能看到已配置，不修改则原样保留。
    expect((screen.getByLabelText('Webhook 地址') as HTMLInputElement).value).toBe(
      'https://open.feishu.cn/***',
    )
    expect((screen.getByLabelText('签名密钥') as HTMLInputElement).value).toBe('***')

    await user.click(screen.getByRole('button', { name: /保存修改/ }))
    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    const [id, payload] = updateMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(id).toBe('1')
    expect(payload).toEqual({ name: 'SRE 飞书群', type: 'feishu', default_template_id: 1 })
    expect(payload).not.toHaveProperty('enabled')
    expect(payload).not.toHaveProperty('webhook_url')
    expect(payload).not.toHaveProperty('secret')
  })

  it('清空 Webhook 地址：必填校验拦截', async () => {
    const user = userEvent.setup()
    useNotifyChannelsMock.mockReturnValue(result({ channels: [channelRow()] }))
    renderPage()
    await user.click(await screen.findByRole('button', { name: /编辑/ }))
    await user.clear(screen.getByLabelText('Webhook 地址'))
    await user.click(screen.getByRole('button', { name: /保存修改/ }))
    expect(await screen.findByText('请填写 Webhook 地址')).toBeInTheDocument()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('清空签名密钥：必填校验拦截', async () => {
    const user = userEvent.setup()
    useNotifyChannelsMock.mockReturnValue(result({ channels: [channelRow({ secret_set: true })] }))
    renderPage()
    await user.click(await screen.findByRole('button', { name: /编辑/ }))
    await user.clear(screen.getByLabelText('签名密钥'))
    await user.click(screen.getByRole('button', { name: /保存修改/ }))
    expect(await screen.findByText(/请填写飞书签名密钥/)).toBeInTheDocument()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('关闭签名开关：提交 secret 空串以清空已存密钥', async () => {
    const user = userEvent.setup()
    useNotifyChannelsMock.mockReturnValue(result({ channels: [channelRow({ secret_set: true })] }))
    renderPage()
    await user.click(await screen.findByRole('button', { name: /编辑/ }))
    const switchEl = screen.getByRole('switch')
    expect(switchEl).toHaveAttribute('aria-checked', 'true')
    await user.click(switchEl)
    expect(screen.queryByLabelText('签名密钥')).toBeNull()
    await user.click(screen.getByRole('button', { name: /保存修改/ }))
    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    const [, payload] = updateMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(payload.secret).toBe('')
  })

  it('新增渠道：可选绑定通知模板，payload 带 default_template_id', async () => {
    const user = userEvent.setup()
    useNotifyChannelsMock.mockReturnValue(result())
    renderPage()
    await user.click(screen.getByRole('button', { name: /新增渠道/ }))
    await user.type(screen.getByLabelText('渠道名称'), '数据库团队群')
    await user.type(screen.getByLabelText('Webhook 地址'), 'https://open.feishu.cn/hook/x')

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

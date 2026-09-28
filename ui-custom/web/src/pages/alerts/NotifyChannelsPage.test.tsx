/**
 * 通知渠道管理页测试（PL-3 通知渲染桥，T08-F10）。
 * 覆盖：列表渲染与脱敏展示 / 空态 / 权限不足 / 接口错误 / 新增表单校验 + 提交 payload /
 * 编辑不回填脱敏值且留空不提交 webhook_url / 删除二次确认。
 * antd 稳定模式见 src/test/antdTestUtils.tsx（Step 3.6）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { App } from 'antd'
import { setupAntdTest, mockAntdModal } from '../../test/antdTestUtils'
import { NotifyChannelsPage } from './NotifyChannelsPage'
import type { NotifyChannel } from '../../types/alertmanager'

const useNotifyChannelsMock = vi.fn()
vi.mock('./useNotifyChannels', () => ({
  useNotifyChannels: (...a: unknown[]) => useNotifyChannelsMock(...a),
}))

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
  })

  it('页头渲染渠道名称与新增入口', () => {
    useNotifyChannelsMock.mockReturnValue(result())
    renderPage()
    // MainLayout 侧边栏二级菜单 + 页面 Card 标题均出现「通知渠道」
    expect(screen.getAllByText('通知渠道').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /新增渠道/ })).toBeInTheDocument()
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
    expect(payload).toEqual({ name: 'SRE 飞书群', type: 'feishu', enabled: true })
    expect(payload).not.toHaveProperty('webhook_url')
    expect(payload).not.toHaveProperty('secret')
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

  it('编辑抽屉关闭后重新打开仍正确回显（forceRender 回归，Step 3.7）', async () => {
    const user = userEvent.setup()
    useNotifyChannelsMock.mockReturnValue(result({ channels: [channelRow()] }))
    renderPage()
    await user.click(await screen.findByRole('button', { name: /编辑/ }))
    expect((screen.getByLabelText('渠道名称') as HTMLInputElement).value).toBe('SRE 飞书群')

    // 关闭后再打开：回显不得丢失，且脱敏字段仍不回填
    fireEvent.click(document.querySelector('.ant-drawer-close') as HTMLElement)
    await user.click(screen.getByRole('button', { name: /编辑/ }))
    expect((await screen.findByLabelText('渠道名称') as HTMLInputElement).value).toBe('SRE 飞书群')
    expect((screen.getByLabelText('机器人 Webhook') as HTMLInputElement).value).toBe('')
  })
})
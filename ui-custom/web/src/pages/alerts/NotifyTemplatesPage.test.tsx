/**
 * 通知模板管理页测试（PL-3 通知渲染桥，T08-F11）。
 * 覆盖：列表渲染（内置标记 + 渠道中文名）/ 提交校验失败行级错误渲染 / 提交成功 /
 * 回滚（remount）成功 / 内置模板不可删除 / 权限不足 / 抽屉「关闭→打开」回显回归（Step 3.7）。
 * antd 稳定模式见 src/test/antdTestUtils.tsx（Step 3.6）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { App } from 'antd'
import { setupAntdTest, mockAntdModal } from '../../test/antdTestUtils'
import { ApiError } from '../../api/client'
import { NotifyTemplatesPage } from './NotifyTemplatesPage'
import type { NotifyTemplate } from '../../types/alertmanager'

const useNotifyTemplatesMock = vi.fn()
vi.mock('./useNotifyTemplates', () => ({
  useNotifyTemplates: (...a: unknown[]) => useNotifyTemplatesMock(...a),
}))

const reloadMock = vi.fn()
const submitMock = vi.fn()
const remountMock = vi.fn()

const builtinRow: NotifyTemplate = {
  id: '1',
  name: '飞书卡片-默认',
  channel_type: 'feishu',
  content: '{{ define "feishu.card" }}{{ end }}',
  is_builtin: true,
  checksum: 'abc123',
  status: 'applied',
  created_at: '2026-09-28T10:00:00Z',
}

const customRow: NotifyTemplate = {
  id: '2',
  name: '安全告警-钉钉卡片',
  channel_type: 'dingtalk',
  content: '{{ define "dingtalk.card" }}{{ end }}',
  is_builtin: false,
  checksum: 'def456',
  status: 'applied',
  created_at: '2026-09-28T11:00:00Z',
}

function result(over: Record<string, unknown> = {}) {
  return {
    templates: [],
    total: 0,
    loading: false,
    error: null,
    permissionDenied: false,
    reload: reloadMock,
    submit: submitMock,
    remount: remountMock,
    ...over,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <App>
        <NotifyTemplatesPage />
      </App>
    </MemoryRouter>,
  )
}

describe('NotifyTemplatesPage（通知模板管理）', () => {
  setupAntdTest()

  beforeEach(() => {
    useNotifyTemplatesMock.mockReset()
    reloadMock.mockReset()
    submitMock.mockReset()
    submitMock.mockResolvedValue(builtinRow)
    remountMock.mockReset()
    remountMock.mockResolvedValue(customRow)
  })

  it('页头渲染模板名称与提交入口', () => {
    useNotifyTemplatesMock.mockReturnValue(result())
    renderPage()
    expect(screen.getAllByText('通知模板').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /提交自定义模板/ })).toBeInTheDocument()
  })

  it('列表渲染：内置标记、渠道中文名、状态；内置模板显式呈现', async () => {
    useNotifyTemplatesMock.mockReturnValue(result({ templates: [builtinRow, customRow], total: 2 }))
    renderPage()
    // 内置模板名同时出现于「平台内置模板」区与模板列表
    expect((await screen.findAllByText('飞书卡片-默认')).length).toBeGreaterThan(0)
    expect(screen.getByText('安全告警-钉钉卡片')).toBeInTheDocument()
    // 渠道类型用中文展示名，禁止直接渲染枚举值
    expect(screen.queryByText('feishu')).toBeNull()
    expect(screen.queryByText('dingtalk')).toBeNull()
    expect(screen.getAllByText('飞书').length).toBeGreaterThan(0)
    expect(screen.getAllByText('钉钉').length).toBeGreaterThan(0)
    // 内置 / 自定义标记 + 状态展示名
    expect(screen.getAllByText('内置').length).toBeGreaterThan(0)
    expect(screen.getByText('自定义')).toBeInTheDocument()
    expect(screen.getAllByText('已生效').length).toBe(2)
  })

  it('内置模板不可删除：内置行展示「内置」标记且不提供删除操作', async () => {
    useNotifyTemplatesMock.mockReturnValue(result({ templates: [builtinRow, customRow], total: 2 }))
    renderPage()
    const matches = await screen.findAllByText('飞书卡片-默认')
    const row = matches.map((el) => el.closest('tr')).find(Boolean) as HTMLElement
    expect(within(row).getByText('内置')).toBeInTheDocument()
    // 平台模板为版本留痕、后端未提供删除端点 → 前端不提供任何删除操作
    expect(screen.queryByRole('button', { name: /删除/ })).toBeNull()
  })

  it('权限不足：显示权限不足空态', () => {
    useNotifyTemplatesMock.mockReturnValue(result({ permissionDenied: true }))
    renderPage()
    expect(screen.getByText('当前账号无此页面查看权限')).toBeInTheDocument()
  })

  it('接口错误：Alert + 重新加载触发 reload', () => {
    useNotifyTemplatesMock.mockReturnValue(result({ error: 'boom' }))
    renderPage()
    expect(screen.getByText('通知模板加载失败，请稍后重试')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重新加载/ }))
    expect(reloadMock).toHaveBeenCalled()
  })

  it('提交自定义模板：必填校验拦截，填齐后提交 payload', async () => {
    const user = userEvent.setup()
    useNotifyTemplatesMock.mockReturnValue(result())
    renderPage()
    await user.click(screen.getByRole('button', { name: /提交自定义模板/ }))
    await user.click(screen.getByRole('button', { name: /^提交模板$/ }))
    expect(await screen.findByText('请填写模板名称')).toBeInTheDocument()
    expect(submitMock).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('模板名称'), '安全告警-飞书卡片')
    // 模板内容含 `{{ }}`，userEvent.type 会把花括号当键描述符转义，改用 fireEvent.change 写入原值
    fireEvent.change(screen.getByLabelText('模板内容（Go template）'), {
      target: { value: '{{ define "x" }}{{ end }}' },
    })
    await user.click(screen.getByRole('button', { name: /^提交模板$/ }))
    await waitFor(() =>
      expect(submitMock).toHaveBeenCalledWith({
        name: '安全告警-飞书卡片',
        channel_type: 'feishu',
        content: '{{ define "x" }}{{ end }}',
      }),
    )
  })

  it('提交校验失败：把后端行级错误渲染在编辑框旁，不落库', async () => {
    const user = userEvent.setup()
    const badRequest = new ApiError('校验失败', 400, 'bad_request', {
      status: 'error',
      data: {
        items: [{ file: 'feishu.card', line: 3, message: 'unexpected EOF in template' }],
        note: '校验失败未保存、未生效；修改后请重新提交',
      },
      error: '校验失败',
      errorType: 'bad_request',
    })
    submitMock.mockRejectedValue(badRequest)
    useNotifyTemplatesMock.mockReturnValue(result())
    renderPage()
    await user.click(screen.getByRole('button', { name: /提交自定义模板/ }))
    await user.type(screen.getByLabelText('模板名称'), '坏模板')
    fireEvent.change(screen.getByLabelText('模板内容（Go template）'), { target: { value: '{{ define' } })
    await user.click(screen.getByRole('button', { name: /^提交模板$/ }))
    expect(await screen.findByText('模板校验未通过（未保存、未生效）')).toBeInTheDocument()
    expect(screen.getByText('unexpected EOF in template')).toBeInTheDocument()
    expect(screen.getByText(/feishu\.card:3/)).toBeInTheDocument()
  })

  it('回滚：Modal 二次确认后调用 remount(历史版本 id, 名称)', async () => {
    useNotifyTemplatesMock.mockReturnValue(result({ templates: [customRow], total: 1 }))
    const modal = mockAntdModal()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /重新挂载/ }))
    expect(modal.confirm).toHaveBeenCalled()
    const conf = modal.confirm.mock.calls[0][0]
    expect(conf.title).toContain('安全告警-钉钉卡片')
    await (conf.onOk as () => Promise<void>)()
    await waitFor(() => expect(remountMock).toHaveBeenCalledWith('2', '安全告警-钉钉卡片'))
  })

  it('抽屉关闭后重新打开仍正确回显（forceRender 回归，Step 3.7）', async () => {
    const user = userEvent.setup()
    useNotifyTemplatesMock.mockReturnValue(result({ templates: [builtinRow], total: 1 }))
    renderPage()
    const cloneBtn = await screen.findByRole('button', { name: /复制并自定义/ })
    await user.click(cloneBtn)
    expect((screen.getByLabelText('模板名称') as HTMLInputElement).value).toBe('飞书卡片-默认（副本）')
    expect((screen.getByLabelText('模板内容（Go template）') as HTMLTextAreaElement).value).toBe(
      '{{ define "feishu.card" }}{{ end }}',
    )

    // 关闭后再打开：回显不得丢失
    fireEvent.click(document.querySelector('.ant-drawer-close') as HTMLElement)
    await user.click(screen.getByRole('button', { name: /复制并自定义/ }))
    expect((await screen.findByLabelText('模板名称') as HTMLInputElement).value).toBe('飞书卡片-默认（副本）')
    expect((screen.getByLabelText('模板内容（Go template）') as HTMLTextAreaElement).value).toBe(
      '{{ define "feishu.card" }}{{ end }}',
    )
  })
})

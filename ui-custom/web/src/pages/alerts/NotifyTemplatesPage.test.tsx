/**
 * 通知模板管理页测试（2026-10-22 模板改为可编辑实体）。
 * 覆盖：同一清单展示内置/自定义、内置只读、新建/编辑/复制/删除、
 * 被绑定模板阻止删除、详情查看、权限不足、接口错误。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { App } from 'antd'
import { setupAntdTest, mockAntdModal } from '../../test/antdTestUtils'
import { NotifyTemplatesPage } from './NotifyTemplatesPage'
import type { NotifyTemplate, NotifyTemplateDetail } from '../../types/alertmanager'

const useNotifyTemplatesMock = vi.fn()
vi.mock('./useNotifyTemplates', () => ({
  useNotifyTemplates: (...a: unknown[]) => useNotifyTemplatesMock(...a),
}))

const reloadMock = vi.fn()
const createMock = vi.fn()
const updateMock = vi.fn()
const removeMock = vi.fn()
const getDetailMock = vi.fn()

const builtin: NotifyTemplate = {
  id: '1',
  name: '飞书卡片-默认',
  channel_type: 'feishu',
  is_builtin: true,
  bound_channel_count: 0,
  created_at: '2026-09-28T10:00:00Z',
  updated_at: '2026-10-16T10:00:00Z',
}

const custom: NotifyTemplate = {
  id: '2',
  name: '安全告警-飞书卡片',
  channel_type: 'feishu',
  is_builtin: false,
  bound_channel_count: 0,
  created_at: '2026-10-20T10:00:00Z',
  updated_at: '2026-10-22T10:00:00Z',
}

const customDetail: NotifyTemplateDetail = {
  ...custom,
  content: '{"msg_type":"text","text":{"content":"{{ .Status }}"}}',
}

function result(over: Record<string, unknown> = {}) {
  return {
    templates: [],
    loading: false,
    error: null,
    permissionDenied: false,
    reload: reloadMock,
    create: createMock,
    update: updateMock,
    remove: removeMock,
    getDetail: getDetailMock,
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
    createMock.mockReset()
    updateMock.mockReset()
    removeMock.mockReset()
    getDetailMock.mockReset()
    createMock.mockResolvedValue(customDetail)
    updateMock.mockResolvedValue(customDetail)
    removeMock.mockResolvedValue(undefined)
    getDetailMock.mockResolvedValue(customDetail)
  })

  it('页头渲染与新建入口', () => {
    useNotifyTemplatesMock.mockReturnValue(result())
    renderPage()
    expect(screen.getAllByText('通知模板').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /新建模板/ })).toBeInTheDocument()
  })

  it('内置和自定义同表展示；内置只读、自定义可编辑删除', async () => {
    useNotifyTemplatesMock.mockReturnValue(result({ templates: [builtin, custom] }))
    renderPage()

    expect(await screen.findByText('飞书卡片-默认')).toBeInTheDocument()
    expect(screen.getByText('安全告警-飞书卡片')).toBeInTheDocument()
    // 内置行只有查看/复制；自定义行有编辑/删除。
    const builtinRow = screen.getByText('飞书卡片-默认').closest('tr') as HTMLElement
    const customRow = screen.getByText('安全告警-飞书卡片').closest('tr') as HTMLElement
    expect(builtinRow).not.toBeNull()
    expect(customRow).not.toBeNull()
    expect(screen.getAllByRole('button', { name: /编辑/ })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /删除/ })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /复制/ })).toHaveLength(2)
  })

  it('新建模板：提交 create payload', async () => {
    const user = userEvent.setup()
    useNotifyTemplatesMock.mockReturnValue(result())
    renderPage()
    await user.click(screen.getByRole('button', { name: /新建模板/ }))
    await user.type(screen.getByLabelText('模板名称'), '新模板')
    fireEvent.change(screen.getByLabelText('模板内容（Go template）'), {
      target: { value: '{{ define "x" }}{{ end }}' },
    })
    await user.click(screen.getByRole('button', { name: /创建模板/ }))
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        name: '新模板',
        channel_type: 'feishu',
        content: '{{ define "x" }}{{ end }}',
      }),
    )
  })

  it('编辑模板：预填详情、渠道类型置灰、提交 update', async () => {
    const user = userEvent.setup()
    useNotifyTemplatesMock.mockReturnValue(result({ templates: [custom] }))
    renderPage()
    await user.click(await screen.findByRole('button', { name: /编辑/ }))
    expect(await screen.findByDisplayValue('安全告警-飞书卡片')).toBeInTheDocument()
    // 渠道类型 Select 在编辑态禁用（aria-disabled）。
    const typeSelect = document.querySelector('.ant-select-disabled')
    expect(typeSelect).not.toBeNull()

    fireEvent.change(screen.getByLabelText('模板内容（Go template）'), {
      target: { value: '{{ define "y" }}{{ end }}' },
    })
    await user.click(screen.getByRole('button', { name: /保存修改/ }))
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith('2', {
        name: '安全告警-飞书卡片',
        channel_type: 'feishu',
        content: '{{ define "y" }}{{ end }}',
      }),
    )
  })

  it('复制模板：名称带副本后缀，提交 create', async () => {
    const user = userEvent.setup()
    useNotifyTemplatesMock.mockReturnValue(result({ templates: [custom] }))
    renderPage()
    await user.click(await screen.findByRole('button', { name: /复制/ }))
    expect(await screen.findByDisplayValue('安全告警-飞书卡片（副本）')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /保存为新模板/ }))
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        name: '安全告警-飞书卡片（副本）',
        channel_type: 'feishu',
        content: customDetail.content,
      }),
    )
  })

  it('删除未绑定模板：二次确认后调用 remove', async () => {
    useNotifyTemplatesMock.mockReturnValue(result({ templates: [custom] }))
    const modal = mockAntdModal()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /删除/ }))
    expect(modal.confirm).toHaveBeenCalled()
    await (modal.confirm.mock.calls[0][0].onOk as () => Promise<void>)()
    expect(removeMock).toHaveBeenCalledWith('2')
  })

  it('删除被渠道绑定的模板：只提示去改绑，不调用 remove', async () => {
    const bound = { ...custom, bound_channel_count: 2 }
    useNotifyTemplatesMock.mockReturnValue(result({ templates: [bound] }))
    const modal = mockAntdModal()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /删除/ }))
    expect(modal.warning).toHaveBeenCalled()
    expect(modal.confirm).not.toHaveBeenCalled()
    expect(removeMock).not.toHaveBeenCalled()
  })

  it('查看模板：拉取详情并展示内容', async () => {
    useNotifyTemplatesMock.mockReturnValue(result({ templates: [custom] }))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /查看/ }))
    expect(await screen.findByText(customDetail.content)).toBeInTheDocument()
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
})

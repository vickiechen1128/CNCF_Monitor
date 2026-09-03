import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from 'antd'
import { setupAntdTest, mockAntdModal } from '../../test/antdTestUtils'
import { SilencesPage } from './SilencesPage'
import type { Silence } from '../../types/alertmanager'

const useSilencesMock = vi.fn()
vi.mock('./useSilences', () => ({
  useSilences: (...a: unknown[]) => useSilencesMock(...a),
}))

const reloadMock = vi.fn()
const createMock = vi.fn()
const removeMock = vi.fn()

const silenceRow = (over: Partial<Silence> = {}): Silence => ({
  id: 'sil-1',
  matchers: [{ name: 'severity', value: 'critical', is_equal: true, is_regex: false }],
  starts_at: '2026-08-31T10:00:00Z',
  ends_at: '2026-08-31T12:00:00Z',
  created_by: '张伟（运维）',
  comment: '正在灰度发布，预期产生告警',
  status: 'active',
  ...over,
})

function result(over: Record<string, unknown> = {}) {
  return {
    silences: [],
    total: 0,
    loading: false,
    error: null,
    permissionDenied: false,
    reload: reloadMock,
    create: createMock,
    remove: removeMock,
    ...over,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <App>
        <SilencesPage />
      </App>
    </MemoryRouter>,
  )
}

describe('SilencesPage（静默管理）', () => {
  setupAntdTest()

  beforeEach(() => {
    useSilencesMock.mockReset()
    reloadMock.mockReset()
    createMock.mockReset()
    createMock.mockResolvedValue({ status: 'success', data: null })
    removeMock.mockReset()
    removeMock.mockResolvedValue(undefined)
  })

  it('加载中提示', () => {
    useSilencesMock.mockReturnValue(result({ loading: true }))
    renderPage()
    // MainLayout 侧边栏二级菜单 + 页面 Card 标题均出现「静默管理」
    expect(screen.getAllByText('静默管理').length).toBeGreaterThan(0)
    expect(screen.getByText('主动静默')).toBeInTheDocument()
  })

  it('空态：无静默时仅渲染表头和创建引导文案', () => {
    useSilencesMock.mockReturnValue(result())
    renderPage()
    expect(screen.getByRole('button', { name: /创建静默/ })).toBeInTheDocument()
    // 空结果表体无具体匹配条件行
    expect(screen.queryByText(/severity="critical"/)).toBeNull()
  })

  it('渲染静默匹配条件 / 状态 / 创建人', async () => {
    useSilencesMock.mockReturnValue(result({ silences: [silenceRow()], total: 1 }))
    renderPage()
    expect(await screen.findByText(/severity="critical"/)).toBeInTheDocument()
    expect(screen.getByText('生效中')).toBeInTheDocument()
    expect(screen.getByText('张伟（运维）')).toBeInTheDocument()
  })

  it('权限不足：显示权限不足空态', () => {
    useSilencesMock.mockReturnValue(result({ permissionDenied: true }))
    renderPage()
    expect(screen.getByText('当前账号无此页面查看权限')).toBeInTheDocument()
  })

  it('接口错误：Alert + 重新加载触发 reload', () => {
    const res = result({ error: 'boom' })
    useSilencesMock.mockReturnValue(res)
    renderPage()
    expect(screen.getByText('静默列表加载失败，请稍后重试')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重新加载/ }))
    expect(res.reload).toHaveBeenCalled()
  })

  it('删除静默：Modal 二次确认后调用 remove', async () => {
    useSilencesMock.mockReturnValue(result({ silences: [silenceRow()], total: 1 }))
    const modal = mockAntdModal()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /删除/ }))
    expect(modal.confirm).toHaveBeenCalled()
    const onOk = modal.confirm.mock.calls[0][0].onOk as () => Promise<void>
    await onOk()
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('sil-1'))
  })

  it('状态过滤：默认只显示匹配的过滤结果', async () => {
    useSilencesMock.mockReturnValue(
      result({
        silences: [
          silenceRow(),
          silenceRow({ id: 'sil-2', matchers: [{ name: 'severity', value: 'warning', is_equal: true, is_regex: false }], status: 'expired' }),
        ],
        total: 2,
      }),
    )
    renderPage()
    expect(await screen.findByText(/severity="critical"/)).toBeInTheDocument()
    expect(screen.getByText(/severity="warning"/)).toBeInTheDocument()
  })
})
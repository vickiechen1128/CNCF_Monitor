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
  // active 行默认「已生效 1 小时 / 23 小时后失效」，驱动剩余时长副行（方案 B）
  starts_at: new Date(Date.now() - 3_600_000).toISOString(),
  ends_at: new Date(Date.now() + 23 * 3_600_000).toISOString(),
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
    // 页头一句话说明保留；列表卡内的「主动静默 / 即时生效」横条与折叠栏大框已移除（用户反馈 2026-09-11）
    expect(screen.getAllByText(/屏蔽特定告警的通知/).length).toBeGreaterThan(0)
    expect(screen.queryByText('主动静默')).toBeNull()
    // 注：「静默只对你有权限的网域生效」仍存在于创建抽屉内（forceRender 随页挂载），属预期
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

  it('结束静默（方案 A）：生效中行操作为「结束静默」，确认后调用 remove 并提示恢复通知', async () => {
    useSilencesMock.mockReturnValue(result({ silences: [silenceRow()], total: 1 }))
    const modal = mockAntdModal()
    renderPage()
    // 生效中 → 按钮是「结束静默」而非「删除」
    fireEvent.click(await screen.findByRole('button', { name: /结束静默/ }))
    expect(modal.confirm).toHaveBeenCalled()
    const conf = modal.confirm.mock.calls[0][0]
    // 确认文案传达「结束 = 恢复通知」而非「清理记录」
    expect(conf.title).toContain('结束这条静默')
    expect(conf.content).toContain('相关告警恢复通知')
    expect(conf.okText).toBe('结束静默')
    const onOk = conf.onOk as () => Promise<void>
    await onOk()
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('sil-1'))
  })

  it('操作按钮按状态区分（方案 A）：生效中=结束静默 / 待生效=取消静默 / 已过期=删除', async () => {
    useSilencesMock.mockReturnValue(
      result({
        silences: [
          silenceRow(),
          silenceRow({
            id: 'sil-pending',
            matchers: [{ name: 'severity', value: 'warn', is_equal: true, is_regex: false }],
            starts_at: new Date(Date.now() + 3_600_000).toISOString(),
            status: 'pending',
          }),
          silenceRow({
            id: 'sil-expired',
            matchers: [{ name: 'severity', value: 'info', is_equal: true, is_regex: false }],
            starts_at: new Date(Date.now() - 48 * 3_600_000).toISOString(),
            ends_at: new Date(Date.now() - 24 * 3_600_000).toISOString(),
            status: 'expired',
          }),
        ],
        total: 3,
      }),
    )
    renderPage()
    expect(await screen.findByRole('button', { name: /结束静默/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /取消静默/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /删除/ })).toBeInTheDocument()
  })

  it('剩余时长副行（方案 B）：生效中显示「剩余 X」，待生效显示「X 后生效」，已过期显示「已结束」', async () => {
    useSilencesMock.mockReturnValue(
      result({
        silences: [
          silenceRow(),
          silenceRow({
            id: 'sil-pending',
            matchers: [{ name: 'severity', value: 'warn', is_equal: true, is_regex: false }],
            starts_at: new Date(Date.now() + 2 * 3_600_000).toISOString(),
            status: 'pending',
          }),
          silenceRow({
            id: 'sil-expired',
            matchers: [{ name: 'severity', value: 'info', is_equal: true, is_regex: false }],
            starts_at: new Date(Date.now() - 48 * 3_600_000).toISOString(),
            ends_at: new Date(Date.now() - 24 * 3_600_000).toISOString(),
            status: 'expired',
          }),
        ],
        total: 3,
      }),
    )
    renderPage()
    // 注意：毫秒级流逝会让 floor 降档（23h→22h、2h→1h），断言用宽松区间
    expect(await screen.findByText(/剩余 2[0-3] 小时/)).toBeInTheDocument()
    expect(screen.getByText(/\d+ 小时 后生效/)).toBeInTheDocument()
    expect(screen.getByText('已结束')).toBeInTheDocument()
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
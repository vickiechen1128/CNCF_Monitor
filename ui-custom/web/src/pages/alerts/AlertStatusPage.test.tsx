/**
 * 告警状态页测试（Module_08 v1.12 MVP 增量，T08-F6，契约快照 §10）。
 * 双视图：Tab 1「Alertmanager 通知状态」（四态）+ Tab 2「Prometheus 当前触发告警」（firing/pending）。
 * 通过 mock ./useAlertStatus 隔离真实 API；覆盖状态矩阵：加载 / 空态 / 接口错误 / 权限不足。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setupAntdTest } from '../../test/antdTestUtils'
import { AlertStatusPage } from './AlertStatusPage'
import type { AmAlertItem, PromAlertItem } from '../../types/alertmanager'

const useAmAlertsMock = vi.fn()
const usePromAlertsMock = vi.fn()
const useNetworkDomainsMock = vi.fn()

vi.mock('./useAlertStatus', () => ({
  useAmAlerts: (...a: unknown[]) => useAmAlertsMock(...a),
  usePromAlerts: (...a: unknown[]) => usePromAlertsMock(...a),
  useNetworkDomains: () => useNetworkDomainsMock(),
}))

const amReloadMock = vi.fn()
const promReloadMock = vi.fn()

const amRow = (over: Partial<AmAlertItem> = {}): AmAlertItem => ({
  labels: { alertname: 'HighCPU', severity: 'critical', network_domain: 'default', instance: '10.0.0.1:9100' },
  annotations: { summary: 'CPU 使用率超过阈值' },
  starts_at: '2026-09-08T01:00:00Z',
  ends_at: '0001-01-01T00:00:00Z',
  status: { state: 'active', silenced_by: [], inhibited_by: [] },
  notify_status: 'active',
  ...over,
})

const promRow = (over: Partial<PromAlertItem> = {}): PromAlertItem => ({
  labels: { alertname: 'HighCPU', severity: 'critical', network_domain: 'default', instance: '10.0.0.1:9100' },
  annotations: { summary: 'CPU 使用率超过阈值' },
  state: 'firing',
  activeAt: '2026-09-08T01:00:00Z',
  value: '0.98',
  ...over,
})

function amState(over: Record<string, unknown> = {}) {
  return { items: [] as AmAlertItem[], loading: false, error: null, permissionDenied: false, reload: amReloadMock, ...over }
}

function promState(over: Record<string, unknown> = {}) {
  return { items: [] as PromAlertItem[], loading: false, error: null, permissionDenied: false, reload: promReloadMock, ...over }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AlertStatusPage />
    </MemoryRouter>,
  )
}

describe('AlertStatusPage（告警状态双视图）', () => {
  setupAntdTest()

  beforeEach(() => {
    useAmAlertsMock.mockReset()
    usePromAlertsMock.mockReset()
    useNetworkDomainsMock.mockReset()
    amReloadMock.mockReset()
    promReloadMock.mockReset()
    useAmAlertsMock.mockReturnValue(amState())
    usePromAlertsMock.mockReturnValue(promState())
    useNetworkDomainsMock.mockReturnValue([])
  })

  it('默认展示 Alertmanager 通知状态视图：四态统计卡片 + 决策 56 授权过滤提示', async () => {
    useAmAlertsMock.mockReturnValue(amState({ items: [amRow()] }))
    renderPage()
    // 页面标题与四态统计卡片（原型 AlertStatusPage 对齐，文案以契约 §10.2 展示名为准）
    expect(await screen.findAllByText('告警状态')).not.toHaveLength(0)
    expect(screen.getAllByText('通知中').length).toBeGreaterThan(0)
    expect(screen.getAllByText('已静默').length).toBeGreaterThan(0)
    expect(screen.getAllByText('已抑制').length).toBeGreaterThan(0)
    expect(screen.getAllByText('待处理').length).toBeGreaterThan(0)
    // 决策 56 授权过滤提示保留（MVP 恒通过）
    expect(screen.getByText(/通知状态已按授权网域集合过滤/)).toBeInTheDocument()
  })

  it('双 Tab 就位且语义区分说明条明确两视图差异（PRD §3.2）', async () => {
    renderPage()
    expect(await screen.findByRole('tab', { name: /Alertmanager 通知状态/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Prometheus 当前触发告警/ })).toBeInTheDocument()
    // 语义区分：Prometheus 视图=规则求值触发（firing/pending）；AM 视图=路由/静默/抑制后的通知结果
    expect(screen.getByText(/规则求值结果/)).toBeInTheDocument()
    expect(screen.getByText(/路由、静默、抑制后的通知处理结果/)).toBeInTheDocument()
  })

  it('AM 视图渲染行字段：告警名称 / 通知状态 / 网域 / 实例 / 摘要', async () => {
    useAmAlertsMock.mockReturnValue(amState({ items: [amRow({ notify_status: 'silenced' })] }))
    renderPage()
    expect(await screen.findByText('HighCPU')).toBeInTheDocument()
    expect(screen.getAllByText('已静默').length).toBeGreaterThan(0)
    expect(screen.getByText('default')).toBeInTheDocument()
    expect(screen.getByText('10.0.0.1:9100')).toBeInTheDocument()
    expect(screen.getByText('CPU 使用率超过阈值')).toBeInTheDocument()
    // 裁剪核对：无「接收人」列（AM v2 响应无 receiver 归属字段）
    expect(screen.queryByText('接收人')).toBeNull()
  })

  it('AM 视图状态筛选（客户端过滤）：选择「已静默」只保留静默行', async () => {
    useAmAlertsMock.mockReturnValue(
      amState({
        items: [
          amRow({ labels: { alertname: 'ActiveAlert', network_domain: 'default', instance: '10.0.0.1:9100' }, notify_status: 'active' }),
          amRow({ labels: { alertname: 'SilencedAlert', network_domain: 'default', instance: '10.0.0.2:9100' }, notify_status: 'silenced', status: { state: 'suppressed', silenced_by: ['sil-1'], inhibited_by: [] } }),
        ],
      }),
    )
    renderPage()
    expect(await screen.findByText('ActiveAlert')).toBeInTheDocument()
    // AM Tab 筛选区第一个下拉 = 通知状态
    const combos = screen.getAllByRole('combobox')
    fireEvent.mouseDown(combos[0])
    // 「已静默」同时出现在统计卡片标题与下拉项中，点击下拉项（最后一个匹配）
    const options = await screen.findAllByText('已静默')
    fireEvent.click(options[options.length - 1])
    await waitFor(() => expect(screen.queryByText('ActiveAlert')).toBeNull())
    expect(screen.getByText('SilencedAlert')).toBeInTheDocument()
  })

  it('切换到 Prometheus 当前触发告警视图：firing=触发中 / pending=待处理 + 当前值', async () => {
    usePromAlertsMock.mockReturnValue(
      promState({
        items: [
          promRow(),
          promRow({ labels: { alertname: 'PendingAlert', network_domain: 'default', instance: '10.0.0.3:9100' }, state: 'pending', value: '-' }),
        ],
      }),
    )
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: /Prometheus 当前触发告警/ }))
    expect(await screen.findByText('HighCPU')).toBeInTheDocument()
    expect(screen.getByText('触发中')).toBeInTheDocument()
    // 「待处理」在 AM 面板统计卡片中同样出现（隐藏但保持挂载），按行内 Tag 断言
    const pendingRow = screen.getByText('PendingAlert').closest('tr')
    expect(pendingRow).not.toBeNull()
    expect(within(pendingRow as HTMLElement).getByText('待处理')).toBeInTheDocument()
    expect(screen.getByText('0.98')).toBeInTheDocument()
  })

  it('加载中：表格展示加载态', async () => {
    useAmAlertsMock.mockReturnValue(amState({ loading: true }))
    const { container } = renderPage()
    expect(await screen.findByRole('tab', { name: /Alertmanager 通知状态/ })).toBeInTheDocument()
    await waitFor(() => expect(container.querySelector('.ant-spin-spinning')).not.toBeNull())
  })

  it('空态：无告警时展示空数据提示', async () => {
    renderPage()
    // antd Empty 内部 SVG <title> 与描述节点同名，断言至少一处出现
    expect((await screen.findAllByText('暂无数据')).length).toBeGreaterThan(0)
  })

  it('接口错误：错误 Alert + 重新加载触发 reload', async () => {
    useAmAlertsMock.mockReturnValue(amState({ error: 'Alertmanager 不可达' }))
    renderPage()
    expect(await screen.findByText('告警列表加载失败，请稍后重试')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重新加载/ }))
    expect(amReloadMock).toHaveBeenCalled()
  })

  it('权限不足：整页展示无权限空态', async () => {
    useAmAlertsMock.mockReturnValue(amState({ permissionDenied: true }))
    renderPage()
    expect(await screen.findByText('当前账号无此页面查看权限')).toBeInTheDocument()
  })

  it('网域筛选：选择网域后两视图 Hook 均透传 network_domain（后端过滤）', async () => {
    useNetworkDomainsMock.mockReturnValue([{ id: 'gov-01', name: '政务网' }])
    renderPage()
    // 初次加载不带网域参数
    await waitFor(() => expect(useAmAlertsMock).toHaveBeenCalledWith(undefined))
    const combos = screen.getAllByRole('combobox')
    // AM Tab 筛选区第二个下拉 = 网域
    fireEvent.mouseDown(combos[1])
    fireEvent.click(await screen.findByText('政务网'))
    await waitFor(() => expect(useAmAlertsMock).toHaveBeenLastCalledWith('gov-01'))
    expect(usePromAlertsMock).toHaveBeenLastCalledWith('gov-01')
  })
})

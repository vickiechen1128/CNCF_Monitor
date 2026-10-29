/**
 * 告警状态页测试（Module_08，2026-10-29 event 表单一事实源）。
 * 双视图：Tab 1「当前告警」（event 表未结三态）+ Tab 2「规则评估」（firing/pending）。
 * 通过 mock ./useAlertStatus 隔离真实 API；覆盖状态矩阵：加载 / 空态 / 接口错误 / 权限不足。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setupAntdTest } from '../../test/antdTestUtils'
import { AlertStatusPage } from './AlertStatusPage'
import type { AlertEventItem, PromAlertItem } from '../../types/alertmanager'

const useCurrentAlertsMock = vi.fn()
const useOpenAlertStatsMock = vi.fn()
const usePromAlertsMock = vi.fn()
const useNetworkDomainsMock = vi.fn()

vi.mock('./useAlertStatus', () => ({
  CURRENT_ALERTS_PAGE_SIZE: 20,
  useCurrentAlerts: (...a: unknown[]) => useCurrentAlertsMock(...a),
  useOpenAlertStats: (...a: unknown[]) => useOpenAlertStatsMock(...a),
  usePromAlerts: (...a: unknown[]) => usePromAlertsMock(...a),
  useNetworkDomains: () => useNetworkDomainsMock(),
}))

const currentReloadMock = vi.fn()
const currentSetPageMock = vi.fn()
const currentSetPageSizeMock = vi.fn()
const statsReloadMock = vi.fn()
const promReloadMock = vi.fn()

const eventRow = (over: Partial<AlertEventItem> = {}): AlertEventItem => ({
  id: 1,
  alert_name: 'HighCPU',
  status: 'firing',
  severity: 'critical',
  summary: 'CPU 使用率超过阈值',
  network_domain: 'default',
  starts_at: '2026-09-08T01:00:00Z',
  updated_at: '2026-09-08T01:00:00Z',
  instance_address: '10.0.0.1:9100',
  labels: { network_domain_name: '默认域' },
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

function currentState(over: Record<string, unknown> = {}) {
  return {
    items: [] as AlertEventItem[],
    total: 0,
    page: 1,
    pageSize: 20,
    loading: false,
    error: null,
    permissionDenied: false,
    reload: currentReloadMock,
    setPage: currentSetPageMock,
    setPageSize: currentSetPageSizeMock,
    ...over,
  }
}

function statsState(over: Record<string, unknown> = {}) {
  return {
    stats: { total: 0, firing: 0, silenced: 0, inhibited: 0 },
    loading: false,
    error: null,
    reload: statsReloadMock,
    ...over,
  }
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

/** 悬停引导语并展开折叠栏 */
async function openGuide() {
  fireEvent.click(screen.getByText(/「当前告警」和「规则评估」有什么区别/))
  return screen.findByText(/现在有哪些问题/)
}

describe('AlertStatusPage（当前告警 / 规则评估）', () => {
  setupAntdTest()

  beforeEach(() => {
    useCurrentAlertsMock.mockReset()
    useOpenAlertStatsMock.mockReset()
    usePromAlertsMock.mockReset()
    useNetworkDomainsMock.mockReset()
    currentReloadMock.mockReset()
    currentSetPageMock.mockReset()
    currentSetPageSizeMock.mockReset()
    statsReloadMock.mockReset()
    promReloadMock.mockReset()
    useCurrentAlertsMock.mockReturnValue(currentState())
    useOpenAlertStatsMock.mockReturnValue(statsState())
    usePromAlertsMock.mockReturnValue(promState())
    useNetworkDomainsMock.mockReturnValue([])
  })

  it('默认展示当前告警视图：未结三态统计卡 + 语义折叠栏（默认收起），无独立标题卡片', async () => {
    useOpenAlertStatsMock.mockReturnValue(
      statsState({ stats: { total: 3, firing: 1, silenced: 1, inhibited: 1 } }),
    )
    const { container } = renderPage()
    // 三张统计卡：告警中 / 静默中 / 抑制中；「待处理」已下线
    expect(await screen.findAllByText('告警中')).not.toHaveLength(0)
    expect(screen.getAllByText('静默中').length).toBeGreaterThan(0)
    expect(screen.getAllByText('抑制中').length).toBeGreaterThan(0)
    expect(screen.queryByText('待处理')).toBeNull()
    expect(screen.queryByText('通知中')).toBeNull()
    // 页头独立标题卡片移除（用户反馈 2026-09-11）
    expect(container.querySelector('h4.ant-typography')).toBeNull()
    // 折叠栏默认收起：仅可见标题，说明内容不在 DOM；点击展开后可见
    expect(screen.getByText(/「当前告警」和「规则评估」有什么区别/)).toBeInTheDocument()
    expect(screen.queryByText(/现在有哪些问题/)).toBeNull()
    expect(await openGuide()).toBeInTheDocument()
    expect(screen.queryByText(/两个页签分别看什么/)).toBeNull()
  })

  it('双 Tab 就位：当前告警 / 规则评估', async () => {
    renderPage()
    expect(await screen.findByRole('tab', { name: '当前告警' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '规则评估' })).toBeInTheDocument()
    await openGuide()
    expect(await screen.findByText(/规则算出来什么/)).toBeInTheDocument()
  })

  it('当前告警渲染行字段：告警名称 / 状态 / 网域 / 实例名 / 采集地址 / 开始时间 / 摘要', async () => {
    useCurrentAlertsMock.mockReturnValue(
      currentState({ items: [eventRow({ status: 'silenced' })], total: 1 }),
    )
    renderPage()
    expect(await screen.findByText('HighCPU')).toBeInTheDocument()
    expect(screen.getAllByText('静默中').length).toBeGreaterThan(0)
    expect(screen.getByText('默认域')).toBeInTheDocument()
    expect(screen.getByText('10.0.0.1:9100')).toBeInTheDocument()
    expect(screen.getByText('CPU 使用率超过阈值')).toBeInTheDocument()
    // 裁剪核对：无「接收人」列
    expect(screen.queryByText('接收人')).toBeNull()
  })

  it('网域列优先展示 network_domain_name；无展示标签时按 ID 映射 M06 名称', async () => {
    useNetworkDomainsMock.mockReturnValue([{ id: 'default', name: '默认域' }])
    useCurrentAlertsMock.mockReturnValue(
      currentState({
        items: [
          eventRow({ id: 1, alert_name: 'WithName', network_domain: 'gov-cloud-a', labels: { network_domain_name: '政务网A区' } }),
          eventRow({ id: 2, alert_name: 'Legacy', network_domain: 'default', labels: {} }),
        ],
        total: 2,
      }),
    )
    renderPage()

    const withNameRow = (await screen.findByText('WithName')).closest('tr')
    expect(withNameRow).not.toBeNull()
    expect(within(withNameRow as HTMLElement).getByText('政务网A区')).toBeInTheDocument()

    const legacyRow = screen.getByText('Legacy').closest('tr')
    expect(legacyRow).not.toBeNull()
    expect(within(legacyRow as HTMLElement).getByText('默认域')).toBeInTheDocument()
  })

  it('决策 70：「实例名」由 resource_name 回填，「采集地址」展示 instance_address', async () => {
    useCurrentAlertsMock.mockReturnValue(
      currentState({
        items: [eventRow({ resource_name: 'prod-db-01', instance_address: '10.0.0.1:9100' })],
        total: 1,
      }),
    )
    renderPage()
    const row = (await screen.findByText('HighCPU')).closest('tr')
    expect(row).not.toBeNull()
    const cells = within(row as HTMLElement).getAllByRole('cell')
    // 列序：告警名称 / 状态 / 网域 / 实例名 / 采集地址 / 开始时间 / 摘要
    expect(cells[3]).toHaveTextContent('prod-db-01')
    expect(cells[4]).toHaveTextContent('10.0.0.1:9100')
  })

  it('决策 70：无 resource_id（拨测 / 聚合 / 自写规则）时实例名显示 -，不回落为地址', async () => {
    useCurrentAlertsMock.mockReturnValue(
      currentState({ items: [eventRow({ instance_address: '10.0.0.1:9100' })], total: 1 }),
    )
    renderPage()
    const row = (await screen.findByText('HighCPU')).closest('tr')
    expect(row).not.toBeNull()
    const cells = within(row as HTMLElement).getAllByRole('cell')
    expect(cells[3]).toHaveTextContent('-')
    expect(cells[4]).toHaveTextContent('10.0.0.1:9100')
  })

  it('决策 70：「采集地址」列头挂提示角标，消解 :9100 被误读为业务端口', async () => {
    renderPage()
    const header = await screen.findByRole('columnheader', { name: /采集地址/ })
    const badge = header.querySelector('.anticon-info-circle')
    expect(badge).toBeTruthy()
    fireEvent.mouseEnter(badge!)
    expect(await screen.findByText(/采集器地址，非业务端口/)).toBeInTheDocument()
  })

  it('状态筛选走服务端：选择「静默中」后 Hook 收到 status=silenced 并回到第 1 页', async () => {
    useCurrentAlertsMock.mockReturnValue(
      currentState({
        items: [eventRow({ id: 1, alert_name: 'ActiveAlert' }), eventRow({ id: 2, alert_name: 'SilencedAlert', status: 'silenced' })],
        total: 2,
      }),
    )
    renderPage()
    expect(await screen.findByText('ActiveAlert')).toBeInTheDocument()

    // 当前告警 Tab 第一个下拉 = 状态（第二个为网域）
    const combos = screen.getAllByRole('combobox')
    fireEvent.mouseDown(combos[0])
    const options = await screen.findAllByText('静默中')
    fireEvent.click(options[options.length - 1])

    await waitFor(() => {
      const calls = useCurrentAlertsMock.mock.calls
      const last = calls[calls.length - 1]?.[0] as { status: string } | undefined
      expect(last?.status).toBe('silenced')
    })
    expect(currentSetPageMock).toHaveBeenCalledWith(1)
  })

  it('切换到规则评估视图：firing=触发中 / pending=观察中 + 当前值', async () => {
    usePromAlertsMock.mockReturnValue(
      promState({
        items: [
          promRow(),
          promRow({ labels: { alertname: 'PendingAlert', network_domain: 'default', instance: '10.0.0.3:9100' }, state: 'pending', value: '-' }),
        ],
      }),
    )
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: /规则评估/ }))
    expect(await screen.findByText('HighCPU')).toBeInTheDocument()
    expect(screen.getByText('触发中')).toBeInTheDocument()
    const pendingRow = screen.getByText('PendingAlert').closest('tr')
    expect(pendingRow).not.toBeNull()
    expect(within(pendingRow as HTMLElement).getByText('观察中')).toBeInTheDocument()
    expect(screen.getByText('0.98')).toBeInTheDocument()
  })

  it('Prometheus 聚合告警实例回退 + 当前值科学计数法可读化', async () => {
    usePromAlertsMock.mockReturnValue(
      promState({
        items: [
          promRow({
            labels: { alertname: 'HostTargetsMissing', network_domain: 'default', severity: 'critical' },
            annotations: { summary: '主机监控目标全部丢失' },
            value: '1e+00',
          }),
        ],
      }),
    )
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: /规则评估/ }))
    expect(await screen.findByText('HostTargetsMissing')).toBeInTheDocument()
    // 聚合告警无 instance/instance_ip/service_name/nodename/device 标签，回退展示「全局/聚合」
    expect(screen.getByText('全局/聚合')).toBeInTheDocument()
    const alertRow = screen.getByText('HostTargetsMissing').closest('tr')
    expect(alertRow).not.toBeNull()
    expect(within(alertRow as HTMLElement).getByText('1')).toBeInTheDocument()
  })

  it('加载中：表格展示加载态', async () => {
    useCurrentAlertsMock.mockReturnValue(currentState({ loading: true }))
    const { container } = renderPage()
    expect(await screen.findByRole('tab', { name: /当前告警/ })).toBeInTheDocument()
    await waitFor(() => expect(container.querySelector('.ant-spin-spinning')).not.toBeNull())
  })

  it('空态：无当前告警时展示空数据提示', async () => {
    renderPage()
    expect(await screen.findByText('当前无告警')).toBeInTheDocument()
  })

  it('接口错误：错误 Alert + 重新加载触发 reload', async () => {
    useCurrentAlertsMock.mockReturnValue(currentState({ error: '当前告警不可达' }))
    renderPage()
    expect(await screen.findByText('告警列表加载失败，请稍后重试')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重新加载/ }))
    expect(currentReloadMock).toHaveBeenCalled()
  })

  it('统计失败：三张卡显示 - 并给出局部警告，不阻塞列表', async () => {
    useCurrentAlertsMock.mockReturnValue(
      currentState({ items: [eventRow()], total: 1 }),
    )
    useOpenAlertStatsMock.mockReturnValue(statsState({ stats: null, error: 'stats down' }))
    renderPage()
    expect(await screen.findByText('未结计数加载失败，卡片显示 -')).toBeInTheDocument()
    expect(screen.getByText('HighCPU')).toBeInTheDocument()
    expect(screen.getAllByText('-').length).toBeGreaterThan(0)
  })

  it('手动刷新：当前告警同时刷新列表与统计；规则评估刷新自身', async () => {
    renderPage()
    const currentRefresh = await screen.findByRole('button', { name: /刷新/ })
    fireEvent.click(currentRefresh)
    expect(currentReloadMock).toHaveBeenCalledTimes(1)
    expect(statsReloadMock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('tab', { name: /规则评估/ }))
    const promRefresh = await screen.findByRole('button', { name: /刷新/ })
    fireEvent.click(promRefresh)
    expect(promReloadMock).toHaveBeenCalledTimes(1)
  })

  it('权限不足：当前告警 403 展示无权限空态', async () => {
    useCurrentAlertsMock.mockReturnValue(currentState({ permissionDenied: true }))
    renderPage()
    expect(await screen.findByText('当前账号无此页面查看权限')).toBeInTheDocument()
  })

  it('权限不足：规则评估 403 整页空态', async () => {
    usePromAlertsMock.mockReturnValue(promState({ permissionDenied: true }))
    renderPage()
    expect(await screen.findByText('当前账号无此页面查看权限')).toBeInTheDocument()
  })

  it('网域筛选：选择网域后当前告警 / 统计 / 规则评估均透传 network_domain', async () => {
    useNetworkDomainsMock.mockReturnValue([{ id: 'gov-01', name: '政务网' }])
    renderPage()
    // 初次加载：当前告警使用 'all'（服务端省略参数），统计与 Prom 使用 undefined
    await waitFor(() => expect(useOpenAlertStatsMock).toHaveBeenCalledWith(undefined))
    const combos = screen.getAllByRole('combobox')
    // 当前告警 Tab 第二个下拉 = 网域
    fireEvent.mouseDown(combos[1])
    fireEvent.click(await screen.findByText('政务网'))

    await waitFor(() => expect(useOpenAlertStatsMock).toHaveBeenLastCalledWith('gov-01'))
    expect(usePromAlertsMock).toHaveBeenLastCalledWith('gov-01')
    const calls = useCurrentAlertsMock.mock.calls
    const last = calls[calls.length - 1]?.[0] as { networkDomain?: string } | undefined
    expect(last?.networkDomain).toBe('gov-01')
  })

  // PL-1（D-1 方案丙）：规则评估为空最常见的成因是「还没有告警规则」，故补跨模块引导。
  it('PL-1：规则评估为空时展示「去写规则」引导，点击落点为 /rules', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: /规则评估/ }))
    const link = await screen.findByRole('link', { name: '去写规则 →' })
    expect(link).toHaveAttribute('href', '/rules')
    expect(screen.getByText(/还没有告警规则？/)).toBeInTheDocument()
  })

  it('PL-1：规则评估接口错误时不展示「去写规则」引导（不把失败伪装成无数据）', async () => {
    usePromAlertsMock.mockReturnValue(promState({ error: 'Prometheus 不可达' }))
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: /规则评估/ }))
    expect(await screen.findByText('告警列表加载失败，请稍后重试')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '去写规则 →' })).toBeNull()
  })

  it('PL-1：筛选后无匹配时不展示「去写规则」引导（并非没有规则）', async () => {
    usePromAlertsMock.mockReturnValue(promState({ items: [promRow({ state: 'pending' })] }))
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: /规则评估/ }))
    await screen.findByText('HighCPU')
    // 仅操作「规则评估」面板内的状态筛选（当前告警面板常驻挂载，需按面板定位下拉）
    const promPane = document.querySelectorAll('.ant-tabs-tabpane')[1] as HTMLElement
    fireEvent.mouseDown(within(promPane).getAllByRole('combobox')[0])
    fireEvent.click(await screen.findByText('触发中'))
    await waitFor(() => expect(screen.getByText('无匹配告警')).toBeInTheDocument())
    expect(screen.queryByRole('link', { name: '去写规则 →' })).toBeNull()
  })
})

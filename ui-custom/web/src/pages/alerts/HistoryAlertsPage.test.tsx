import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HistoryAlertsPage } from './HistoryAlertsPage'
import type { AlertHistoryItem } from '../../types/alertmanager'

const alertStatusApiMock = {
  getPromAlerts: vi.fn(),
  getAlertmanagerAlerts: vi.fn(),
  getAlertHistory: vi.fn(),
}
const networkDomainApiMock = {
  list: vi.fn(),
}

vi.mock('../../api/alertmanager', () => ({
  alertStatusApi: {
    getPromAlerts: (...a: unknown[]) => alertStatusApiMock.getPromAlerts(...a),
    getAlertmanagerAlerts: (...a: unknown[]) => alertStatusApiMock.getAlertmanagerAlerts(...a),
    getAlertHistory: (...a: unknown[]) => alertStatusApiMock.getAlertHistory(...a),
  },
}))
vi.mock('../../api/domain', () => ({
  networkDomainApi: {
    list: (...a: unknown[]) => networkDomainApiMock.list(...a),
  },
}))
vi.mock('antd/locale/zh_CN', () => ({ default: {} }))

const historyItem = (over: Partial<AlertHistoryItem> = {}): AlertHistoryItem => ({
  alertname: 'HighCPU',
  instance: '10.0.0.1:9100',
  network_domain: 'default',
  state: 'resolved',
  fired_at: '2026-09-08T01:00:00Z',
  resolved_at: '2026-09-08T02:00:00Z',
  duration_seconds: 3600,
  summary: 'CPU 使用率过高',
  value: '1',
  ...over,
})

function renderPage() {
  return render(
    <MemoryRouter>
      <HistoryAlertsPage />
    </MemoryRouter>,
  )
}

describe('HistoryAlertsPage（历史告警）', () => {
  beforeEach(() => {
    alertStatusApiMock.getAlertHistory.mockReset()
    alertStatusApiMock.getPromAlerts.mockReset()
    alertStatusApiMock.getAlertmanagerAlerts.mockReset()
    networkDomainApiMock.list.mockReset()
    networkDomainApiMock.list.mockResolvedValue({ data: { list: [{ id: 'default', name: '默认域' }] } })
  })

  it('渲染语义折叠栏（默认收起）与「恢复时间（估算）」列头角标，无独立标题卡片', async () => {
    alertStatusApiMock.getAlertHistory.mockResolvedValue({
      status: 'success',
      data: { list: [], total: 0, page: 1, page_size: 50 },
    })
    const { container } = renderPage()
    // 页头独立标题卡片已移除（用户反馈 2026-09-11）；页面以折叠栏 + 列表为主体
    expect(await screen.findByText(/恢复时间是估算值，仅供参考/)).toBeInTheDocument()
    expect(container.querySelector('h4.ant-typography')).toBeNull()
    // 折叠栏指引（默认收起）：仅可见标题，说明内容不在 DOM；点击展开后可见完整说明
    expect(screen.queryByText(/可能与实际恢复时间略有偏差/)).toBeNull()
    fireEvent.click(screen.getByText(/恢复时间是估算值，仅供参考/))
    expect(await screen.findByText(/可能与实际恢复时间略有偏差/)).toBeInTheDocument()
    // 列头友好化：不再出现「按 Prometheus 求值」技术术语
    expect(screen.getAllByText(/恢复时间（估算）/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/按 Prometheus 求值/)).toBeNull()
  })

  it('渲染历史告警列表：告警名、采集地址、状态、触发/恢复时间、持续时长、摘要', async () => {
    alertStatusApiMock.getAlertHistory.mockResolvedValue({
      status: 'success',
      data: { list: [historyItem()], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    expect(await screen.findByText('HighCPU')).toBeInTheDocument()
    expect(screen.getByText('10.0.0.1:9100')).toBeInTheDocument()
    expect(screen.getByText('已恢复')).toBeInTheDocument()
    expect(screen.getByText('CPU 使用率过高')).toBeInTheDocument()
  })

  it('聚合告警（无实例）展示「全局/聚合」', async () => {
    alertStatusApiMock.getAlertHistory.mockResolvedValue({
      status: 'success',
      data: {
        list: [historyItem({ alertname: 'HostTargetsMissing', instance: '', instance_display: '', summary: '目标全部丢失' })],
        total: 1,
        page: 1,
        page_size: 50,
      },
    })
    renderPage()
    expect(await screen.findByText('HostTargetsMissing')).toBeInTheDocument()
    expect(screen.getByText('全局/聚合')).toBeInTheDocument()
  })

  it('决策 70：实例名 / 采集地址拆两列 —— resource_name 回填，无资源时实例名为 -', async () => {
    alertStatusApiMock.getAlertHistory.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          historyItem({ resource_name: 'prod-db-01', instance_address: '10.0.0.1:9100' }),
          historyItem({
            alertname: 'HostTargetsMissing',
            instance: '',
            instance_address: '',
            instance_display: '',
            resource_name: '',
          }),
        ],
        total: 2,
        page: 1,
        page_size: 50,
      },
    })
    renderPage()
    const row = (await screen.findByText('prod-db-01')).closest('tr')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('10.0.0.1:9100')).toBeInTheDocument()

    // 无 resource_id 的告警：实例名列 '-'（不回落成地址），采集地址列回退「全局/聚合」
    const aggRow = screen.getByText('HostTargetsMissing').closest('tr')
    expect(aggRow).not.toBeNull()
    expect(within(aggRow as HTMLElement).getByText('-')).toBeInTheDocument()
    expect(within(aggRow as HTMLElement).getByText('全局/聚合')).toBeInTheDocument()
  })

  it('决策 70：实例筛选框提示同时支持实例名与采集地址', async () => {
    alertStatusApiMock.getAlertHistory.mockResolvedValue({
      status: 'success',
      data: { list: [], total: 0, page: 1, page_size: 50 },
    })
    renderPage()
    expect(await screen.findByPlaceholderText('按实例名或采集地址筛选')).toBeInTheDocument()
  })

  it('决策 70：「采集地址」列头挂提示角标，消解 :9100 被误读为业务端口', async () => {
    alertStatusApiMock.getAlertHistory.mockResolvedValue({
      status: 'success',
      data: { list: [], total: 0, page: 1, page_size: 50 },
    })
    renderPage()
    const header = await screen.findByRole('columnheader', { name: /采集地址/ })
    const badge = header.querySelector('.anticon-info-circle')
    expect(badge).toBeTruthy()
    fireEvent.mouseEnter(badge!)
    expect(await screen.findByText(/采集器地址，非业务端口/)).toBeInTheDocument()
  })

  it('空结果展示「暂无历史告警」', async () => {
    alertStatusApiMock.getAlertHistory.mockResolvedValue({
      status: 'success',
      data: { list: [], total: 0, page: 1, page_size: 50 },
    })
    renderPage()
    expect(await screen.findByText('暂无历史告警')).toBeInTheDocument()
  })

  it('点击刷新触发重新加载', async () => {
    alertStatusApiMock.getAlertHistory.mockResolvedValue({
      status: 'success',
      data: { list: [], total: 0, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByText('暂无历史告警')
    const refreshBtn = screen.getAllByRole('button').find((b) => b.textContent?.replace(/\s/g, '') === '刷新')
    expect(refreshBtn).toBeDefined()
    fireEvent.click(refreshBtn as HTMLElement)
    await waitFor(() => expect(alertStatusApiMock.getAlertHistory).toHaveBeenCalledTimes(2))
  })
})

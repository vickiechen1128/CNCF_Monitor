import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

  it('渲染标题与提示文案', async () => {
    alertStatusApiMock.getAlertHistory.mockResolvedValue({
      status: 'success',
      data: { list: [], total: 0, page: 1, page_size: 50 },
    })
    renderPage()
    expect(await screen.findByText('历史告警')).toBeInTheDocument()
    expect(screen.getByText(/恢复时间为 Prometheus 求值视角的近似值/)).toBeInTheDocument()
  })

  it('渲染历史告警列表：告警名、实例、状态、触发/恢复时间、持续时长、摘要', async () => {
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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HistoryAlertsPage } from './HistoryAlertsPage'
import type { AlertEventItem } from '../../types/alertmanager'

const alertStatusApiMock = {
  getPromAlerts: vi.fn(),
  getAlertmanagerAlerts: vi.fn(),
  getAlertHistory: vi.fn(),
  getAlertEvents: vi.fn(),
  getAlertEventStats: vi.fn(),
}
const networkDomainApiMock = {
  list: vi.fn(),
}

vi.mock('../../api/alertmanager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/alertmanager')>()
  return {
    ...actual,
    alertStatusApi: {
      getPromAlerts: (...a: unknown[]) => alertStatusApiMock.getPromAlerts(...a),
      getAlertmanagerAlerts: (...a: unknown[]) => alertStatusApiMock.getAlertmanagerAlerts(...a),
      getAlertHistory: (...a: unknown[]) => alertStatusApiMock.getAlertHistory(...a),
      getAlertEvents: (...a: unknown[]) => alertStatusApiMock.getAlertEvents(...a),
      getAlertEventStats: (...a: unknown[]) => alertStatusApiMock.getAlertEventStats(...a),
    },
  }
})
vi.mock('../../api/domain', () => ({
  networkDomainApi: {
    list: (...a: unknown[]) => networkDomainApiMock.list(...a),
  },
}))
vi.mock('antd/locale/zh_CN', () => ({ default: {} }))

const eventItem = (over: Partial<AlertEventItem> = {}): AlertEventItem => ({
  id: 1,
  alert_name: 'HighCPU',
  status: 'resolved',
  network_domain: 'default',
  starts_at: '2026-09-08T01:00:00Z',
  ends_at: '2026-09-08T02:00:00Z',
  updated_at: '2026-09-08T02:00:00Z',
  duration_seconds: 3600,
  summary: 'CPU 使用率过高',
  labels: { instance: '10.0.0.1:9100' },
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
    alertStatusApiMock.getAlertEvents.mockReset()
    alertStatusApiMock.getAlertHistory.mockReset()
    alertStatusApiMock.getPromAlerts.mockReset()
    alertStatusApiMock.getAlertmanagerAlerts.mockReset()
    networkDomainApiMock.list.mockReset()
    networkDomainApiMock.list.mockResolvedValue({ data: { list: [{ id: 'default', name: '默认域' }] } })
  })

  it('渲染语义折叠栏（默认收起）与「恢复时间」列头角标，无独立标题卡片', async () => {
    alertStatusApiMock.getAlertEvents.mockResolvedValue({
      status: 'success',
      data: { list: [], total: 0, page: 1, page_size: 20 },
    })
    const { container } = renderPage()
    expect(await screen.findByText(/一次告警发生只保留一行，恢复时回填/)).toBeInTheDocument()
    expect(container.querySelector('h4.ant-typography')).toBeNull()
    // 折叠栏默认收起：说明正文不在 DOM；展开后可见
    expect(screen.queryByText(/未恢复期间的重复通知不会新增记录/)).toBeNull()
    fireEvent.click(screen.getByText(/一次告警发生只保留一行，恢复时回填/))
    expect(await screen.findByText(/未恢复期间的重复通知不会新增记录/)).toBeInTheDocument()
    expect(screen.getAllByText(/恢复时间/).length).toBeGreaterThan(0)
  })

  it('渲染历史告警列表：告警名、采集地址、状态、摘要', async () => {
    alertStatusApiMock.getAlertEvents.mockResolvedValue({
      status: 'success',
      data: { list: [eventItem()], total: 1, page: 1, page_size: 20 },
    })
    renderPage()
    expect(await screen.findByText('HighCPU')).toBeInTheDocument()
    expect(screen.getByText('10.0.0.1:9100')).toBeInTheDocument()
    expect(screen.getByText('已恢复')).toBeInTheDocument()
    expect(screen.getByText('CPU 使用率过高')).toBeInTheDocument()
  })

  it('网域列优先展示 network_domain_name 中文名；存量记录按网域 ID 映射名称', async () => {
    networkDomainApiMock.list.mockResolvedValue({
      data: {
        list: [
          { id: 'gov-cloud-a', name: '政务网A区' },
          { id: 'default', name: '默认域' },
        ],
      },
    })
    alertStatusApiMock.getAlertEvents.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          eventItem({
            id: 1,
            alert_name: 'WithName',
            network_domain: 'gov-cloud-a',
            labels: { network_domain_name: '政务网A区' },
          }),
          eventItem({ id: 2, alert_name: 'Legacy', network_domain: 'default', labels: {} }),
        ],
        total: 2,
        page: 1,
        page_size: 20,
      },
    })
    renderPage()
    const withNameRow = (await screen.findByText('WithName')).closest('tr')
    expect(withNameRow).not.toBeNull()
    expect(within(withNameRow as HTMLElement).getByText('政务网A区')).toBeInTheDocument()

    const legacyRow = screen.getByText('Legacy').closest('tr')
    expect(legacyRow).not.toBeNull()
    expect(within(legacyRow as HTMLElement).getByText('默认域')).toBeInTheDocument()
  })

  it('六态按语义展示：告警中 / 静默中 / 抑制中 / 静默期间结束 / 恢复信息丢失', async () => {
    alertStatusApiMock.getAlertEvents.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          eventItem({ id: 1, alert_name: 'A', status: 'firing' }),
          eventItem({ id: 2, alert_name: 'B', status: 'silenced' }),
          eventItem({ id: 3, alert_name: 'C', status: 'inhibited' }),
          eventItem({ id: 4, alert_name: 'D', status: 'silenced_closed' }),
          eventItem({ id: 5, alert_name: 'E', status: 'lost' }),
        ],
        total: 5,
        page: 1,
        page_size: 20,
      },
    })
    renderPage()
    expect(await screen.findByText('A')).toBeInTheDocument()
    expect(screen.getByText('告警中')).toBeInTheDocument()
    expect(screen.getByText('静默中')).toBeInTheDocument()
    expect(screen.getByText('抑制中')).toBeInTheDocument()
    expect(screen.getByText('静默期间结束')).toBeInTheDocument()
    expect(screen.getByText('恢复信息丢失')).toBeInTheDocument()
  })

  it('聚合告警（无实例）展示「全局/聚合」', async () => {
    alertStatusApiMock.getAlertEvents.mockResolvedValue({
      status: 'success',
      data: {
        list: [eventItem({ alert_name: 'HostTargetsMissing', labels: {}, summary: '目标全部丢失' })],
        total: 1,
        page: 1,
        page_size: 20,
      },
    })
    renderPage()
    expect(await screen.findByText('HostTargetsMissing')).toBeInTheDocument()
    expect(screen.getByText('全局/聚合')).toBeInTheDocument()
  })

  it('实例名 / 采集地址拆两列：resource_name 回填，无资源时实例名为 -', async () => {
    alertStatusApiMock.getAlertEvents.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          eventItem({ resource_name: 'prod-db-01', instance_address: '10.0.0.1:9100' }),
          eventItem({
            id: 2,
            alert_name: 'HostTargetsMissing',
            labels: {},
            instance_address: '',
            instance_display: '',
            resource_name: '',
          }),
        ],
        total: 2,
        page: 1,
        page_size: 20,
      },
    })
    renderPage()
    const row = (await screen.findByText('prod-db-01')).closest('tr')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('10.0.0.1:9100')).toBeInTheDocument()

    const aggRow = screen.getByText('HostTargetsMissing').closest('tr')
    expect(aggRow).not.toBeNull()
    expect(within(aggRow as HTMLElement).getByText('-')).toBeInTheDocument()
    expect(within(aggRow as HTMLElement).getByText('全局/聚合')).toBeInTheDocument()
  })

  it('摘要筛选框与告警名筛选框并存', async () => {
    alertStatusApiMock.getAlertEvents.mockResolvedValue({
      status: 'success',
      data: { list: [], total: 0, page: 1, page_size: 20 },
    })
    renderPage()
    expect(await screen.findByPlaceholderText('按告警名筛选')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('按摘要关键字筛选')).toBeInTheDocument()
  })

  it('「采集地址」列头挂提示角标，消解 :9100 被误读为业务端口', async () => {
    alertStatusApiMock.getAlertEvents.mockResolvedValue({
      status: 'success',
      data: { list: [], total: 0, page: 1, page_size: 20 },
    })
    renderPage()
    const header = await screen.findByRole('columnheader', { name: /采集地址/ })
    const badge = header.querySelector('.anticon-info-circle')
    expect(badge).toBeTruthy()
    fireEvent.mouseEnter(badge!)
    expect(await screen.findByText(/采集器地址，非业务端口/)).toBeInTheDocument()
  })

  it('空结果展示「暂无历史告警」', async () => {
    alertStatusApiMock.getAlertEvents.mockResolvedValue({
      status: 'success',
      data: { list: [], total: 0, page: 1, page_size: 20 },
    })
    renderPage()
    expect(await screen.findByText('暂无历史告警')).toBeInTheDocument()
  })

  it('PL-1：空结果额外展示「去写规则」引导，落点为 /rules', async () => {
    alertStatusApiMock.getAlertEvents.mockResolvedValue({
      status: 'success',
      data: { list: [], total: 0, page: 1, page_size: 20 },
    })
    renderPage()
    const link = await screen.findByRole('link', { name: '去写规则 →' })
    expect(link).toHaveAttribute('href', '/rules')
    expect(screen.getByText(/还没有告警规则？/)).toBeInTheDocument()
  })

  it('PL-1：接口错误时不展示「去写规则」引导（不把失败伪装成无数据）', async () => {
    alertStatusApiMock.getAlertEvents.mockRejectedValue(new Error('boom'))
    renderPage()
    expect(await screen.findByText('历史告警加载失败')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '去写规则 →' })).toBeNull()
  })

  it('点击刷新触发重新加载', async () => {
    alertStatusApiMock.getAlertEvents.mockResolvedValue({
      status: 'success',
      data: { list: [], total: 0, page: 1, page_size: 20 },
    })
    renderPage()
    await screen.findByText('暂无历史告警')
    const refreshBtn = screen.getAllByRole('button').find((b) => b.textContent?.replace(/\s/g, '') === '刷新')
    expect(refreshBtn).toBeDefined()
    fireEvent.click(refreshBtn as HTMLElement)
    await waitFor(() => expect(alertStatusApiMock.getAlertEvents).toHaveBeenCalledTimes(2))
  })

  it('请求携带触发时间范围与服务端分页参数（不再传 Prometheus 步长）', async () => {
    alertStatusApiMock.getAlertEvents.mockResolvedValue({
      status: 'success',
      data: { list: [], total: 0, page: 1, page_size: 20 },
    })
    renderPage()
    await screen.findByText('暂无历史告警')

    expect(alertStatusApiMock.getAlertEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        page_size: 20,
        starts_from: expect.any(String),
        starts_to: expect.any(String),
        sort: 'starts_at desc',
      }),
    )
    expect(alertStatusApiMock.getAlertEvents).not.toHaveBeenCalledWith(
      expect.objectContaining({ step: expect.anything() }),
    )
  })
})

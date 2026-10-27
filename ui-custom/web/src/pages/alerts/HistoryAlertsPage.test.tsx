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
  description: 'CPU 连续 5 分钟超过 90%',
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
    expect(screen.queryByText('10.0.0.1:9100')).toBeNull()
    expect(screen.getByText('已恢复')).toBeInTheDocument()
    expect(screen.getByText('CPU 使用率过高')).toBeInTheDocument()
    expect(screen.getByText('CPU 连续 5 分钟超过 90%')).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: '实例名' })).toBeNull()
  })

  it('网域只展示 event 中的 network_domain_name，缺失时不回连也不回落 ID', async () => {
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
    expect(within(legacyRow as HTMLElement).getAllByText('-').length).toBeGreaterThan(0)
    expect(within(legacyRow as HTMLElement).queryByText('默认域')).toBeNull()
    expect(within(legacyRow as HTMLElement).queryByText('default')).toBeNull()
  })

  it('七态按语义展示：告警中 / 静默中 / 抑制中 / 已恢复 / 静默期间结束 / 抑制期间结束 / 已结束（恢复时间未知）', async () => {
    alertStatusApiMock.getAlertEvents.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          eventItem({ id: 1, alert_name: 'A', status: 'firing' }),
          eventItem({ id: 2, alert_name: 'B', status: 'silenced' }),
          eventItem({ id: 3, alert_name: 'C', status: 'inhibited' }),
          eventItem({ id: 4, alert_name: 'D', status: 'resolved' }),
          eventItem({ id: 5, alert_name: 'E', status: 'silenced_closed' }),
          eventItem({ id: 6, alert_name: 'F', status: 'inhibited_closed' }),
          eventItem({ id: 7, alert_name: 'G', status: 'lost' }),
        ],
        total: 7,
        page: 1,
        page_size: 20,
      },
    })
    renderPage()
    expect(await screen.findByText('A')).toBeInTheDocument()
    expect(screen.getByText('告警中')).toBeInTheDocument()
    expect(screen.getByText('静默中')).toBeInTheDocument()
    expect(screen.getByText('抑制中')).toBeInTheDocument()
    expect(screen.getByText('已恢复')).toBeInTheDocument()
    expect(screen.getByText('静默期间结束')).toBeInTheDocument()
    expect(screen.getByText('抑制期间结束')).toBeInTheDocument()
    expect(screen.getByText('已结束（恢复时间未知）')).toBeInTheDocument()
  })

  it('不再展示采集地址列', async () => {
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
    expect(screen.queryByRole('columnheader', { name: /采集地址/ })).toBeNull()
    expect(screen.queryByText('全局/聚合')).toBeNull()
  })

  it('不展示 event 表之外的 resource_name 和采集地址', async () => {
    alertStatusApiMock.getAlertEvents.mockResolvedValue({
      status: 'success',
      data: {
        list: [eventItem({ resource_name: 'prod-db-01', instance_address: '10.0.0.1:9100' })],
        total: 1,
        page: 1,
        page_size: 20,
      },
    })
    renderPage()
    expect(await screen.findByText('HighCPU')).toBeInTheDocument()
    expect(screen.queryByText('10.0.0.1:9100')).toBeNull()
    expect(screen.queryByText('prod-db-01')).toBeNull()
    expect(screen.queryByRole('columnheader', { name: '实例名' })).toBeNull()
  })

  it('摘要、描述与告警名筛选框并存', async () => {
    alertStatusApiMock.getAlertEvents.mockResolvedValue({
      status: 'success',
      data: { list: [], total: 0, page: 1, page_size: 20 },
    })
    renderPage()
    expect(await screen.findByPlaceholderText('按告警名筛选')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('按摘要关键字筛选')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('按描述关键字筛选')).toBeInTheDocument()
  })

  it('关闭时间位于恢复时间之后，且不展示采集地址', async () => {
    alertStatusApiMock.getAlertEvents.mockResolvedValue({
      status: 'success',
      data: { list: [eventItem()], total: 1, page: 1, page_size: 20 },
    })
    renderPage()
    const headers = await screen.findAllByRole('columnheader')
    const texts = headers.map((h) => h.textContent)
    expect(texts.indexOf('关闭时间')).toBe(texts.indexOf('恢复时间') + 1)
    expect(texts).not.toContain('采集地址')
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
    fireEvent.change(screen.getByPlaceholderText('按描述关键字筛选'), { target: { value: '连接超时' } })
    await waitFor(() => expect(alertStatusApiMock.getAlertEvents).toHaveBeenCalledWith(
      expect.objectContaining({ description: '连接超时' }),
    ))

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

  it('点击导出按当前筛选条件下载 CSV', async () => {
    const createSpy = vi.fn(() => 'blob:csv')
    const revokeSpy = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL: createSpy, revokeObjectURL: revokeSpy })
    alertStatusApiMock.getAlertEvents.mockResolvedValue({
      status: 'success',
      data: { list: [], total: 0, page: 1, page_size: 100 },
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /导出/ }))
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1))
    expect(alertStatusApiMock.getAlertEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, page_size: 100, sort: 'starts_at desc' }),
    )
    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(revokeSpy).toHaveBeenCalledWith('blob:csv')
    vi.unstubAllGlobals()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { alertEventsToCSV, downloadAlertEvents } from './historyAlertExport'
import type { AlertEventItem } from '../../types/alertmanager'

const item: AlertEventItem = {
  id: 1,
  alert_name: 'HighCPU',
  status: 'resolved',
  network_domain: 'default',
  summary: 'CPU, 使用率过高',
  description: '第一行\n第二行 "详情"',
  starts_at: '2026-10-27T01:00:00Z',
  ends_at: '2026-10-27T02:00:00Z',
  closed_at: '2026-10-27T02:00:00Z',
  updated_at: '2026-10-27T02:00:00Z',
  duration_seconds: 3600,
  labels: { instance: '10.0.0.1:9100', network_domain_name: '腾讯云' },
  resource_name: '不应导出',
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('historyAlertExport', () => {
  it('exports event fields with Chinese BOM and escaped text, without resource enrichment', () => {
    const csv = alertEventsToCSV([item])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"CPU, 使用率过高"')
    expect(csv).toContain('"第一行\n第二行 ""详情"""')
    expect(csv).toContain('"腾讯云"')
    expect(csv).not.toContain('采集地址')
    expect(csv).not.toContain('不应导出')
  })

  it('neutralizes spreadsheet formulas', () => {
    const csv = alertEventsToCSV([{ ...item, summary: '=HYPERLINK("bad")' }])
    expect(csv).toContain("'=HYPERLINK")
  })

  it('downloads all filtered pages', async () => {
    const createObjectURL = vi.fn(() => 'blob:csv')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ status: 'success', data: { list: Array(100).fill(item), total: 101, page: 1, page_size: 100 } })
      .mockResolvedValueOnce({ status: 'success', data: { list: [item], total: 101, page: 2, page_size: 100 } })

    await downloadAlertEvents({ status: 'resolved', alert_name: 'HighCPU' }, fetcher)

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: 'resolved', alert_name: 'HighCPU', page: 1, page_size: 100 }))
    expect(fetcher).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 2, page_size: 100 }))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:csv')
  })
})

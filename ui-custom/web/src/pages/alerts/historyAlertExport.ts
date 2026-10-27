import { alertStatusApi, type AlertEventQuery } from '../../api/alertmanager'
import type { ApiResponse } from '../../types/api'
import type { AlertEventData, AlertEventItem } from '../../types/alertmanager'
import { triggerBlobDownload } from '../../utils/triggerBlobDownload'
import { alertEventStatusLabel } from './alertmanagerConstants'

type EventFetcher = (params?: AlertEventQuery) => Promise<ApiResponse<AlertEventData>>

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  const safe = text.length > 1 && /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

export function alertEventsToCSV(items: AlertEventItem[]): string {
  const headers = ['告警名称', '状态', '网域', '摘要', '描述', '触发时间', '恢复时间', '关闭时间', '持续时长（秒）']
  const rows = items.map((item) => [
    item.alert_name,
    alertEventStatusLabel[item.status] ?? item.status,
    item.labels?.network_domain_name || '-',
    item.summary || '-',
    item.description || '-',
    item.starts_at || '-',
    item.ends_at || '-',
    item.closed_at || '-',
    item.duration_seconds ?? '-',
  ])
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`
}

export async function downloadAlertEvents(params: AlertEventQuery, fetcher: EventFetcher = alertStatusApi.getAlertEvents): Promise<void> {
  const first = await fetcher({ ...params, page: 1, page_size: 100, sort: 'starts_at desc' })
  const items = [...(first.data?.list ?? [])]
  const total = first.data?.total ?? items.length
  for (let page = 2; items.length < total; page++) {
    const next = await fetcher({ ...params, page, page_size: 100, sort: 'starts_at desc' })
    const batch = next.data?.list ?? []
    if (batch.length === 0) break
    items.push(...batch)
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  triggerBlobDownload(new Blob([alertEventsToCSV(items)], { type: 'text/csv;charset=utf-8' }), `alert-events-${timestamp}.csv`)
}

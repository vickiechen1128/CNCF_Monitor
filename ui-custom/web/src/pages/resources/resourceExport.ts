import { resourceApi, type ResourceListParams } from '../../api/resources'
import type { ResourceCategory } from '../../types/resource'
import type { ResourceListItem } from './useResources'
import { triggerBlobDownload } from '../../utils/triggerBlobDownload'

type ExportColumn = { key: keyof ResourceListItem; label: string }

const SHARED_COLUMNS: ExportColumn[] = [
  { key: 'resource_id', label: '资源 ID' },
  { key: 'network_domain_id', label: '网域' },
  { key: 'biz_code', label: '业务编码' },
  { key: 'app_code', label: '应用编码' },
  { key: 'platform_code', label: '平台编码' },
  { key: 'env', label: '环境' },
  { key: 'cluster', label: '集群' },
  { key: 'owner', label: '负责人' },
  { key: 'status', label: '运行状态' },
  { key: 'source_type', label: '来源' },
]

const CATEGORY_COLUMNS: Record<ResourceCategory, ExportColumn[]> = {
  host: [
    { key: 'instance_name', label: '实例名' }, { key: 'hostname', label: '主机名' },
    { key: 'instance_ip', label: 'IP 地址' }, { key: 'os_type', label: '操作系统' },
    { key: 'scrape_port', label: '采集端口' }, { key: 'activated_at', label: '开通时间' },
  ],
  database: [
    { key: 'database_type', label: '数据库类型' }, { key: 'instance_ip', label: 'IP 地址' },
    { key: 'port', label: '端口' }, { key: 'version', label: '版本' }, { key: 'scrape_port', label: '采集端口' },
  ],
  middleware: [
    { key: 'middleware_type', label: '中间件类型' }, { key: 'instance_ip', label: 'IP 地址' },
    { key: 'port', label: '端口' }, { key: 'version', label: '版本' }, { key: 'scrape_port', label: '采集端口' },
  ],
  application: [
    { key: 'service_name', label: '服务名' }, { key: 'health_check_url', label: '健康检查 URL' },
    { key: 'owner1', label: '负责人1' }, { key: 'owner1_contact', label: '负责人1联系方式' },
    { key: 'owner2', label: '负责人2' }, { key: 'owner2_contact', label: '负责人2联系方式' },
    { key: 'ops_person', label: '运维人员' }, { key: 'ops_person_contact', label: '运维人员联系方式' },
    { key: 'go_live_at', label: '应用上线时间' }, { key: 'protocol', label: '协议' },
    { key: 'endpoint', label: '端点' }, { key: 'port', label: '端口' }, { key: 'scrape_port', label: '采集端口' },
  ],
  generic_target: [
    { key: 'target_name', label: '目标名称' }, { key: 'instance_ip', label: 'IP 地址' },
    { key: 'port', label: '端口' }, { key: 'metrics_path', label: '采集路径' },
    { key: 'scheme', label: '协议' }, { key: 'exporter_type', label: 'Exporter 类型' },
    { key: 'custom_labels', label: '自定义标签' }, { key: 'scrape_port', label: '采集端口' },
  ],
  interface_service: [
    { key: 'api_name', label: '接口名' }, { key: 'api_url', label: '接口地址' },
  ],
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  const safe = text.length > 1 && /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

export function resourcesToCSV(category: ResourceCategory, items: ResourceListItem[]): string {
  const columns = [...SHARED_COLUMNS, ...CATEGORY_COLUMNS[category]]
  const rows = items.map((item) => columns.map((column) => item[column.key] ?? '-'))
  const header = columns.map((column) => column.label)
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`
}

export async function downloadResources(category: ResourceCategory, filters: ResourceListParams): Promise<void> {
  const items: ResourceListItem[] = []
  let page = 1
  let total: number
  do {
    const res = await resourceApi.list({ ...filters, resource_category: category, page, page_size: 100 })
    const batch = (res.data?.list ?? []) as ResourceListItem[]
    items.push(...batch)
    total = res.data?.total ?? batch.length
    page += 1
  } while (items.length < total)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  triggerBlobDownload(
    new Blob([resourcesToCSV(category, items)], { type: 'text/csv;charset=utf-8' }),
    `resources-${category}-${timestamp}.csv`,
  )
}

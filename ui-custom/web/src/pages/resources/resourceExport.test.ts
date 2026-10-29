import { beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadResources, resourcesToCSV } from './resourceExport'
import type { ResourceListItem } from './useResources'

const listMock = vi.fn()
const downloadMock = vi.fn()

vi.mock('../../api/resources', () => ({
  resourceApi: { list: (...args: unknown[]) => listMock(...args) },
}))
vi.mock('../../utils/triggerBlobDownload', () => ({
  triggerBlobDownload: (...args: unknown[]) => downloadMock(...args),
}))

const applicationRow: ResourceListItem = {
  resource_id: 'app-1',
  resource_category: 'application',
  network_domain_id: 'default',
  status: 'online',
  source_type: 'manual',
  service_name: 'order-service',
  owner1: '张三',
  owner1_contact: '13800000001',
  owner2: '李四',
  owner2_contact: '13800000002',
  ops_person: '王五',
  ops_person_contact: 'ops@example.com',
  go_live_at: '2026-10-28T08:00:00Z',
}

describe('resourceExport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exports application owners, ops person and go-live time', () => {
    const csv = resourcesToCSV('application', [applicationRow])
    for (const text of [
      '负责人1', '负责人1联系方式', '负责人2', '负责人2联系方式',
      '运维人员', '运维人员联系方式', '应用上线时间',
      '张三', '13800000002', '王五', 'ops@example.com', '2026-10-28T08:00:00Z',
    ]) {
      expect(csv).toContain(text)
    }
  })

  it('exports host activated time', () => {
    const hostRow: ResourceListItem = {
      resource_id: 'host-1',
      resource_category: 'host',
      network_domain_id: 'default',
      status: 'online',
      source_type: 'manual',
      instance_name: 'web-01',
      activated_at: '2026-10-01T08:30:00Z',
    }
    const csv = resourcesToCSV('host', [hostRow])
    expect(csv).toContain('开通时间')
    expect(csv).toContain('2026-10-01T08:30:00Z')
  })

  it('does not export scrape_port for interface services', () => {
    expect(resourcesToCSV('interface_service', [])).not.toContain('采集端口')
  })

  it('downloads the current category with filters and all pages', async () => {
    listMock
      .mockResolvedValueOnce({ status: 'success', data: { list: [applicationRow], total: 2, page: 1, page_size: 100 } })
      .mockResolvedValueOnce({ status: 'success', data: { list: [applicationRow], total: 2, page: 2, page_size: 100 } })
    await downloadResources('application', { keyword: 'order', status: 'online' })

    expect(listMock).toHaveBeenCalledTimes(2)
    expect(listMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ resource_category: 'application', keyword: 'order', status: 'online', page: 1, page_size: 100 }))
    expect(downloadMock).toHaveBeenCalledOnce()
  })
})

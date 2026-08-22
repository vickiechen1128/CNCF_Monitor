import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DomainsPage } from './DomainsPage'
import type { NetworkDomain } from '../../../types/domain'

const useDomainsMock = vi.fn()
const zoneTypeListMock = vi.fn()
const tenantListMock = vi.fn()
const reloadMock = vi.fn()

vi.mock('../../../api/domain', () => ({
  zoneTypeApi: { list: (...a: unknown[]) => zoneTypeListMock(...a) },
  tenantApi: { list: (...a: unknown[]) => tenantListMock(...a) },
  networkDomainApi: { list: vi.fn() },
}))
vi.mock('./useDomains', () => ({
  useDomains: (...a: unknown[]) => useDomainsMock(...a),
}))
vi.mock('./DomainForm', () => ({ DomainFormModal: () => null }))
vi.mock('./DisableDomainModal', () => ({ DisableDomainModal: () => null }))
vi.mock('./DeleteDomainModal', () => ({ DeleteDomainModal: () => null }))

const domainRow = (id: string, name: string, extra: Partial<NetworkDomain> = {}): NetworkDomain => ({
  id,
  name,
  description: '',
  domain_type: 'edge',
  zone_type: '',
  tenant_id: 'platform_admin',
  authorized_tenant_ids: ['platform_admin'],
  cmdb_cloud_area_id: '',
  cmdb_cloud_area_path: '',
  channel: 'local',
  is_monitored: false,
  status: 'enabled',
  created_at: '2026-08-21T00:00:00Z',
  updated_at: '2026-08-21T00:00:00Z',
  ...extra,
})

function result(over: Partial<Record<string, unknown>> = {}) {
  return {
    data: { list: [] as NetworkDomain[], total: 0, page: 1, page_size: 20 },
    loading: false,
    error: null,
    permissionDenied: false,
    filters: {},
    setFilters: vi.fn(),
    page: 1,
    pageSize: 20,
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    reload: reloadMock,
    ...over,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DomainsPage />
    </MemoryRouter>,
  )
}

describe('DomainsPage', () => {
  beforeEach(() => {
    useDomainsMock.mockReset()
    zoneTypeListMock.mockReset()
    tenantListMock.mockReset()
    reloadMock.mockReset()
    zoneTypeListMock.mockResolvedValue({ status: 'success', data: [] })
    tenantListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 100 } })
  })

  it('shows loading spinner while loading', () => {
    useDomainsMock.mockReturnValue(result({ loading: true }))
    const { container } = renderPage()
    expect(container.querySelector('.ant-spin')).toBeTruthy()
  })

  it('renders domain rows on success', async () => {
    useDomainsMock.mockReturnValue(
      result({ data: { list: [domainRow('mc-a', '政务网A区'), domainRow('mc-b', '医院专网')], total: 2, page: 1, page_size: 20 } }),
    )
    renderPage()
    expect(await screen.findByText('政务网A区')).toBeInTheDocument()
    expect(screen.getByText('医院专网')).toBeInTheDocument()
  })

  it('renders empty state with 登记网域 guidance', async () => {
    useDomainsMock.mockReturnValue(result())
    renderPage()
    expect(await screen.findByText('暂无网域')).toBeInTheDocument()
    expect(screen.getAllByText('登记网域').length).toBeGreaterThanOrEqual(1)
  })

  it('renders error Alert and reload button triggers reload', async () => {
    useDomainsMock.mockReturnValue(result({ error: 'boom' }))
    renderPage()
    expect(await screen.findByText('网域列表加载失败，请稍后重试')).toBeInTheDocument()
    const reloadBtn = await screen.findByRole('button', { name: /重新加载/ })
    fireEvent.click(reloadBtn)
    expect(reloadMock).toHaveBeenCalled()
  })

  it('shows permission denied empty state', async () => {
    useDomainsMock.mockReturnValue(result({ permissionDenied: true }))
    renderPage()
    expect(await screen.findByText('当前账号无此页面查看权限')).toBeInTheDocument()
  })

  it('renders no delete entry for management domain', async () => {
    useDomainsMock.mockReturnValue(
      result({
        data: {
          list: [domainRow('mc-admin', '系统管理域', { domain_type: 'management' })],
          total: 1,
          page: 1,
          page_size: 20,
        },
      }),
    )
    renderPage()
    expect(await screen.findByText('系统管理域')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /删除/ })).toBeNull()
  })
})

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
vi.mock('./DomainForm', () => ({ DomainDrawer: () => null }))
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

  it('collection read-compat domain offers disable and delete', async () => {
    useDomainsMock.mockReturnValue(
      result({
        data: {
          list: [domainRow('mc-legacy', '历史域A', { domain_type: 'collection' })],
          total: 1,
          page: 1,
          page_size: 20,
        },
      }),
    )
    renderPage()
    expect(await screen.findByText('历史域A')).toBeInTheDocument()
    fireEvent.mouseEnter(screen.getByRole('button', { name: '更多操作' }))
    expect(await screen.findByText('删除网域')).toBeInTheDocument()
    expect(screen.getByText('禁用网域')).toBeInTheDocument()
    expect(screen.getByText('已登记')).toBeInTheDocument()
  })

  it('renders access progress four-state text from access_step/is_monitored', async () => {
    useDomainsMock.mockReturnValue(
      result({
        data: {
          list: [
            domainRow('mc-a', '政务网A区'), // is_monitored=false → 已登记
            domainRow('mc-b', '医院专网', { is_monitored: true }), // 无上线 → 已纳管
            domainRow('mc-c', '工厂专网', { is_monitored: true, has_online_agents: true }), // 上线 → 采集节点已上线
          ],
          total: 3,
          page: 1,
          page_size: 20,
        },
      }),
    )
    renderPage()
    expect(await screen.findByText('政务网A区')).toBeInTheDocument()
    expect(screen.getAllByText('已登记')).toBeTruthy()
    expect(screen.getByText('已纳管')).toBeInTheDocument()
    expect(screen.getByText('采集节点已上线')).toBeInTheDocument()
  })

  // 回归：后端派生 access_step=4（域下已有生效采集任务）时须渲染「已出数据」，
  // 主操作切到「查看采集任务」，不再停留在第 3 态提示去配置采集任务。
  it('renders step 4 已出数据 with 查看采集任务 primary action', async () => {
    useDomainsMock.mockReturnValue(
      result({
        data: {
          list: [
            domainRow('mc-d', '腾讯边缘域', {
              is_monitored: true,
              has_online_agents: true,
              access_step: 4,
            }),
          ],
          total: 1,
          page: 1,
          page_size: 20,
        },
      }),
    )
    renderPage()
    expect(await screen.findByText('腾讯边缘域')).toBeInTheDocument()
    expect(screen.getByText('已出数据')).toBeInTheDocument()
    expect(screen.queryByText('采集节点已上线')).toBeNull()
    expect(screen.getByRole('button', { name: /查看采集任务/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /去配置采集/ })).toBeNull()
  })

  it('opens detail drawer when clicking domain name (sinking ID/desc)', async () => {
    useDomainsMock.mockReturnValue(
      result({
        data: {
          list: [domainRow('mc-a', '政务网A区', { description: '政务网' })],
          total: 1,
          page: 1,
          page_size: 20,
        },
      }),
    )
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /政务网A区/ }))
    // 详情抽屉下沉展示：网域 ID / 描述
    expect(await screen.findByText('网域 ID')).toBeInTheDocument()
    expect(screen.getByText('mc-a')).toBeInTheDocument()
    expect(screen.getByText('政务网')).toBeInTheDocument()
  })
})

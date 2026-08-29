import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TenantsPage } from './TenantsPage'
import { setupAntdTest } from '../../../test/antdTestUtils'
import type { Tenant } from '../../../types/domain'

const useTenantsMock = vi.fn()
const setFiltersMock = vi.fn()
const reloadMock = vi.fn()
const detailCloseMock = vi.fn()
const editCloseMock = vi.fn()
const detailTenantMock = vi.fn()

vi.mock('./useTenants', () => ({ useTenants: (...a: unknown[]) => useTenantsMock(...a) }))
vi.mock('./TenantDetailDrawer', () => ({
  TenantDetailDrawer: (p: { open: boolean; tenant: Tenant | null; onClose: () => void }) => {
    detailTenantMock(p)
    return null
  },
}))
vi.mock('./TenantEditModal', () => {
  return {
    TenantEditModal: (p: { open: boolean; tenant: Tenant | null; onCancel: () => void }) => {
      editCloseMock(p)
      return null
    },
  }
})

const tenantRow = (extra: Partial<Tenant> = {}): Tenant => ({
  id: 'platform_admin',
  name: '系统平台租户',
  network_domain_ids: [],
  multi_site_enabled: false,
  is_platform_admin: true,
  status: 'active',
  created_at: '2026-08-21T00:00:00Z',
  updated_at: '2026-08-21T00:00:00Z',
  ...extra,
})

function result(over: Record<string, unknown> = {}) {
  return {
    data: { items: [] as Tenant[], total: 0 },
    loading: false,
    error: null,
    filters: {},
    setFilters: setFiltersMock,
    reload: reloadMock,
    ...over,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <TenantsPage />
    </MemoryRouter>,
  )
}

describe('TenantsPage', () => {
  setupAntdTest()

  beforeEach(() => {
    useTenantsMock.mockReset()
    setFiltersMock.mockReset()
    reloadMock.mockReset()
    detailCloseMock.mockReset()
    editCloseMock.mockReset()
    detailTenantMock.mockReset()
  })

  it('shows loading spinner while loading', () => {
    useTenantsMock.mockReturnValue(result({ loading: true }))
    const { container } = renderPage()
    expect(container.querySelector('.ant-spin')).toBeTruthy()
  })

  it('renders tenant rows on success', async () => {
    useTenantsMock.mockReturnValue(result({ data: { items: [tenantRow()], total: 1 } }))
    renderPage()
    expect(await screen.findByText('系统平台租户')).toBeInTheDocument()
    expect(screen.getByText('platform_admin')).toBeInTheDocument()
  })

  it('renders empty state', async () => {
    useTenantsMock.mockReturnValue(result())
    renderPage()
    expect(await screen.findByText('暂无租户')).toBeInTheDocument()
  })

  it('renders error Alert and reload button triggers reload', async () => {
    useTenantsMock.mockReturnValue(result({ error: 'boom' }))
    renderPage()
    expect(await screen.findByText('租户列表加载失败，请稍后重试')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /重新加载/ }))
    expect(reloadMock).toHaveBeenCalled()
  })

  it('has NO 新建租户 and NO 禁用 entry (view/edit only, MVP)', async () => {
    useTenantsMock.mockReturnValue(result({ data: { items: [tenantRow()], total: 1 } }))
    renderPage()
    expect(await screen.findByText('系统平台租户')).toBeInTheDocument()
    // 无新建入口
    expect(screen.queryByRole('button', { name: /新建租户/ })).toBeNull()
    // 无禁用入口；仅有「查看」「编辑」
    expect(screen.queryByRole('button', { name: /禁用/ })).toBeNull()
    expect(screen.getByRole('button', { name: /查看/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /编辑/ })).toBeInTheDocument()
  })
})
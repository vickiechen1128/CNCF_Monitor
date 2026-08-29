import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { setupAntdTest } from '../../../test/antdTestUtils'
import { TenantDetailDrawer } from './TenantDetailDrawer'
import type { Tenant } from '../../../types/domain'

const tenant: Tenant = {
  id: 'platform_admin',
  name: '系统平台租户',
  network_domain_ids: ['mc-a'],
  multi_site_enabled: true,
  is_platform_admin: true,
  status: 'active',
  created_at: '2026-08-21T00:00:00Z',
  updated_at: '2026-08-21T00:00:00Z',
}

describe('TenantDetailDrawer', () => {
  setupAntdTest()

  it('renders tenant fields (view-only)', () => {
    render(<TenantDetailDrawer open tenant={tenant} onClose={() => {}} />)
    expect(screen.getByText('租户详情')).toBeInTheDocument()
    expect(screen.getByText('系统平台租户')).toBeInTheDocument()
    expect(screen.getAllByText('启用').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('开启')).toBeInTheDocument()
  })
})
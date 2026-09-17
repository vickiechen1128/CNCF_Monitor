import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { setupAntdTest } from '../../../test/antdTestUtils'
import { TenantEditModal } from './TenantEditModal'
import type { Tenant } from '../../../types/domain'

const updateMock = vi.fn()
const onCancelMock = vi.fn()
const onSuccessMock = vi.fn()

vi.mock('../../../api/admin', () => ({
  tenantAdminApi: { update: (...a: unknown[]) => updateMock(...a) },
}))

const tenant: Tenant = {
  id: 'platform_admin',
  name: '系统平台租户',
  network_domain_ids: [],
  multi_site_enabled: false,
  is_platform_admin: true,
  status: 'active',
  created_at: '2026-08-21T00:00:00Z',
  updated_at: '2026-08-21T00:00:00Z',
}

describe('TenantEditModal', () => {
  setupAntdTest()

  beforeEach(() => {
    updateMock.mockReset()
    onCancelMock.mockReset()
    onSuccessMock.mockReset()
    updateMock.mockResolvedValue({ status: 'success', data: {} })
  })

  it('submits name/multi_site_enabled via update API and closes on success', async () => {
    render(
      <TenantEditModal open tenant={tenant} onCancel={onCancelMock} onSuccess={onSuccessMock} />,
    )
    fireEvent.change(screen.getByLabelText('租户名称'), { target: { value: '新租户名' } })
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith('platform_admin', {
        name: '新租户名',
        multi_site_enabled: false,
      })
    })
    expect(onSuccessMock).toHaveBeenCalled()
    expect(onCancelMock).toHaveBeenCalled()
  })

  it('does not submit when name empty', async () => {
    render(
      <TenantEditModal open tenant={tenant} onCancel={onCancelMock} onSuccess={onSuccessMock} />,
    )
    fireEvent.change(screen.getByLabelText('租户名称'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))
    expect(updateMock).not.toHaveBeenCalled()
  })
})
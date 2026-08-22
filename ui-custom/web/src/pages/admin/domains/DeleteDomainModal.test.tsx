import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DeleteDomainModal } from './DeleteDomainModal'
import type { NetworkDomain } from '../../../types/domain'

const removeMock = vi.fn()

vi.mock('../../../api/domain', () => ({
  networkDomainApi: { remove: (...a: unknown[]) => removeMock(...a) },
}))

const emptyDomain: NetworkDomain = {
  id: 'mc-a',
  name: '政务网A区',
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
}

const cancelMock = vi.fn()
const successMock = vi.fn()

function renderModal(domain: NetworkDomain | null) {
  return render(
    <DeleteDomainModal open domain={domain} onCancel={cancelMock} onSuccess={successMock} />,
  )
}

describe('DeleteDomainModal', () => {
  beforeEach(() => {
    removeMock.mockReset()
    cancelMock.mockReset()
    successMock.mockReset()
  })

  it('deletes a vacant domain on confirm', async () => {
    removeMock.mockResolvedValue({ status: 'success', data: null })
    renderModal(emptyDomain)
    expect(screen.getByText(/确定删除空网域「政务网A区」/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /确认删除/ }))
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('mc-a'))
    expect(successMock).toHaveBeenCalled()
    expect(cancelMock).toHaveBeenCalled()
  })

  it('shows rejection guidance when domain is not vacant', async () => {
    removeMock.mockRejectedValue(new Error('has refs'))
    renderModal(emptyDomain)
    fireEvent.click(screen.getByRole('button', { name: /确认删除/ }))

    await waitFor(() => expect(screen.getByText('该网域不可删除')).toBeInTheDocument())
    expect(screen.getByText(/请改用「禁用」冻结。/)).toBeInTheDocument()
    expect(successMock).not.toHaveBeenCalled()
    expect(cancelMock).not.toHaveBeenCalled()
  })

  it('cancels without calling remove', () => {
    renderModal(emptyDomain)
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }))
    expect(cancelMock).toHaveBeenCalled()
    expect(removeMock).not.toHaveBeenCalled()
  })

  it('renders nothing when domain is null', () => {
    const { container } = renderModal(null)
    expect(container.firstChild).toBeNull()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DeleteDomainModal } from './DeleteDomainModal'
import type { NetworkDomain } from '../../../types/domain'

const removeMock = vi.fn()

vi.mock('../../../api/domain', () => ({
  networkDomainApi: { remove: (...a: unknown[]) => removeMock(...a) },
}))

const vacantDomain: NetworkDomain = {
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

const monitoredDomain: NetworkDomain = {
  ...vacantDomain,
  id: 'mc-b',
  name: '政务网B区',
  is_monitored: true,
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
    removeMock.mockResolvedValue({ status: 'success', data: { id: 'mc-a', deleted: true, cascade_impact: { managed_edge_agent_count: 0, token_will_revoke: false, config_push_will_stop: false, agents_will_retire: 0 }, cascade_retired: { agent_count: 0, token_revoked: false } } })
    renderModal(vacantDomain)
    expect(screen.getByText(/确定删除网域「政务网A区」/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /确认删除/ }))
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('mc-a'))
    expect(successMock).toHaveBeenCalled()
    expect(cancelMock).toHaveBeenCalled()
  })

  it('shows cascade warning and requires name input + checkbox for monitored domain', async () => {
    removeMock.mockResolvedValue({ status: 'success', data: { id: 'mc-b', deleted: true, cascade_impact: { managed_edge_agent_count: 3, token_will_revoke: true, config_push_will_stop: true, agents_will_retire: 3 }, cascade_retired: { agent_count: 3, token_revoked: true } } })
    renderModal(monitoredDomain)

    // Cascade warning is shown
    expect(screen.getByText('该网域已纳管，删除后将执行级联清退')).toBeInTheDocument()
    expect(screen.getByText('凭据（Token）将废止')).toBeInTheDocument()
    expect(screen.getByText('采集节点将被标记为「已退场」（retired，终态，供审计追溯）')).toBeInTheDocument()

    // Confirm button should be disabled until name input and checkbox
    const confirmBtn = screen.getByRole('button', { name: /确认删除/ })
    expect(confirmBtn).toBeDisabled()

    // Type wrong name -> still disabled
    fireEvent.change(screen.getByPlaceholderText('政务网B区'), { target: { value: 'wrong' } })
    expect(confirmBtn).toBeDisabled()

    // Type correct name but no checkbox -> still disabled
    fireEvent.change(screen.getByPlaceholderText('政务网B区'), { target: { value: '政务网B区' } })
    expect(confirmBtn).toBeDisabled()

    // Check checkbox -> enabled
    fireEvent.click(screen.getByText('我已了解级联清退影响，确认删除'))
    expect(confirmBtn).not.toBeDisabled()

    // Click confirm
    fireEvent.click(confirmBtn)
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('mc-b'))
    expect(successMock).toHaveBeenCalled()
  })

  it('shows rejection guidance when domain has M07 resource refs', async () => {
    removeMock.mockRejectedValue(new Error('network domain "mc-a" still has 5 M07 resource reference(s)'))
    renderModal(vacantDomain)
    fireEvent.click(screen.getByRole('button', { name: /确认删除/ }))

    await waitFor(() => expect(screen.getByText('该网域不可删除')).toBeInTheDocument())
    expect(screen.getByText(/M07 resource reference/)).toBeInTheDocument()
    expect(successMock).not.toHaveBeenCalled()
    expect(cancelMock).not.toHaveBeenCalled()
  })

  it('cancels without calling remove', () => {
    renderModal(vacantDomain)
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }))
    expect(cancelMock).toHaveBeenCalled()
    expect(removeMock).not.toHaveBeenCalled()
  })

  it('renders nothing when domain is null', () => {
    const { container } = renderModal(null)
    expect(container.firstChild).toBeNull()
  })
})

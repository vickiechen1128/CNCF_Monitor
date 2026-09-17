import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DisableDomainModal } from './DisableDomainModal'
import type { NetworkDomain, NetworkDomainImpact } from '../../../types/domain'

const updateStatusMock = vi.fn()
const resolveImpactMock = vi.fn()

vi.mock('../../../api/domain', () => ({
  networkDomainApi: { updateStatus: (...a: unknown[]) => updateStatusMock(...a) },
  resolveNetworkDomainImpact: (...a: unknown[]) => resolveImpactMock(...a),
}))

const edgeDomain = (over: Partial<NetworkDomain> = {}): NetworkDomain => ({
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
  ...over,
})

const impact: NetworkDomainImpact = { resource_count: 5, managed_edge_agent_count: 2 }

const cancelMock = vi.fn()
const successMock = vi.fn()

function renderModal(domain: NetworkDomain | null) {
  return render(
    <DisableDomainModal open domain={domain} onCancel={cancelMock} onSuccess={successMock} />,
  )
}

describe('DisableDomainModal', () => {
  beforeEach(() => {
    updateStatusMock.mockReset()
    resolveImpactMock.mockReset()
    cancelMock.mockReset()
    successMock.mockReset()
  })

  it('confirms then shows impact scope and completes', async () => {
    const impactWithOnlineAgents = { ...impact, has_online_agents: true }
    updateStatusMock.mockResolvedValue({ status: 'success', data: { impact: impactWithOnlineAgents } })
    resolveImpactMock.mockReturnValue(impactWithOnlineAgents)
    renderModal(edgeDomain())
    expect(screen.getByText(/确定禁用网域「政务网A区」/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /确认禁用/ }))
    await waitFor(() => expect(screen.getByText('禁用已生效，影响范围如下')).toBeInTheDocument())
    expect(screen.getByText(/该网域下 M07 资源数：5/)).toBeInTheDocument()
    expect(screen.getByText(/已纳管 EdgeAgent 数：2/)).toBeInTheDocument()
    expect(screen.getByText('【重要】禁用为行政冻结')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /完\s*成/ }))
    expect(successMock).toHaveBeenCalled()
    expect(cancelMock).toHaveBeenCalled()
    expect(updateStatusMock).toHaveBeenCalledWith('mc-a', 'disabled')
  })

  it('does not show administrative freeze alert when has_online_agents=false', async () => {
    const impactWithoutOnlineAgents = { ...impact, has_online_agents: false }
    updateStatusMock.mockResolvedValue({ status: 'success', data: { impact: impactWithoutOnlineAgents } })
    resolveImpactMock.mockReturnValue(impactWithoutOnlineAgents)
    renderModal(edgeDomain())

    fireEvent.click(screen.getByRole('button', { name: /确认禁用/ }))
    await waitFor(() => expect(screen.getByText('禁用已生效，影响范围如下')).toBeInTheDocument())
    expect(screen.queryByText('【重要】禁用为行政冻结')).toBeNull()
  })

  it('does not allow disabling a management (default) domain', async () => {
    renderModal(edgeDomain({ domain_type: 'management' }))
    fireEvent.click(screen.getByRole('button', { name: /确认禁用/ }))
    await waitFor(() => expect(updateStatusMock).not.toHaveBeenCalled())
    expect(screen.queryByText('禁用已生效，影响范围如下')).toBeNull()
  })

  it('resets result state when reopened on another domain', async () => {
    const impactWithOnlineAgents = { ...impact, has_online_agents: true }
    updateStatusMock.mockResolvedValue({ status: 'success', data: { impact: impactWithOnlineAgents } })
    resolveImpactMock.mockReturnValue(impactWithOnlineAgents)

    const { rerender } = render(
      <DisableDomainModal open domain={edgeDomain()} onCancel={cancelMock} onSuccess={successMock} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /确认禁用/ }))
    await waitFor(() => expect(screen.getByText('禁用已生效，影响范围如下')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /完\s*成/ }))
    expect(updateStatusMock).toHaveBeenCalledWith('mc-a', 'disabled')

    // 关闭后重开另一域
    rerender(<DisableDomainModal open={false} domain={null} onCancel={cancelMock} onSuccess={successMock} />)
    rerender(
      <DisableDomainModal
        open
        domain={edgeDomain({ id: 'mc-other', name: '政务网C区' })}
        onCancel={cancelMock}
        onSuccess={successMock}
      />,
    )

    // 回退到确认阶段（无残留结果视图 / 影响范围）
    await waitFor(() => expect(screen.queryByText('禁用已生效，影响范围如下')).toBeNull())
    expect(screen.getByText(/确定禁用网域「政务网C区」/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /确认禁用/ })).toBeInTheDocument()
    expect(updateStatusMock).not.toHaveBeenCalledWith('mc-other', 'disabled')
  })

  it('cancels without calling status update', () => {
    renderModal(edgeDomain())
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }))
    expect(cancelMock).toHaveBeenCalled()
    expect(updateStatusMock).not.toHaveBeenCalled()
  })

  it('renders nothing when domain is null', () => {
    const { container } = renderModal(null)
    expect(container.firstChild).toBeNull()
  })
})

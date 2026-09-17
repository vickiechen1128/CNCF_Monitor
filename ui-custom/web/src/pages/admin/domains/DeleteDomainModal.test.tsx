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
    removeMock.mockResolvedValue({
      status: 'success',
      data: { id: 'mc-a', cascade_impact: { edge_agent_count: 0, will_retire_agents: [] } },
    })
    renderModal(vacantDomain)
    expect(screen.getByText(/确定删除网域「政务网A区」/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /确认删除/ }))
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('mc-a'))
    expect(successMock).toHaveBeenCalled()
    expect(cancelMock).toHaveBeenCalled()
  })

  it('requires name input + checkbox for monitored domain, then shows retired agents result', async () => {
    removeMock.mockResolvedValue({
      status: 'success',
      data: {
        id: 'mc-b',
        cascade_impact: {
          edge_agent_count: 3,
          will_retire_agents: [
            { id: 'a1', hostname: 'agent-01', status: 'online' },
            { id: 'a2', hostname: 'agent-02', status: 'offline' },
            { id: 'a3', hostname: 'agent-03', status: 'unknown' },
          ],
        },
      },
    })
    renderModal(monitoredDomain)

    // 级联清退警告文案对齐契约 §5.1.2
    expect(
      screen.getByText('该网域已纳管，删除后将执行级联清退：① 废止所有 Token；② 停止配置下发；③ 将采集节点标记为「已退场」（retired）。'),
    ).toBeInTheDocument()

    // 确认按钮在输入名称 + 勾选前不可用
    const confirmBtn = screen.getByRole('button', { name: /确认删除/ })
    expect(confirmBtn).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('政务网B区'), { target: { value: '政务网B区' } })
    // 名称正确但未勾选 -> 仍禁用
    expect(confirmBtn).toBeDisabled()

    fireEvent.click(screen.getByText('我已了解级联清退影响，确认删除'))
    expect(confirmBtn).not.toBeDisabled()

    fireEvent.click(confirmBtn)
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('mc-b'))

    // 删除结果视图：实列展示已退场采集节点清单（hostname + 状态 tag）
    // 「网域已删除」在成功 toast 与结果 Alert 中各出现一次，故用 ≥1 容忍断言。
    expect((await screen.findAllByText('网域已删除')).length).toBeGreaterThan(0)
    expect(screen.getByText(/agent-01（在线）/)).toBeInTheDocument()
    expect(screen.getByText(/agent-02（离线）/)).toBeInTheDocument()
    expect(screen.getByText(/agent-03（未知）/)).toBeInTheDocument()
    expect(successMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /完\s*成/ }))
    expect(successMock).toHaveBeenCalled()
    expect(cancelMock).toHaveBeenCalled()
  })

  it('omits retired agents list beyond 10 with ellipsis', async () => {
    const manyAgents = Array.from({ length: 12 }, (_, i) => ({
      id: `a${i}`,
      hostname: `agent-${i}`,
      status: 'online',
    }))
    removeMock.mockResolvedValue({
      status: 'success',
      data: { id: 'mc-b', cascade_impact: { edge_agent_count: 12, will_retire_agents: manyAgents } },
    })
    renderModal(monitoredDomain)

    fireEvent.change(screen.getByPlaceholderText('政务网B区'), { target: { value: '政务网B区' } })
    fireEvent.click(screen.getByText('我已了解级联清退影响，确认删除'))
    fireEvent.click(screen.getByRole('button', { name: /确认删除/ }))

    await waitFor(() => expect(removeMock).toHaveBeenCalled())
    expect(screen.getByText(/agent-9（在线）/)).toBeInTheDocument()
    expect(screen.getByText(/…等 2 个/)).toBeInTheDocument()
    expect(screen.queryByText(/agent-10（在线）/)).toBeNull()
  })

  it('uses trimmed name comparison for confirmation', async () => {
    removeMock.mockResolvedValue({
      status: 'success',
      data: { id: 'mc-b', cascade_impact: { edge_agent_count: 1, will_retire_agents: [{ id: 'a1', hostname: 'agent-01', status: 'online' }] } },
    })
    renderModal(monitoredDomain)
    const confirmBtn = screen.getByRole('button', { name: /确认删除/ })

    // 输入带前后空白与名称一致，应可通过
    fireEvent.change(screen.getByPlaceholderText('政务网B区'), { target: { value: '  政务网B区  ' } })
    fireEvent.click(screen.getByText('我已了解级联清退影响，确认删除'))
    expect(confirmBtn).not.toBeDisabled()
  })

  it('shows localized Chinese guidance when domain has M07 resource refs', async () => {
    removeMock.mockRejectedValue(new Error('network domain "mc-a" still has 5 M07 resource reference(s)'))
    renderModal(vacantDomain)
    fireEvent.click(screen.getByRole('button', { name: /确认删除/ }))

    await waitFor(() => expect(screen.getByText('该网域不可删除')).toBeInTheDocument())
    expect(
      screen.getByText('该网域存在资源引用（5 个），请先移除资源或改用「禁用」冻结。'),
    ).toBeInTheDocument()
    // 不直接渲染英文原文
    expect(screen.queryByText(/M07 resource reference/)).toBeNull()
    expect(successMock).not.toHaveBeenCalled()
    expect(cancelMock).not.toHaveBeenCalled()
  })

  it('resets rejected state when reopened on another domain', async () => {
    removeMock.mockRejectedValue(new Error('network domain "mc-a" still has 5 M07 resource reference(s)'))
    const { rerender } = render(
      <DeleteDomainModal open domain={vacantDomain} onCancel={cancelMock} onSuccess={successMock} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /确认删除/ }))
    await waitFor(() => expect(screen.getByText('该网域不可删除')).toBeInTheDocument())

    // 关闭后重开另一域
    rerender(<DeleteDomainModal open={false} domain={null} onCancel={cancelMock} onSuccess={successMock} />)
    rerender(<DeleteDomainModal open domain={monitoredDomain} onCancel={cancelMock} onSuccess={successMock} />)

    await waitFor(() => expect(screen.queryByText('该网域不可删除')).toBeNull())
    expect(screen.getByText(/请输入网域名称/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /确认删除/ })).toBeDisabled()
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
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { setupAntdTest } from '../../../test/antdTestUtils'
import { NetworkDomainDetailDrawer } from './NetworkDomainDetailDrawer'
import type { NetworkDomain } from '../../../types/config-center'

const domainRow = (id: string, name: string, extra: Partial<NetworkDomain> = {}): NetworkDomain => ({
  id,
  name,
  domain_type: 'edge',
  tenant_id: 'platform_admin',
  channel: 'agent_pull',
  is_monitored: false,
  created_at: '2026-08-21T00:00:00Z',
  updated_at: '2026-08-21T00:00:00Z',
  ...extra,
})

function renderDrawer(domain: NetworkDomain | null, over: Omit<Partial<Parameters<typeof NetworkDomainDetailDrawer>[0]>, 'domain'> = {}) {
  return render(
    <NetworkDomainDetailDrawer open domain={domain} onClose={() => {}} {...over} />,
  )
}

describe('NetworkDomainDetailDrawer（网域详情抽屉）', () => {
  setupAntdTest()

  it('运行态栏目标签为「采集节点在线」（与列表列一致，PRD v1.79 §3.1.1 / §11.3），不再出现旧名「运行状态」', () => {
    renderDrawer(domainRow('mc-a', '政务网A区', { is_monitored: true, monitored_status: 'normal', last_heartbeat: '2026-08-21T00:00:00Z' }))
    // 栏目标签用「采集节点在线」（Tooltip+Space 包裹产生多处文本节点，用 getAllByText）
    expect(screen.getAllByText('采集节点在线').length).toBeGreaterThanOrEqual(1)
    // 旧栏目标签「运行状态」已移除
    expect(screen.queryByText('运行状态')).not.toBeInTheDocument()
    // 运行态取值：agent_pull + monitored_status → 状态 Tag「在线」
    expect(screen.getByText('在线')).toBeInTheDocument()
  })

  it('「采集节点在线」栏目标签带粒度 Tooltip（网域粒度聚合 / 诊断见采集节点状态页）', async () => {
    renderDrawer(domainRow('mc-b', '政务云B区', { is_monitored: true, monitored_status: 'offline' }))
    // 问号图标（Tooltip 触发器）存在
    expect(screen.getByRole('img', { name: 'question-circle' })).toBeInTheDocument()
    fireEvent.mouseOver(screen.getAllByText('采集节点在线')[0])
    await waitFor(() => {
      expect(screen.getByText(/网域粒度的聚合视图/)).toBeInTheDocument()
    })
  })

  it('local（default）通道运行态恒显「-」，不误展示 agent_pull 专属字段', () => {
    renderDrawer(domainRow('default', '默认域', { channel: 'local', domain_type: 'management' }))
    expect(screen.getAllByText('采集节点在线').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(1)
  })

  it('「采集节点情况」区块：agent_pull 展示版本 / 相对心跳 / 数量占位', () => {
    renderDrawer(domainRow('mc-c', '政务网C', {
      is_monitored: true,
      monitored_status: 'normal',
      last_heartbeat: '2026-08-21T00:00:00Z',
      agent_version: 'v0.2.0',
    }))
    // 区块内标签存在
    expect(screen.getByText('采集节点版本')).toBeInTheDocument()
    expect(screen.getByText('最近心跳')).toBeInTheDocument()
    expect(screen.getByText('采集节点数量')).toBeInTheDocument()
    // 版本值
    expect(screen.getByText('v0.2.0')).toBeInTheDocument()
    // 最近心跳为相对时间（历史日期 → N 天前）
    expect(screen.getAllByText(/天前$/).length).toBeGreaterThanOrEqual(1)
    // 数量占位（'-'）+ v0.2 范围注记
    expect(screen.getAllByText('节点列表与计数为 v0.2 采集节点状态页范围').length).toBeGreaterThanOrEqual(1)
  })

  it('local 通道「采集节点情况」下版本/心跳/数量均恒「-」，不误展示 agent_pull 专属字段', () => {
    renderDrawer(domainRow('default2', '默认域', { channel: 'local', domain_type: 'management' }))
    expect(screen.getByText('采集节点版本')).toBeInTheDocument()
    expect(screen.getByText('最近心跳')).toBeInTheDocument()
    expect(screen.getByText('采集节点数量')).toBeInTheDocument()
    // 版本 + 心跳 + 数量 均为 '-'（加既有 local 运行态 '-' 共 ≥4 个）
    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(4)
  })
})

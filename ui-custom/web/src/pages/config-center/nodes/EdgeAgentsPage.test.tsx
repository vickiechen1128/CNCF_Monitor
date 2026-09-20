import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import { setupAntdTest } from '../../../test/antdTestUtils'
import { EdgeAgentsPage } from './EdgeAgentsPage'
import type { AgentView, EdgeAgentsSummary } from '../../../types/edge'
import type { NetworkDomain } from '../../../types/config-center'
import type { UseEdgeAgentsResult } from './useEdgeAgents'

const useEdgeAgentsMock = vi.fn()

vi.mock('./useEdgeAgents', () => ({
  useEdgeAgents: (...a: unknown[]) => useEdgeAgentsMock(...a),
}))

vi.mock('./EdgeAgentDrawer', () => ({
  EdgeAgentDrawer: ({ open, agent }: { open: boolean; agent: AgentView | null }) =>
    open && agent ? <div>mock-agent-drawer-{agent.hostname}</div> : null,
}))

const navigateMock = vi.fn()
const searchParamsMock = vi.fn<[], URLSearchParams>()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    // MemoryRouter 保持真实实现以提供 Router context（MainLayout 依赖 useLocation）；
    // 仅桩替换导航与查询参数，验证跳转与深链透传。
    useNavigate: () => navigateMock,
    useSearchParams: () => [searchParamsMock(), vi.fn()],
  }
})

function mockSearchParams(sp: URLSearchParams) {
  searchParamsMock.mockReturnValue(sp)
}
const agentRow = (id: number, hostname: string, extra: AgentRowOver = {}): AgentView => ({
  id,
  network_domain_id: 'gov-cloud-a',
  hostname,
  ip: '10.0.2.15',
  agent_type: 'vmagent',
  version: 'v1.2.0',
  status: 'online',
  last_heartbeat: '2026-09-20T08:00:00Z',
  heartbeat_rtt_ms: 45,
  queue_backlog_bytes: 1048576,
  collector_status: 'running',
  collector_version: 'v1.101.0',
  config_sync_status: 'in_sync',
  components: [{ type: 'collector', name: 'vmagent', status: 'running', version: 'v1.101.0' }],
  ...extra,
})

const domain = (id: string, channel: 'local' | 'agent_pull' = 'agent_pull'): NetworkDomain =>
  ({ id, name: id, domain_type: 'edge', tenant_id: 't', channel, is_monitored: true }) as NetworkDomain

function result(over: Partial<UseEdgeAgentsResult> = {}): UseEdgeAgentsResult {
  return {
    agents: [],
    rawAgents: [],
    summary: null,
    loading: false,
    error: null,
    domains: [],
    filters: {},
    setFilters: vi.fn(),
    resetFilters: vi.fn(),
    hasActiveFilter: false,
    reload: vi.fn(),
    ...over,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <EdgeAgentsPage />
    </MemoryRouter>,
  )
}

describe('EdgeAgentsPage（采集节点状态）', () => {
  setupAntdTest()

  beforeEach(() => {
    useEdgeAgentsMock.mockReset()
    navigateMock.mockReset()
    mockSearchParams(new URLSearchParams())
  })

  it('渲染标题与三档聚合统计（正常/部分异常/离线/总数）', async () => {
    const agents: AgentView[] = [
      agentRow(1, 'edge01'),
      agentRow(2, 'edge02', { status: 'online' }),
    ]
    const summary: EdgeAgentsSummary = { total: 2, online: 1, partial: 1, offline: 0 }
    useEdgeAgentsMock.mockReturnValue(result({ agents, rawAgents: agents, summary }))
    renderPage()

    expect(await screen.findByText('采集节点状态')).toBeInTheDocument()
    expect(screen.getByText('正常')).toBeInTheDocument()
    // 部分异常 同时出现在顶部统计卡与表格行状态 Badge 中，允许多处
    expect(screen.getAllByText('部分异常').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('离线')).toBeInTheDocument()
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1)
  })

  it('表格渲染节点：hostname + ip + 回传积压格式化（KB）', async () => {
    const agents: AgentView[] = [agentRow(1, 'edge01')]
    useEdgeAgentsMock.mockReturnValue(result({ agents, rawAgents: agents, summary: { total: 1, online: 1, partial: 0, offline: 0 } }))
    renderPage()

    expect(await screen.findByText('edge01')).toBeInTheDocument()
    expect(screen.getByText('10.0.2.15')).toBeInTheDocument()
    // 回传积压：1048576 B → 1.0 MB
    expect(screen.getByText('1.0 MB')).toBeInTheDocument()
    // 配置同步 in_sync 文案
    expect(screen.getAllByText('已同步').length).toBeGreaterThanOrEqual(1)
  })

  it('out_of_sync + pending_draft 成因给出「前往配置确认」引导按钮（跳转 /config-preview）', async () => {
    const agents: AgentView[] = [
      agentRow(1, 'edge01', { status: 'online', config_sync_status: 'out_of_sync', out_of_sync_cause: 'pending_draft' }),
    ]
    useEdgeAgentsMock.mockReturnValue(result({ agents, rawAgents: agents, summary: { total: 1, online: 0, partial: 1, offline: 0 } }))
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /前往配置确认/ }))
    expect(navigateMock).toHaveBeenCalledWith('/config-preview')
  })

  it('点击「查看」打开详情抽屉', async () => {
    const agents: AgentView[] = [agentRow(1, 'edge01')]
    useEdgeAgentsMock.mockReturnValue(result({ agents, rawAgents: agents, summary: { total: 1, online: 1, partial: 0, offline: 0 } }))
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /查看/ }))
    expect(await screen.findByText('mock-agent-drawer-edge01')).toBeInTheDocument()
  })

  it('筛选交互：已启用筛选时显示预筛 Alert，点击「退出筛选」调 resetFilters', async () => {
    const agents: AgentView[] = [agentRow(1, 'edge01')]
    const resetFilters = vi.fn()
    useEdgeAgentsMock.mockReturnValue(
      result({
        agents,
        rawAgents: agents,
        summary: { total: 1, online: 1, partial: 0, offline: 0 },
        domains: [domain('gov-cloud-a')],
        filters: { network_domain_id: 'gov-cloud-a', overall: 'online' },
        hasActiveFilter: true,
        resetFilters,
      }),
    )
    renderPage()

    expect(await screen.findByText(/已按网域「gov-cloud-a」预筛/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /退出筛选/ }))
    expect(resetFilters).toHaveBeenCalledTimes(1)
  })

  it('空态三支：中心直连域（无 agent_pull 网域）提示无需 Agent', async () => {
    useEdgeAgentsMock.mockReturnValue(
      result({ rawAgents: [], agents: [], domains: [domain('default', 'local')], summary: null }),
    )
    renderPage()

    expect(await screen.findByText('暂无 agent_pull 网域（中心直连域）')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /去网域纳管/ })).toBeInTheDocument()
  })

  it('空态三支：暂无采集节点（有 agent_pull 网域）引导去网域纳管', async () => {
    useEdgeAgentsMock.mockReturnValue(
      result({ rawAgents: [], agents: [], domains: [domain('gov-cloud-a')], summary: null }),
    )
    renderPage()

    expect(await screen.findByText('尚未接入采集节点')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /去网域纳管/ }))
    expect(navigateMock).toHaveBeenCalledWith('/domain-onboarding')
  })

  it('空态三支：筛选后无匹配显示「无匹配」', async () => {
    useEdgeAgentsMock.mockReturnValue(
      result({ rawAgents: [agentRow(1, 'edge01')], agents: [], domains: [domain('gov-cloud-a')], hasActiveFilter: true, filters: { overall: 'offline' } }),
    )
    renderPage()

    expect(await screen.findByText('无匹配的采集节点')).toBeInTheDocument()
  })

  it('接口错误：显示 Alert 且重新加载触发 reload', async () => {
    const res = result({ error: 'boom' })
    useEdgeAgentsMock.mockReturnValue(res)
    renderPage()

    expect(await screen.findByText('采集节点列表加载失败，请稍后重试')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重新加载/ }))
    expect(res.reload).toHaveBeenCalledTimes(1)
  })

  it('深链预筛：?network_domain=<id> 透传给 useEdgeAgents', async () => {
    useEdgeAgentsMock.mockReturnValue(result())
    mockSearchParams(new URLSearchParams('network_domain=gov-cloud-a'))
    renderPage()

    await screen.findByText('暂无 agent_pull 网域（中心直连域）')
    expect(useEdgeAgentsMock).toHaveBeenCalledWith('gov-cloud-a')
  })
})
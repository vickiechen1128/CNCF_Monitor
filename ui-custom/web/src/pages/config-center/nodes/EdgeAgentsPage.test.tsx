import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

// F-42：getStoredUser 控制重启入口可见性（admin-only）；edgeAgentsApi.restart 控制下发断言
const getStoredUserMock = vi.fn()
vi.mock('../../../api/client', () => ({
  getStoredUser: (...a: unknown[]) => getStoredUserMock(...a),
}))
const restartMock = vi.fn()
const flushBacklogMock = vi.fn()
vi.mock('../../../api/edgeAgents', () => ({
  edgeAgentsApi: {
    restart: (...a: unknown[]) => restartMock(...a),
    flushBacklog: (...a: unknown[]) => flushBacklogMock(...a),
  },
}))

const navigateMock = vi.fn()
// vitest 2.x 的 vi.fn 只接受**一个**类型参数（函数签名本身），不是 v1 的 <TArgs, TReturn>
const searchParamsMock = vi.fn<() => URLSearchParams>()
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

type AgentRowOver = Partial<AgentView>

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
    getStoredUserMock.mockReset()
    restartMock.mockReset()
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

  it('积压数据龄列：有差分依据展示时长+增速 Tooltip，无数据展示占位（F-40 延展①）', async () => {
    const agents: AgentView[] = [
      agentRow(1, 'edge01', { backlog_age_seconds: 90 * 60, backlog_growth_bytes_per_sec: 2048 }),
      agentRow(2, 'edge02', { backlog_age_seconds: 45, backlog_growth_bytes_per_sec: -100 }),
      agentRow(3, 'edge03', {}), // 无差分依据 → '-'
    ]
    useEdgeAgentsMock.mockReturnValue(result({ agents, rawAgents: agents, summary: { total: 3, online: 3, partial: 0, offline: 0 } }))
    renderPage()

    expect(await screen.findByText('edge01')).toBeInTheDocument()
    expect(screen.getByText('1 小时 30 分钟')).toBeInTheDocument()
    expect(screen.getByText('<1 分钟')).toBeInTheDocument()
    // 无数据档（其余列也可能有 '-'，放宽断言）
    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(1)
    // 增速经 Tooltip 呈现（正增长 +2.0 KB/s）
    fireEvent.mouseEnter(screen.getByText('1 小时 30 分钟'))
    expect(await screen.findByText(/近期积压增速：\+2\.0 KB\/s/)).toBeInTheDocument()
  })

  it('积压上涨且错误持续时回传积压列展示「通道异常」error Badge（F-40 延展③）', async () => {
    const agents: AgentView[] = [
      agentRow(1, 'edge01', { channel_status: 'abnormal' }),
      agentRow(2, 'edge02', {}), // 无通道态 → 不渲染 Badge
    ]
    useEdgeAgentsMock.mockReturnValue(result({ agents, rawAgents: agents, summary: { total: 2, online: 2, partial: 0, offline: 0 } }))
    renderPage()

    const badge = await screen.findByText('通道异常')
    expect(badge).toBeInTheDocument()
    expect(badge.closest('.ant-badge')?.querySelector('.ant-badge-status-error')).not.toBeNull()
    // 瞬时/正常态不渲染通道异常文案
    expect(screen.getAllByText('通道异常')).toHaveLength(1)
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

  it('配置同步 out_of_sync + pull_pending 展示「同步中」中间态（F-16）', async () => {
    const agents: AgentView[] = [
      agentRow(1, 'edge01', { config_sync_status: 'out_of_sync', out_of_sync_cause: 'pull_pending' }),
    ]
    useEdgeAgentsMock.mockReturnValue(result({ agents, rawAgents: agents, summary: { total: 1, online: 1, partial: 0, offline: 0 } }))
    renderPage()

    const badge = await screen.findByText('同步中')
    expect(badge).toBeInTheDocument()
    // 与「未同步」区分：badge 用 processing（蓝），不落 error（红）
    expect(badge.closest('.ant-badge')?.querySelector('.ant-badge-status-processing')).not.toBeNull()
    expect(screen.queryByText('未同步')).toBeNull()
    // 引导动作仍为「查看下发」
    fireEvent.click(screen.getByRole('button', { name: /查看下发/ }))
    expect(navigateMock).toHaveBeenCalledWith('/deployments')
  })

  it('配置同步 out_of_sync + pending_draft 仍展示「未同步」（非 pull_pending 不落「同步中」）', async () => {
    const agents: AgentView[] = [
      agentRow(1, 'edge01', { config_sync_status: 'out_of_sync', out_of_sync_cause: 'pending_draft' }),
    ]
    useEdgeAgentsMock.mockReturnValue(result({ agents, rawAgents: agents, summary: { total: 1, online: 0, partial: 1, offline: 0 } }))
    renderPage()

    const badge = await screen.findByText('未同步')
    expect(badge).toBeInTheDocument()
    expect(badge.closest('.ant-badge')?.querySelector('.ant-badge-status-error')).not.toBeNull()
    expect(screen.queryByText('同步中')).toBeNull()
  })

  it('配置同步 out_of_sync + apply_failed：展示「同步失败」+ error，不误判「同步中」（D-2）', async () => {
    const agents: AgentView[] = [
      agentRow(1, 'edge01', {
        status: 'online',
        config_sync_status: 'out_of_sync',
        out_of_sync_cause: 'apply_failed',
        config_apply_error: 'deployer: targets app.json: empty array',
        config_apply_failed_version: '20260924-100000',
      }),
    ]
    useEdgeAgentsMock.mockReturnValue(result({ agents, rawAgents: agents, summary: { total: 1, online: 1, partial: 0, offline: 0 } }))
    renderPage()

    const badge = await screen.findByText('同步失败')
    expect(badge).toBeInTheDocument()
    expect(badge.closest('.ant-badge')?.querySelector('.ant-badge-status-error')).not.toBeNull()
    // 反例：绝不能误判为「同步中」（processing）
    expect(badge.closest('.ant-badge')?.querySelector('.ant-badge-status-processing')).toBeNull()
    expect(screen.queryByText('同步中')).toBeNull()
    // 引导动作「查看下发」→ /deployments
    fireEvent.click(screen.getByRole('button', { name: /查看下发/ }))
    expect(navigateMock).toHaveBeenCalledWith('/deployments')
    // 失败原因以 Tooltip 呈现（列内不直接展示全文，避免窄列撑爆）
    fireEvent.mouseEnter(badge)
    expect(await screen.findByText(/targets app.json: empty array/)).toBeInTheDocument()
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

  it('F-42：admin 经「更多 → 重启采集进程」二次确认后下发重启指令', async () => {
    const agents: AgentView[] = [agentRow(1, 'edge01')]
    const reload = vi.fn()
    useEdgeAgentsMock.mockReturnValue(
      result({ agents, rawAgents: agents, summary: { total: 1, online: 1, partial: 0, offline: 0 }, reload }),
    )
    getStoredUserMock.mockReturnValue({ role: 'admin' })
    restartMock.mockResolvedValue({})
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /更多/ }))
    fireEvent.click(await screen.findByText('重启采集进程'))
    // 二次确认弹窗：明确告知仅重启 vmagent 子进程、队列数据不丢、约 30s 生效
    expect(await screen.findByText(/确定要重启节点「edge01」的采集进程/)).toBeInTheDocument()
    expect(await screen.findByText(/仅滚动重启 vmagent 采集子进程/)).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /确认重启/ }))
    await waitFor(() => expect(restartMock).toHaveBeenCalledWith(1))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('F-42：离线节点重启菜单项禁用，点击不下发指令', async () => {
    const agents: AgentView[] = [agentRow(1, 'edge01', { status: 'offline' })]
    useEdgeAgentsMock.mockReturnValue(
      result({ agents, rawAgents: agents, summary: { total: 1, online: 0, partial: 0, offline: 1 } }),
    )
    getStoredUserMock.mockReturnValue({ role: 'admin' })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /更多/ }))
    // 注意：前置测试的 Modal.confirm 标题可能异步残留在 body，按 li 内菜单项过滤
    const items = await screen.findAllByText('重启采集进程')
    const item = items.find((el) => el.closest('li'))!
    expect(item.closest('li')?.className).toContain('ant-dropdown-menu-item-disabled')
    // 计数断言（而非 toBeNull）：前置测试的 Modal.confirm Portal 可能异步残留在 body
    const modalCountBefore = screen.queryAllByText(/确定要重启节点/).length
    fireEvent.click(item)
    expect(screen.queryAllByText(/确定要重启节点/).length).toBe(modalCountBefore)
    expect(restartMock).not.toHaveBeenCalled()
  })

  it('F-42：非 admin 不展示「更多」重启入口（后端 RequireAdmin 兜底）', async () => {
    const agents: AgentView[] = [agentRow(1, 'edge01')]
    useEdgeAgentsMock.mockReturnValue(
      result({ agents, rawAgents: agents, summary: { total: 1, online: 1, partial: 0, offline: 0 } }),
    )
    getStoredUserMock.mockReturnValue({ role: 'user' })
    renderPage()

    expect(await screen.findByText('edge01')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /更多/ })).toBeNull()
  })

  it('F-43：admin 经「更多 → 清空回传积压」二次确认（红色破坏性警示）后下发清空指令', async () => {
    const agents: AgentView[] = [agentRow(2, 'edge02', { queue_backlog_bytes: 3637 * 1024 * 1024 })]
    const reload = vi.fn()
    useEdgeAgentsMock.mockReturnValue(
      result({ agents, rawAgents: agents, summary: { total: 1, online: 1, partial: 0, offline: 0 }, reload }),
    )
    getStoredUserMock.mockReturnValue({ role: 'admin' })
    flushBacklogMock.mockResolvedValue({})
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /更多/ }))
    fireEvent.click(await screen.findByText('清空回传积压'))
    // 二次确认弹窗：红色「永久丢弃」警示 + 展示当前积压量（GB）+ 危险按钮
    expect(await screen.findByText(/确定要清空节点「edge02」的回传积压/)).toBeInTheDocument()
    expect(await screen.findByText(/队列内全部积压数据将被永久丢弃/)).toBeInTheDocument()
    const okBtn = await screen.findByRole('button', { name: /确认清空（数据丢弃）/ })
    expect(okBtn.className).toContain('danger')
    fireEvent.click(okBtn)
    await waitFor(() => expect(flushBacklogMock).toHaveBeenCalledWith(2))
    expect(reload).toHaveBeenCalledTimes(1)
    expect(restartMock).not.toHaveBeenCalled()
  })

  it('F-43：离线节点清空积压菜单项禁用（破坏性操作仅限在线节点）', async () => {
    const agents: AgentView[] = [agentRow(3, 'edge03', { status: 'offline' })]
    useEdgeAgentsMock.mockReturnValue(
      result({ agents, rawAgents: agents, summary: { total: 1, online: 0, partial: 0, offline: 1 } }),
    )
    getStoredUserMock.mockReturnValue({ role: 'admin' })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /更多/ }))
    // 注意：前置测试的 Modal.confirm 标题可能异步残留在 body，按 li 内菜单项过滤
    const items = await screen.findAllByText('清空回传积压')
    const item = items.find((el) => el.closest('li'))!
    expect(item.closest('li')?.className).toContain('ant-dropdown-menu-item-disabled')
    // 计数断言（而非 toBeNull）：前置测试的 Modal.confirm Portal 可能异步残留在 body
    const modalCountBeforeFlush = screen.queryAllByText(/确定要清空节点/).length
    fireEvent.click(item)
    expect(screen.queryAllByText(/确定要清空节点/).length).toBe(modalCountBeforeFlush)
    expect(flushBacklogMock).not.toHaveBeenCalled()
  })
})
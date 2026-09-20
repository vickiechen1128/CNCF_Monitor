import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { message } from 'antd'
import { setupAntdTest } from '../../../test/antdTestUtils'
import { EdgeAgentDrawer } from './EdgeAgentDrawer'
import type { AgentView } from '../../../types/edge'

const listPackagesMock = vi.fn()
vi.mock('../../../api/edgePackages', () => ({
  edgePackageApi: {
    list: () => listPackagesMock(),
  },
}))

const navigateMock = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}))

const baseAgent = (over: Partial<AgentView> = {}): AgentView => ({
  id: 1,
  network_domain_id: 'gov-cloud-a',
  hostname: 'edge01',
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
  components: [
    { type: 'collector', name: 'vmagent', status: 'running', version: 'v1.101.0', config_version: 'cfg-1' },
    { type: 'blackbox_exporter', name: 'blackbox', status: 'not_deployed', version: 'v0.26.0' },
  ],
  ...over,
})

function renderDrawer(agent: AgentView, open = true) {
  return render(<EdgeAgentDrawer open={open} agent={agent} onClose={mockOnClose} />)
}
const mockOnClose = vi.fn()

describe('EdgeAgentDrawer（节点详情抽屉）', () => {
  setupAntdTest()

  beforeEach(() => {
    navigateMock.mockReset()
    mockOnClose.mockReset()
    listPackagesMock.mockReset()
    vi.spyOn(message, 'success').mockImplementation(() => undefined)
    vi.spyOn(message, 'error').mockImplementation(() => undefined)
  })

  it('渲染节点概览 + 组件清单（类型/状态/版本/配置版本）', async () => {
    listPackagesMock.mockResolvedValue({ status: 'success', data: { packages: [] } })
    renderDrawer(baseAgent())

    expect(screen.getByText('edge01')).toBeInTheDocument()
    expect(screen.getByText('gov-cloud-a')).toBeInTheDocument()
    // 组件名 vmagent 以「指标采集器（vmagent）」形式嵌套于类型单元格
    expect(screen.getAllByText(/vmagent/).length).toBeGreaterThanOrEqual(1)
    // blackbox not_deployed 标签
    expect(screen.getByText('未部署')).toBeInTheDocument()
  })

  it('高危组件（crash_loop）渲染顶部高危横幅', async () => {
    listPackagesMock.mockResolvedValue({ status: 'success', data: { packages: [] } })
    renderDrawer(
      baseAgent({ components: [{ type: 'collector', name: 'vmagent', status: 'crash_loop', version: 'v1.101.0' }] }),
    )

    expect(screen.getByText(/检测到高风险组件状态/)).toBeInTheDocument()
    // 崩溃回环 文案出现在高危横幅与组件清单状态 Tag 中，允许多处
    expect(screen.getAllByText(/崩溃回环/).length).toBeGreaterThanOrEqual(1)
  })

  it('配置同步 out_of_sync + pending_draft：显示引导按钮并跳转 /config-preview', async () => {
    listPackagesMock.mockResolvedValue({ status: 'success', data: { packages: [] } })
    renderDrawer(
      baseAgent({
        status: 'partial',
        config_sync_status: 'out_of_sync',
        out_of_sync_cause: 'pending_draft',
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: /前往配置确认/ }))
    expect(navigateMock).toHaveBeenCalledWith('/config-preview')
  })

  it('配置同步 out_of_sync + local_reset：点「重新同步」走消息而非跳转', async () => {
    listPackagesMock.mockResolvedValue({ status: 'success', data: { packages: [] } })
    renderDrawer(
      baseAgent({ status: 'partial', config_sync_status: 'out_of_sync', out_of_sync_cause: 'local_reset' }),
    )

    fireEvent.click(screen.getByRole('button', { name: /重新同步/ }))
    expect(message.success).toHaveBeenCalled()
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('collector_version 低于离线包 latest 版本时显示「可升级」', async () => {
    listPackagesMock.mockResolvedValue({
      status: 'success',
      data: { packages: [{ version: 'v1.200.0' }] },
    })
    renderDrawer(baseAgent({ collector_version: 'v1.101.0' }))

    expect(await screen.findByText('可升级')).toBeInTheDocument()
  })

  it('已是最新版本时不显示「可升级」', async () => {
    listPackagesMock.mockResolvedValue({
      status: 'success',
      data: { packages: [{ version: 'v1.101.0' }] },
    })
    renderDrawer(baseAgent({ collector_version: 'v1.101.0' }))

    await waitFor(() => expect(screen.queryByText('可升级')).toBeNull())
  })
})
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NetworkDomainsPage } from './NetworkDomainsPage'
import type { NetworkDomain } from '../../../types/config-center'

const useNetworkDomainsMock = vi.fn()
const monitorApiMock = vi.fn()

vi.mock('./useNetworkDomains', () => ({
  useNetworkDomains: (...a: unknown[]) => useNetworkDomainsMock(...a),
}))

vi.mock('../../../api/configCenter', () => ({
  networkDomainMonitorApi: { monitor: (...a: unknown[]) => monitorApiMock(...a) },
}))

/** 采集详情/纳管渲染逻辑已在各自组件单测覆盖，页面测试仅需轻量桩验证挂载与主流程 */
vi.mock('./NetworkDomainDetailDrawer', () => ({
  NetworkDomainDetailDrawer: () => null,
}))

// 桩代替真实 Drawer 表单，暴露一个触发 onSubmit 的按钮，用于验证「纳管→提交」主流程
vi.mock('./OnboardDomainDrawer', () => ({
  OnboardDomainDrawer: ({ open, onSubmit, onClose }: { open?: boolean; onSubmit?: (i: unknown) => Promise<void>; onClose?: () => void }) => {
    if (!open) return null
    return (
      <button
        onClick={() => {
          void onSubmit?.({ agent_type: 'vmagent' })
          onClose?.()
        }}
      >
        mock-confirm-onboard
      </button>
    )
  },
}))

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

function result(over: Record<string, unknown> = {}) {
  return {
    data: { items: [] as NetworkDomain[], total: 0 },
    loading: false,
    error: null,
    permissionDenied: false,
    filters: {},
    setFilters: vi.fn(),
    page: 1,
    pageSize: 20,
    onPageSizeChange: vi.fn(),
    reload: vi.fn(),
    ...over,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <NetworkDomainsPage />
    </MemoryRouter>,
  )
}

describe('NetworkDomainsPage（网域纳管）', () => {
  beforeEach(() => {
    useNetworkDomainsMock.mockReset()
    monitorApiMock.mockReset()
    monitorApiMock.mockResolvedValue({ status: 'success', data: null })
  })

  it('加载中显示 spinner', () => {
    useNetworkDomainsMock.mockReturnValue(result({ loading: true }))
    const { container } = renderPage()
    expect(container.querySelector('.ant-spin')).toBeTruthy()
  })

  it('成功渲染网域行：名称+ID、下发通道 local/agent_pull', async () => {
    useNetworkDomainsMock.mockReturnValue(
      result({
        data: {
          items: [
            domainRow('default', '默认域', { channel: 'local', domain_type: 'management' }),
            domainRow('mc-a', '政务网A区', { zone_type: 'internet' }),
          ],
          total: 2,
        },
      }),
    )
    renderPage()
    expect(await screen.findByText('默认域')).toBeInTheDocument()
    expect(screen.getByText('mc-a')).toBeInTheDocument()
    expect(screen.getByText('internet')).toBeInTheDocument()
    // local 通道行不展示 agent_pull 专属字段（运行状态/凭据恒 '-'）
    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(2)
  })

  it('空态：无网域时给出「先去网域管理登记」引导', async () => {
    useNetworkDomainsMock.mockReturnValue(result())
    renderPage()
    expect(await screen.findByText(/暂无网域/)).toBeInTheDocument()
  })

  it('接口错误：显示 Alert 且重新加载触发 reload', async () => {
    const res = result({ error: 'boom' })
    useNetworkDomainsMock.mockReturnValue(res)
    renderPage()
    expect(await screen.findByText('网域纳管列表加载失败，请稍后重试')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重新加载/ }))
    expect(res.reload).toHaveBeenCalledTimes(1)
  })

  it('权限不足：显示权限不足空态', async () => {
    useNetworkDomainsMock.mockReturnValue(result({ permissionDenied: true }))
    renderPage()
    expect(await screen.findByText('当前账号无此页面查看权限')).toBeInTheDocument()
  })

  it('纳管状态切换操作：已纳管显「编辑」，未纳管显「纳管」', async () => {
    useNetworkDomainsMock.mockReturnValue(
      result({
        data: {
          items: [
            domainRow('default', '默认域', { channel: 'local', domain_type: 'management' }),
            domainRow('mc-b', '医院专网', { is_monitored: true, channel: 'agent_pull' }),
          ],
          total: 2,
        },
      }),
    )
    renderPage()
    expect(await screen.findByText('医院专网')).toBeInTheDocument()
    // default(local, 未纳管) → 纳管；mc-b(已纳管) → 编辑
    expect(screen.getAllByRole('button', { name: /纳管/ }).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: /编辑/ })).toBeInTheDocument()
  })

  it('仅 agent_pull 已纳管行展示「更多/重置 Token」', async () => {
    useNetworkDomainsMock.mockReturnValue(
      result({
        data: {
          items: [domainRow('mc-c', '核心生产网', { is_monitored: true, channel: 'agent_pull' })],
          total: 1,
        },
      }),
    )
    renderPage()
    expect(await screen.findByText('核心生产网')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /更多/ })).toBeInTheDocument()
  })

  it('行内「纳管」→ 提交调用 monitor API（入口单一化）', async () => {
    useNetworkDomainsMock.mockReturnValue(
      result({
        data: { items: [domainRow('mc-d', '金融专网')], total: 1 },
      }),
    )
    renderPage()
    const onboardBtn = await screen.findByRole('button', { name: /纳管/ })
    fireEvent.click(onboardBtn)
    const confirmBtn = await screen.findByRole('button', { name: /mock-confirm-onboard/ })
    fireEvent.click(confirmBtn)
    expect(monitorApiMock).toHaveBeenCalledWith('mc-d', expect.objectContaining({ agent_type: 'vmagent' }))
  })
})
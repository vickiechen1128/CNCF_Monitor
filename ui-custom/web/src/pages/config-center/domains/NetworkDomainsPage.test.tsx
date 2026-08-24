import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setupAntdTest, mockAntdModal } from '../../../test/antdTestUtils'
import { NetworkDomainsPage } from './NetworkDomainsPage'
import type { NetworkDomain } from '../../../types/config-center'

const useNetworkDomainsMock = vi.fn()
const monitorApiMock = vi.fn()
const resetTokenApiMock = vi.fn()

vi.mock('./useNetworkDomains', () => ({
  useNetworkDomains: (...a: unknown[]) => useNetworkDomainsMock(...a),
}))

vi.mock('../../../api/configCenter', () => ({
  networkDomainMonitorApi: {
    monitor: (...a: unknown[]) => monitorApiMock(...a),
    resetToken: (...a: unknown[]) => resetTokenApiMock(...a),
  },
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

/** 与 configCenterConstants.TOKEN_MASK 对齐的掩码常量，用于断言脱敏展示 */
const TOKEN_MASK_CHARS = '••••••••'

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
  setupAntdTest()

  beforeEach(() => {
    useNetworkDomainsMock.mockReset()
    monitorApiMock.mockReset()
    monitorApiMock.mockResolvedValue({ status: 'success', data: null })
    resetTokenApiMock.mockReset()
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

  it('HIGH-1 凭据列仅展示脱敏串，不提供「复制明文」按钮（list 不返回明文 token）', async () => {
    useNetworkDomainsMock.mockReturnValue(
      result({
        data: {
          items: [domainRow('mc-h', '医保网', { is_monitored: true, token_masked: TOKEN_MASK_CHARS })],
          total: 1,
        },
      }),
    )
    renderPage()
    expect(await screen.findByText('医保网')).toBeInTheDocument()
    // 脱敏串展示
    expect(screen.getAllByText('••••••••').length).toBeGreaterThanOrEqual(1)
    // 列表行不渲染复制入口
    expect(screen.queryByRole('button', { name: /复制/i })).not.toBeInTheDocument()
  })

  it('MEDIUM-1 纳管 agent_pull 域成功后弹一次性明文 Token 展示', async () => {
    useNetworkDomainsMock.mockReturnValue(
      result({ data: { items: [domainRow('mc-e', '政务云B区', { channel: 'agent_pull' })], total: 1 } }),
    )
    monitorApiMock.mockResolvedValue({
      status: 'success',
      data: { ...domainRow('mc-e', '政务云B区', { channel: 'agent_pull' }), is_monitored: true, token: 'plain-abc', token_masked: TOKEN_MASK_CHARS },
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /纳管/ }))
    fireEvent.click(await screen.findByRole('button', { name: /mock-confirm-onboard/ }))
    expect(await screen.findByText('plain-abc')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /复制明文/ })).toBeInTheDocument()
  })

  it('MEDIUM-1 default(local) 域纳管成功不弹明文 Token', async () => {
    useNetworkDomainsMock.mockReturnValue(
      result({
        data: { items: [domainRow('default', '默认域', { channel: 'local', domain_type: 'management' })], total: 1 },
      }),
    )
    monitorApiMock.mockResolvedValue({
      status: 'success',
      data: { ...domainRow('default', '默认域', { channel: 'local', domain_type: 'management' }), is_monitored: true },
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /纳管/ }))
    fireEvent.click(await screen.findByRole('button', { name: /mock-confirm-onboard/ }))
    expect(monitorApiMock).toHaveBeenCalled()
    // 无明文 token → 不弹展示 Modal
    expect(screen.queryByRole('button', { name: /复制明文/ })).not.toBeInTheDocument()
  })

  it('LOW-1 重置 Token 成功弹一次性明文 Modal 而非 toast 暴露明文', async () => {
    useNetworkDomainsMock.mockReturnValue(
      result({
        data: { items: [domainRow('mc-r', '核心生产网', { is_monitored: true, channel: 'agent_pull' })], total: 1 },
      }),
    )
    resetTokenApiMock.mockResolvedValue({
      status: 'success',
      data: { token: 'new-plain-token', token_masked: TOKEN_MASK_CHARS },
    })
    const modal = mockAntdModal()
    renderPage()
    const moreBtn = await screen.findByRole('button', { name: /更多/ })
    // Dropdown 默认 hover 触发：用 mouseOver 模拟 onMouseEnter 展开菜单
    fireEvent.mouseOver(moreBtn)
    const menuItem = await screen.findByText('重置 Token')
    fireEvent.click(menuItem)
    expect(modal.confirm).toHaveBeenCalled()
    const onOk = modal.confirm.mock.calls[0][0].onOk as () => Promise<void>
    await onOk()
    expect(resetTokenApiMock).toHaveBeenCalledWith('mc-r')
    // 明文在一次性 Modal 展示而非常驻 toast
    expect(await screen.findByText('new-plain-token')).toBeInTheDocument()
  })
})
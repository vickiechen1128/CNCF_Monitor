import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setupAntdTest, mockAntdModal } from '../../../test/antdTestUtils'
import { ConfigPreviewPage } from './ConfigPreviewPage'
import type { ConfigDraft } from '../../../types/config-center'

/**
 * 决策 60 端到端冒烟（T09-60-F2）：M08 告警配置挂载 alertmanager.yml → M09 管理域(default)变更单
 * → /config-preview 确认（含告警配置变更单提示 + alertmanager.yml 预览 Tab）→ confirm 下发。
 * M08 applied 前台一致性由 M08 页面（已由另一前端子代理完成）负责，此处验证 M09 侧动线。
 */
const useConfigDraftsMock = vi.fn()
const fetchMonitoredDomainsMock = vi.fn()
const draftApiMock = {
  list: vi.fn(),
  get: vi.fn(),
  confirm: vi.fn(),
  discard: vi.fn(),
  revalidate: vi.fn(),
  discardImpact: vi.fn(),
}
const deploymentApiMock = { getConfigVersion: vi.fn() }
const reloadMock = vi.fn()
const setDomainIdMock = vi.fn()
const setStatusMock = vi.fn()

vi.mock('./useConfigDrafts', () => ({
  useConfigDrafts: (...a: unknown[]) => useConfigDraftsMock(...a),
  fetchMonitoredDomains: (...a: unknown[]) => fetchMonitoredDomainsMock(...a),
  ALL_DOMAINS_ID: '__all__',
}))
vi.mock('../../../api/configCenter', () => ({
  configDraftApi: {
    list: (...a: unknown[]) => draftApiMock.list(...a),
    get: (...a: unknown[]) => draftApiMock.get(...a),
    confirm: (...a: unknown[]) => draftApiMock.confirm(...a),
    discard: (...a: unknown[]) => draftApiMock.discard(...a),
    revalidate: (...a: unknown[]) => draftApiMock.revalidate(...a),
    discardImpact: (...a: unknown[]) => draftApiMock.discardImpact(...a),
  },
  deploymentApi: {
    getConfigVersion: (...a: unknown[]) => deploymentApiMock.getConfigVersion(...a),
  },
}))
vi.mock('antd/locale/zh_CN', () => ({ default: {} }))

/** 决策 60：管理域 default 变更单，仅告警配置（alertmanager.yml）变更（决策 44-3 抑制语义不抑制 AM 单） */
const amDraft = (over: Partial<ConfigDraft> = {}): ConfigDraft => ({
  change_no: 'CHG-20260902-001',
  network_domain_id: 'default',
  network_domain_name: '默认域',
  channel: 'local',
  status: 'pending',
  summary: '通知路由/接收人调整',
  risk: 'low',
  affected_files: ['alertmanager'],
  validation_status: 'passed',
  created_at: '2026-09-02T09:00:00Z',
  source_version: '',
  alertmanager_yml: 'route:\n  receiver: web\n',
  change_items: [
    {
      id: 'c1',
      type: 'update',
      target: 'alertmanager_config',
      description: '更新接收人通知路由',
      affected_files: ['alertmanager'],
      risk: 'low',
    },
  ],
  ...over,
})

function result(over: Record<string, unknown> = {}) {
  return {
    data: { items: [] as ConfigDraft[], total: 0 },
    loading: false,
    error: null,
    permissionDenied: false,
    domainId: undefined,
    status: 'pending',
    setDomainId: setDomainIdMock,
    setStatus: setStatusMock,
    page: 1,
    pageSize: 20,
    onPageSizeChange: vi.fn(),
    reload: reloadMock,
    ...over,
  }
}

describe('alertmanagerSmoke（决策 60 跨模块动线：M08 挂载 → M09 确认）', () => {
  setupAntdTest()

  beforeEach(() => {
    useConfigDraftsMock.mockReset()
    draftApiMock.list.mockReset()
    draftApiMock.get.mockReset()
    draftApiMock.confirm.mockReset()
    draftApiMock.discard.mockReset()
    draftApiMock.revalidate.mockReset()
    draftApiMock.discardImpact.mockReset()
    deploymentApiMock.getConfigVersion.mockReset()
    reloadMock.mockReset()
    setDomainIdMock.mockReset()
    setStatusMock.mockReset()
    fetchMonitoredDomainsMock.mockReset()
    fetchMonitoredDomainsMock.mockResolvedValue([
      { id: 'default', name: '默认域', channel: 'local', is_monitored: true },
    ])
  })

  function renderPage() {
    return render(
      <MemoryRouter>
        <ConfigPreviewPage />
      </MemoryRouter>,
    )
  }

  it('含告警配置变更单：配置预览出现 alertmanager.yml Tab + 「变更」标记，并默认聚焦首受影响文件', async () => {
    useConfigDraftsMock.mockReturnValue(result({ data: { items: [amDraft()], total: 1 } }))
    draftApiMock.get.mockResolvedValue({ status: 'success', data: amDraft() })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    fireEvent.click(await screen.findByRole('tab', { name: '配置预览' }))
    // 唯一受影响文件 alertmanager.yml 带「变更」标记
    expect(await screen.findByRole('tab', { name: /alertmanager\.yml.*变更/ })).toBeInTheDocument()
    expect(screen.getByText(/本次变更影响 1\/5 个配置文件/)).toBeInTheDocument()
  })

  it('确认发布：Modal 对含告警配置变更单低风险人工确认提示，confirm 保持变更单级', async () => {
    useConfigDraftsMock.mockReturnValue(result({ data: { items: [amDraft()], total: 1 } }))
    draftApiMock.get.mockResolvedValue({ status: 'success', data: amDraft() })
    draftApiMock.confirm.mockResolvedValue({ status: 'success', data: { id: 'cv-1' } })
    const modal = mockAntdModal()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    fireEvent.click(await screen.findByRole('button', { name: /确认发布/ }))
    expect(modal.confirm).toHaveBeenCalled()
    const callContent = modal.confirm.mock.calls[0][0].content as string
    expect(callContent).toMatch(/告警配置（alertmanager\.yml）/)
    expect(callContent).toMatch(/「告警收敛与通知管理」回写「已生效」/)
    await modal.confirm.mock.calls[0][0].onOk()
    // 确认动作保持变更单级：以 change_no 确认到来
    expect(draftApiMock.confirm).toHaveBeenCalledWith('CHG-20260902-001', expect.any(String))
    await waitFor(() => expect(reloadMock).toHaveBeenCalled())
  })

  it('不含 AM 产物的变更单不展示 alertmanager.yml Tab（条件渲染）', async () => {
    useConfigDraftsMock.mockReturnValue(result({ data: { items: [amDraft({ alertmanager_yml: undefined })], total: 1 } }))
    draftApiMock.get.mockResolvedValue({
      status: 'success',
      data: amDraft({ alertmanager_yml: undefined, affected_files: [], change_items: [] }),
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    fireEvent.click(await screen.findByRole('tab', { name: '配置预览' }))
    expect(await screen.findByRole('tab', { name: 'prometheus.yml' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'alertmanager.yml' })).not.toBeInTheDocument()
  })
})
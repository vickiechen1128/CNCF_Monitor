import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setupAntdTest, mockAntdModal } from '../../../test/antdTestUtils'
import { ConfigPreviewPage } from './ConfigPreviewPage'
import type { ConfigDraft } from '../../../types/config-center'

const useConfigDraftsMock = vi.fn()
const fetchMonitoredDomainsMock = vi.fn()
const draftApiMock = {
  list: vi.fn(),
  get: vi.fn(),
  confirm: vi.fn(),
  discard: vi.fn(),
  revalidate: vi.fn(),
}
const deploymentApiMock = {
  getConfigVersion: vi.fn(),
}
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
  },
  deploymentApi: {
    getConfigVersion: (...a: unknown[]) => deploymentApiMock.getConfigVersion(...a),
  },
}))
vi.mock('antd/locale/zh_CN', () => ({ default: {} }))

const draftRow = (over: Partial<ConfigDraft> = {}): ConfigDraft => ({
  change_no: 'CHG-20260823-001',
  network_domain_id: 'default',
  network_domain_name: '默认域',
  channel: 'local',
  status: 'pending',
  summary: '新增采集目标 app-biz-01',
  risk: 'low',
  affected_files: ['targets'],
  validation_status: 'passed',
  created_at: '2026-08-23T10:00:00Z',
  source_version: '',
  change_items: [
    { id: 'c1', type: 'add', target: 'target_instance', description: '新增采集目标', affected_files: ['targets'], risk: 'low' },
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

function renderPage() {
  return render(
    <MemoryRouter>
      <ConfigPreviewPage />
    </MemoryRouter>,
  )
}

describe('ConfigPreviewPage（配置变更确认）', () => {
  setupAntdTest()

  beforeEach(() => {
    useConfigDraftsMock.mockReset()
    draftApiMock.list.mockReset()
    draftApiMock.get.mockReset()
    draftApiMock.confirm.mockReset()
    draftApiMock.discard.mockReset()
    draftApiMock.revalidate.mockReset()
    deploymentApiMock.getConfigVersion.mockReset()
    reloadMock.mockReset()
    setDomainIdMock.mockReset()
    setStatusMock.mockReset()
    fetchMonitoredDomainsMock.mockReset()
    fetchMonitoredDomainsMock.mockResolvedValue([
      { id: 'default', name: '默认域', channel: 'local', is_monitored: true },
    ])
  })

  it('加载中提示', () => {
    useConfigDraftsMock.mockReturnValue(result({ loading: true }))
    fetchMonitoredDomainsMock.mockResolvedValue([])
    renderPage()
    expect(screen.getByText('配置变更确认')).toBeInTheDocument()
    expect(screen.getByText(/加载中/)).toBeInTheDocument()
  })

  it('渲染变更列表：变更单号 + 变更摘要 + 风险/确认人生成时间', async () => {
    useConfigDraftsMock.mockReturnValue(
      result({ data: { items: [draftRow()], total: 1 } }),
    )
    renderPage()
    expect(await screen.findByText('CHG-20260823-001')).toBeInTheDocument()
    expect(screen.getByText(/新增采集目标 app-biz-01/)).toBeInTheDocument()
    expect(screen.getByText('低风险')).toBeInTheDocument()
  })

  it('空态：无待确认变更', async () => {
    useConfigDraftsMock.mockReturnValue(result())
    renderPage()
    expect(await screen.findByText(/当前网域暂无配置变更/)).toBeInTheDocument()
  })

  it('权限不足：显示权限不足空态', async () => {
    useConfigDraftsMock.mockReturnValue(result({ permissionDenied: true }))
    renderPage()
    expect(await screen.findByText('当前账号无此页面查看权限')).toBeInTheDocument()
  })

  it('接口错误：Alert + 重新加载触发 reload', async () => {
    const res = result({ error: 'boom' })
    useConfigDraftsMock.mockReturnValue(res)
    renderPage()
    expect(await screen.findByText('配置变更列表加载失败，请稍后重试')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重新加载/ }))
    expect(res.reload).toHaveBeenCalled()
  })

  it('点击「详情」打开抽屉并加载详情', async () => {
    useConfigDraftsMock.mockReturnValue(result({ data: { items: [draftRow()], total: 1 } }))
    draftApiMock.get.mockResolvedValue({ status: 'success', data: draftRow({ change_items: [] }) })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    expect(draftApiMock.get).toHaveBeenCalledWith('CHG-20260823-001')
    expect(await screen.findByRole('tab', { name: '变更摘要' })).toBeInTheDocument()
  })

  it('确认发布：Modal 二次确认后调用 confirm 并 reload', async () => {
    useConfigDraftsMock.mockReturnValue(result({ data: { items: [draftRow()], total: 1 } }))
    draftApiMock.get.mockResolvedValue({ status: 'success', data: draftRow() })
    const modal = mockAntdModal()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    fireEvent.click(await screen.findByRole('button', { name: /确认发布/ }))
    expect(modal.confirm).toHaveBeenCalled()
    const onOk = modal.confirm.mock.calls[0][0].onOk as () => Promise<void>
    await onOk()
    expect(draftApiMock.confirm).toHaveBeenCalledWith('CHG-20260823-001', expect.any(String))
    await waitFor(() => expect(reloadMock).toHaveBeenCalled())
  })

  it('校验失败的草稿禁止确认并展示重新校验', async () => {
    useConfigDraftsMock.mockReturnValue(result({ data: { items: [draftRow()], total: 1 } }))
    draftApiMock.get.mockResolvedValue({ status: 'success', data: draftRow({ validation_status: 'failed' }) })
    draftApiMock.revalidate.mockResolvedValue({ status: 'success', data: { validation_status: 'passed' } })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    const confirmBtn = await screen.findByRole('button', { name: /确认发布/ })
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(await screen.findByRole('button', { name: /重新校验/ }))
    await waitFor(() => expect(draftApiMock.revalidate).toHaveBeenCalledWith('CHG-20260823-001'))
  })

  it('废弃变更：Modal 二次确认后调用 discard 并 reload', async () => {
    useConfigDraftsMock.mockReturnValue(result({ data: { items: [draftRow()], total: 1 } }))
    draftApiMock.get.mockResolvedValue({ status: 'success', data: draftRow() })
    const modal = mockAntdModal()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    fireEvent.click(await screen.findByRole('button', { name: /废弃变更/ }))
    expect(modal.confirm).toHaveBeenCalled()
    const onOk = modal.confirm.mock.calls[0][0].onOk as () => Promise<void>
    await onOk()
    expect(draftApiMock.discard).toHaveBeenCalledWith('CHG-20260823-001', expect.any(String))
    await waitFor(() => expect(reloadMock).toHaveBeenCalled())
  })

  it('MEDIUM-2 版本对比 Tab：有 source_version 时拉取源版本产物并做真实 diff', async () => {
    useConfigDraftsMock.mockReturnValue(result({ data: { items: [draftRow({ source_version: 'cv-1', prometheus_yml: 'a: 1' })], total: 1 } }))
    draftApiMock.get.mockResolvedValue({
      status: 'success',
      data: draftRow({ source_version: 'cv-1', prometheus_yml: 'a: 1' }),
    })
    deploymentApiMock.getConfigVersion.mockResolvedValue({
      status: 'success',
      data: { id: 'cv-1', network_domain_id: 'default', prometheus_yml: 'a: 2' },
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    await waitFor(() => expect(deploymentApiMock.getConfigVersion).toHaveBeenCalledWith('cv-1'))
    fireEvent.click(await screen.findByRole('tab', { name: '版本对比' }))
    // 源版本 prometheus.yml 为 'a: 2'，草稿为 'a: 1' → 出现 removed 'a: 2' 与 added 'a: 1'
    expect(await screen.findByText(/- a: 2/)).toBeInTheDocument()
    expect(screen.getByText(/\+ a: 1/)).toBeInTheDocument()
    // 不再把空旧文本标成 spurious removed（diff 仅真实差异行）
    expect(screen.queryByText('无历史版本可对比')).not.toBeInTheDocument()
  })

  it('MEDIUM-2 版本对比 Tab：无法拉取源版本产物时明确降级文案而非全量新增', async () => {
    useConfigDraftsMock.mockReturnValue(result({ data: { items: [draftRow({ source_version: 'cv-1', prometheus_yml: 'a: 1' })], total: 1 } }))
    draftApiMock.get.mockResolvedValue({
      status: 'success',
      data: draftRow({ source_version: 'cv-1', prometheus_yml: 'a: 1' }),
    })
    deploymentApiMock.getConfigVersion.mockRejectedValue(new Error('fetch failed'))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    await waitFor(() => expect(deploymentApiMock.getConfigVersion).toHaveBeenCalledWith('cv-1'))
    fireEvent.click(await screen.findByRole('tab', { name: '版本对比' }))
    expect(await screen.findByText('无历史版本可对比')).toBeInTheDocument()
    expect(screen.getByText(/无法拉取源版本/)).toBeInTheDocument()
  })
})
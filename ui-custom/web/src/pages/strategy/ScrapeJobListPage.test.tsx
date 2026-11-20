import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setupAntdTest, mockAntdMessage } from '../../test/antdTestUtils'
import { ScrapeJobListPage } from './ScrapeJobListPage'
import type { JobGroup } from '../../types/jobGroup'

const groupsListMock = vi.fn()
const groupsGetMock = vi.fn()
const groupsRemoveMock = vi.fn()
const adoptMock = vi.fn()
const updateGroupMock = vi.fn()
const setGroupEnabledMock = vi.fn()
const createGroupMock = vi.fn()
const schemaMock = vi.fn()
const queryCandidatesMock = vi.fn()
const candidateIdsMock = vi.fn()
const jobsListMock = vi.fn()
const jobRemoveMock = vi.fn()
const jobUpdateMock = vi.fn()
const queryMock = vi.fn()
const childGetMock = vi.fn()
const instancesMock = vi.fn()
const confirmMock = vi.fn()

vi.mock('../../api/jobGroups', () => ({
  jobGroupApi: {
    list: (...a: unknown[]) => groupsListMock(...a),
    get: (...a: unknown[]) => groupsGetMock(...a),
    remove: (...a: unknown[]) => groupsRemoveMock(...a),
    adoptFromJob: (...a: unknown[]) => adoptMock(...a),
    update: (...a: unknown[]) => updateGroupMock(...a),
    setEnabled: (...a: unknown[]) => setGroupEnabledMock(...a),
    create: (...a: unknown[]) => createGroupMock(...a),
    filterSchema: (...a: unknown[]) => schemaMock(...a),
    queryCandidates: (...a: unknown[]) => queryCandidatesMock(...a),
    candidateIds: (...a: unknown[]) => candidateIdsMock(...a),
  },
}))

vi.mock('../../api/scrapeJobs', () => ({
  scrapeJobApi: {
    list: (...a: unknown[]) => jobsListMock(...a),
    remove: (...a: unknown[]) => jobRemoveMock(...a),
    update: (...a: unknown[]) => jobUpdateMock(...a),
    create: vi.fn(),
    instances: vi.fn().mockResolvedValue({ status: 'success', data: { items: [], total: 0 } }),
    previewTargets: vi.fn().mockResolvedValue({ status: 'success', data: { targets: [], skipped: [] } }),
  },
}))

vi.mock('../../api/strategyV3', () => ({
  scrapeJobApiV3: {
    get: (...a: unknown[]) => childGetMock(...a),
    instances: (...a: unknown[]) => instancesMock(...a),
    confirmInstance: (...a: unknown[]) => confirmMock(...a),
  },
}))

vi.mock('../../api/query', () => ({
  queryApi: { query: (...a: unknown[]) => queryMock(...a) },
}))

vi.mock('./ScrapeJobFormDrawer', () => ({
  ScrapeJobFormDrawer: () => <div data-testid="job-form-drawer" />,
}))

vi.mock('../config-center/preview/triggerConfigDraft', () => ({
  triggerConfigDrafts: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./useSyncPolling', () => ({
  useSyncPolling: () => vi.fn(),
}))
vi.mock('./ScrapeJobDetailDrawer', () => ({
  ScrapeJobDetailDrawer: ({ open }: { open: boolean }) =>
    open ? <div data-testid="job-detail-drawer">detail</div> : null,
}))

const childJob = (domainID: string, domainName: string, jobID: string) => ({
  resource_id: '',
  job_group_id: 'grp-1',
  job_group_name: '主机基础采集',
  id: jobID,
  job_name: 'host-base',
  job_type: 'standard',
  resource_category: 'host',
  monitor_type: 'host_linux',
  exporter_template_id: '',
  exporter_template_name: 'node-exporter',
  network_domain_id: domainID,
  network_domain_name: domainName,
  instance_selection_mode: 'manual',
  selected_instance_ids: ['r-1'],
  selected_instance_count: 1,
  scrape_interval: '15s',
  scrape_timeout: '10s',
  metrics_path: '/metrics',
  scheme: 'http',
  auth_type: 'none',
  username: '',
  credential_configured: false,
  tls_skip_verify: false,
  ca_file: '',
  label_template_id: '',
  label_template_name: '',
  blackbox_module: '',
  target_field: '',
  mapping_overrides: [],
  draft_status: 'ready',
  enabled: true,
  sync: { status: 'synced', version: 'v1', error: '', synced_at: '2026-11-17T10:00:00Z' },
  created_at: '2026-11-17T10:00:00Z',
  updated_at: '2026-11-17T10:00:00Z',
})

const group = (over: Partial<JobGroup> = {}): JobGroup => ({
  id: 'grp-1',
  name: '主机基础采集',
  job_name: 'host-base',
  job_type: 'standard',
  resource_category: 'host',
  monitor_type: 'host_linux',
  scrape_interval: '15s',
  scrape_timeout: '10s',
  metrics_path: '/metrics',
  scheme: 'http',
  status: 'enabled',
  created_by: 'admin',
  created_at: '2026-11-17T10:00:00Z',
  updated_at: '2026-11-17T10:00:00Z',
  domains: [
    {
      network_domain_id: 'mc-a',
      network_domain_name: '域A',
      job_id: 'job-a',
      job_name: 'host-base',
      instance_count: 1,
      enabled: true,
      sync_status: 'synced',
      sync_version: 'v1',
      sync_error: '',
      synced_at: '2026-11-17T10:00:00Z',
      job: childJob('mc-a', '域A', 'job-a') as never,
    },
    {
      network_domain_id: 'mc-b',
      network_domain_name: '域B',
      job_id: 'job-b',
      job_name: 'host-base',
      instance_count: 1,
      enabled: true,
      sync_status: 'failed',
      sync_version: '',
      sync_error: 'promtool 校验失败',
      synced_at: null,
      job: childJob('mc-b', '域B', 'job-b') as never,
    },
  ],
  sync: { status: 'partial', total: 2, synced: 1, failed: 1, pending: 0, draft: 0 },
  ...over,
})

const standalone = {
  ...childJob('mc-a', '域A', 'job-standalone'),
  id: 'job-standalone',
  job_name: 'standalone-job',
  job_group_id: undefined,
  job_group_name: undefined,
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ScrapeJobListPage />
    </MemoryRouter>,
  )
}

describe('ScrapeJobListPage（统一采集任务视图）', () => {
  setupAntdTest()

  beforeEach(() => {
    groupsListMock.mockReset().mockResolvedValue({
      status: 'success',
      data: { list: [group()], total: 1, page: 1, page_size: 20 },
    })
    groupsGetMock.mockReset().mockResolvedValue({ status: 'success', data: group() })
    groupsRemoveMock.mockReset().mockResolvedValue({ status: 'success', data: {} })
    adoptMock.mockReset().mockResolvedValue({ status: 'success', data: group() })
    updateGroupMock.mockReset().mockResolvedValue({ status: 'success', data: group() })
    setGroupEnabledMock.mockReset().mockResolvedValue({ status: 'success', data: group({ status: 'disabled' }) })
    createGroupMock.mockReset().mockResolvedValue({ status: 'success', data: group() })
    schemaMock.mockReset().mockResolvedValue({
      data: {
        fields: [
          { key: 'status', label: '运行状态', type: 'multi_enum', ops: ['in'], options: [{ value: 'online', label: '运行中' }] },
          { key: 'network_domain_id', label: '网域', type: 'multi_enum', ops: ['in'], source: 'network_domains' },
        ],
      },
    })
    queryCandidatesMock.mockReset().mockResolvedValue({
      data: { list: [], total: 0, page: 1, page_size: 20, domains: [] },
    })
    candidateIdsMock.mockReset().mockResolvedValue({ data: { ids: [], total: 0, truncated: false, max_ids: 2000 } })
    jobsListMock.mockReset().mockResolvedValue({
      status: 'success',
      data: { list: [standalone], total: 1, page: 1, page_size: 20 },
    })
    jobRemoveMock.mockReset().mockResolvedValue({ status: 'success', data: {} })
    jobUpdateMock.mockReset().mockResolvedValue({ status: 'success', data: standalone })
    confirmMock.mockReset().mockResolvedValue({ status: 'success', data: {} })
    instancesMock.mockReset().mockResolvedValue({
      status: 'success',
      data: {
        list: [
          {
            resource_id: 'r-1',
            display_name: 'web-a',
            instance_ip: '10.1.0.1',
            port: 9100,
            status: 'up',
            target_address: '10.1.0.1:9100',
            installation: null,
          },
        ],
        total: 1,
      },
    })
    childGetMock.mockReset().mockImplementation((id: string) =>
      Promise.resolve({ status: 'success', data: { ...childJob('mc-a', '域A', id) } }),
    )
    queryMock.mockReset().mockResolvedValue({ status: 'success', data: { resultType: 'vector', result: [] } })
  })

  it('单一入口：只有「新建采集任务」，点击后向导可选采集 / 拨测', async () => {
    renderPage()
    await screen.findByText('主机基础采集')
    expect(screen.queryByText('新增单域任务')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /新建采集任务/ }))
    // 工具按钮与向导标题同名，断言向导已打开（步骤标题）
    expect(await screen.findByText('1. 任务')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '采集' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '拨测' })).toBeInTheDocument()
  })

  it('单视图：跨域任务以「覆盖网域」表达，展开为逐域子任务；无「未分组 / 所属任务组」概念', async () => {
    renderPage()
    expect(await screen.findByText('主机基础采集')).toBeInTheDocument()
    expect(screen.getByText('2 个网域')).toBeInTheDocument()
    expect(screen.getAllByText('覆盖网域').length).toBeGreaterThan(0)
    expect(screen.queryByText('所属任务组')).not.toBeInTheDocument()
    expect(screen.queryByText('未分组')).not.toBeInTheDocument()
    expect(screen.queryByText('按任务组')).not.toBeInTheDocument()

    const expand = document.querySelector('.ant-table-row-expand-icon') as HTMLElement
    fireEvent.click(expand)
    expect(await screen.findByText('promtool 校验失败')).toBeInTheDocument()
  })

  it('单域任务与跨域任务同表展示：单域行显示其所在网域', async () => {
    renderPage()
    expect(await screen.findByText('standalone-job')).toBeInTheDocument()
    expect(screen.getByText('单域任务')).toBeInTheDocument()
    expect(screen.getByText('域A')).toBeInTheDocument()
  })

  it('编辑跨域任务：向导预填参数与跨域已选', async () => {
    renderPage()
    await screen.findByText('主机基础采集')
    fireEvent.click(screen.getAllByRole('button', { name: /编\s*辑/ })[0])
    expect(await screen.findByText('编辑采集任务 - 主机基础采集')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('任务名称（必填，全局唯一）')).toHaveValue('主机基础采集')
  })

  it('编辑单域任务并跨域保存：走晋升接口（复用原 Job 行）', async () => {
    renderPage()
    await screen.findByText('standalone-job')
    fireEvent.click(screen.getAllByRole('button', { name: /编\s*辑/ })[1])
    expect(await screen.findByText(/编辑采集任务/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('任务名称（必填，全局唯一）')).toHaveValue('standalone-job')
  })

  it('删除跨域任务：调用组删除（级联子任务）', async () => {
    mockAntdMessage()
    renderPage()
    await screen.findByText('主机基础采集')
    fireEvent.click(screen.getAllByRole('button', { name: /删\s*除/ })[0])
    await waitFor(() => expect(document.querySelectorAll('.ant-popconfirm-buttons button').length).toBeGreaterThan(0))
    const confirms = document.querySelectorAll('.ant-popconfirm-buttons button')
    fireEvent.click(confirms[confirms.length - 1] as HTMLElement)
    await waitFor(() => expect(groupsRemoveMock).toHaveBeenCalledWith('grp-1'))
  })

  it('点任务名可打开详情（组维度入口保留）', async () => {
    renderPage()
    await screen.findByText('主机基础采集')
    fireEvent.click(screen.getAllByRole('button', { name: /详\s*情/ })[0])
    expect(await screen.findByText('任务详情 - 主机基础采集')).toBeInTheDocument()
  })

  it('编辑态展示逐域实例与生效端口，并可确认安装', async () => {
    renderPage()
    await screen.findByText('主机基础采集')
    fireEvent.click(screen.getAllByRole('button', { name: /编\s*辑/ })[0])

    // 第 4 段：逐域实例（折叠面板）
    expect(await screen.findByText(/各网域实例与生效端口/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('域A（1 台）'))
    expect(await screen.findByText('9100')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /确认安装/ }))
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(confirmMock.mock.calls[0][0]).toBe('job-a')
    expect(confirmMock.mock.calls[0][1]).toBe('r-1')
  })

  it('停用跨域任务：二次确认后调用组状态接口（整组级联停用）', async () => {
    renderPage()
    await screen.findByText('主机基础采集')

    fireEvent.click(screen.getByTestId('disable-group-grp-1'))
    const confirm = await screen.findByText('停用任务「主机基础采集」？')
    const popover = confirm.closest('.ant-popover') as HTMLElement
    fireEvent.click(within(popover).getByRole('button', { name: /停\s*用/ }))

    await waitFor(() => expect(setGroupEnabledMock).toHaveBeenCalledWith('grp-1', false))
  })

  it('启用已停用的跨域任务：直接调用组状态接口', async () => {
    groupsListMock.mockResolvedValue({
      status: 'success',
      data: { list: [group({ status: 'disabled' })], total: 1, page: 1, page_size: 20 },
    })
    renderPage()
    await screen.findByText('主机基础采集')

    fireEvent.click(screen.getByTestId('enable-group-grp-1'))
    await waitFor(() => expect(setGroupEnabledMock).toHaveBeenCalledWith('grp-1', true))
  })
})

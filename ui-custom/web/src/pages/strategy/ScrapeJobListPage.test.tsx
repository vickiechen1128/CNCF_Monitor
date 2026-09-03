import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { setupAntdTest } from '../../test/antdTestUtils'
import { ScrapeJobListPage } from './ScrapeJobListPage'

const listMock = vi.fn()
const updateMock = vi.fn()
const removeMock = vi.fn()
const instancesMock = vi.fn()
const domainListMock = vi.fn()
const tmplListMock = vi.fn()
const labelListMock = vi.fn()
const mappingListMock = vi.fn()
const targetsListMock = vi.fn()

vi.mock('../../api/scrapeJobs', () => ({
  scrapeJobApi: {
    list: (...args: unknown[]) => listMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    remove: (...args: unknown[]) => removeMock(...args),
    instances: (...args: unknown[]) => instancesMock(...args),
  },
}))

// 决策 47-2：实例采集状态聚合只读消费 M02 /api/v1/targets（按 job 过滤）
vi.mock('../../api/targets', () => ({
  targetsApi: { list: (...args: unknown[]) => targetsListMock(...args) },
}))

vi.mock('../../api/domain', () => ({
  networkDomainApi: {
    list: (...args: unknown[]) => domainListMock(...args),
  },
}))

// F1-1：采集器列反查真实名称 / 标签模板列渲染
vi.mock('../../api/exporterTemplates', () => ({
  exporterTemplateApi: { list: (...args: unknown[]) => tmplListMock(...args) },
}))

vi.mock('../../api/labelTemplates', () => ({
  labelTemplateApi: { list: (...args: unknown[]) => labelListMock(...args) },
}))

// F1-2：默认映射快照（参数同步三态「异常驱动」对比基线）
vi.mock('../../api/ciExporterMappings', () => ({
  ciExporterMappingApi: { list: (...args: unknown[]) => mappingListMock(...args) },
}))

// 页面测试不深入抽屉内部（F4 单独测）
vi.mock('./ScrapeJobFormDrawer', () => ({
  ScrapeJobFormDrawer: ({ open, onCancel }: { open: boolean; onCancel: () => void }) =>
    open ? <div data-testid="job-form-drawer">form</div> : (
      <button onClick={onCancel}>noop</button>
    ),
}))

// B4 Job 详情抽屉单独测（本文件二路线索：断言状态格点击/『查看』都能打开详情）
vi.mock('./ScrapeJobDetailDrawer', () => ({
  ScrapeJobDetailDrawer: ({ open }: { open: boolean }) =>
    open ? <div data-testid="job-detail-drawer">detail</div> : null,
}))

function job(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    job_name: `job-${id}`,
    job_type: 'standard',
    monitor_type: 'mysql',
    exporter_template_id: 'mysqld-exporter',
    network_domain_id: 'mc-a',
    selected_instance_ids: ['r-1', 'r-2'],
    scrape_interval: '15s',
    scrape_timeout: '10s',
    metrics_path: '/metrics',
    scheme: 'http',
    auth_type: 'none',
    enabled: true,
    draft_status: 'ready',
    change_status: 'pending',
    created_at: '2026-08-23T00:00:00Z',
    updated_at: '2026-08-23T00:00:00Z',
    ...extra,
  }
}

beforeEach(() => {
  listMock.mockReset()
  updateMock.mockReset()
  removeMock.mockReset()
  instancesMock.mockReset()
  domainListMock.mockReset()
  tmplListMock.mockReset()
  labelListMock.mockReset()
  mappingListMock.mockReset()
  targetsListMock.mockReset()
  // 默认：实例拉取无可用 => 聚合 pending 降级（实例拉取失败等价）；targets 返回空
  instancesMock.mockResolvedValue({ status: 'success', data: { items: [], total: 0 } })
  targetsListMock.mockResolvedValue({ status: 'success', data: { activeTargets: [], droppedTargets: [], targetsByJob: {} } })
  domainListMock.mockResolvedValue({
    status: 'success',
    data: { list: [{ id: 'mc-a', name: '网域A', is_monitored: true, status: 'enabled' }], total: 1, page: 1, page_size: 100 },
  })
  tmplListMock.mockResolvedValue({
    status: 'success',
    data: {
      list: [{ id: 1, name: 'mysqld-exporter' }, { id: 2, name: 'redis-exporter' }],
      total: 2,
      page: 1,
      page_size: 100,
    },
  })
  labelListMock.mockResolvedValue({
    status: 'success',
    data: {
      list: [{ id: 7, name: 'MySQL 标准标签' }, { id: 8, name: 'Redis 标准标签' }],
      total: 2,
      page: 1,
      page_size: 100,
    },
  })
  // 默认映射快照：mysql 默认 scrape_interval=15s（与 job 默认一致 → 已同步）
  mappingListMock.mockResolvedValue({
    status: 'success',
    data: {
      list: [{ id: 1, monitor_type: 'mysql', exporter_template_id: 1, is_default: true, scrape_interval: '15s', scrape_timeout: '10s', metrics_path: '/metrics', scheme: 'http' }],
      total: 1,
      page: 1,
      page_size: 100,
    },
  })
})

function renderPage() {
  render(
    <MemoryRouter>
      <ScrapeJobListPage />
    </MemoryRouter>,
  )
}

describe('ScrapeJobListPage', () => {
  setupAntdTest()

  // useJobScrapeStatus 挂载后启动 20s 自动刷新 interval：确保每个用例树卸载释放定时器
  afterEach(() => {
    cleanup()
  })

  it('renders jobs with aggregate status and override tag', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          job(1, { change_status: 'pending', enabled: true }),
          job(2, { change_status: 'deployed', enabled: true, mapping_overrides: [{ field: 'scrape_interval', value: '30s' }] }),
          job(3, { enabled: false }),
        ],
        total: 3,
        page: 1,
        page_size: 20,
      },
    })

    renderPage()

    expect(await screen.findByText('job-1')).toBeInTheDocument()
    // MainLayout 导航外壳已包覆：顶栏品牌标题可见
    expect(screen.getByText('MetricCenter')).toBeInTheDocument()
    // 生效状态列（用户视角生命周期）与变更进度列（M09 管线视角）分列呈现：job-1 pending → 待生效/待确认，job-2 deployed → 已生效/已下发
    expect(screen.getAllByText('待生效').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('待确认').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('已生效').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('已下发').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('已停用')).toBeInTheDocument()
    expect(screen.getAllByText('已覆盖 1 项').length).toBeGreaterThanOrEqual(1)
    // 「网域A」同时出现在筛选下拉选项与表格网域列
    expect(screen.getAllByText('网域A').length).toBeGreaterThanOrEqual(1)
  })

  it('renders param sync three states overridden/pending/synced (F1-2)', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          job(1, {}), // 与默认映射一致（15s）→ 已同步
          job(2, { scrape_interval: '60s' }), // 与默认映射不一致 → 待同步
          job(3, { mapping_overrides: [{ field: 'scheme', value: 'https' }] }), // → 已覆盖 1 项
        ],
        total: 3,
        page: 1,
        page_size: 20,
      },
    })

    renderPage()

    expect(await screen.findByText('job-1')).toBeInTheDocument()
    expect(screen.getAllByText('已同步').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('待同步').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('已覆盖 1 项').length).toBeGreaterThanOrEqual(1)
  })

  it('shows blackbox job type label', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [job(1, { job_type: 'blackbox', monitor_type: '', exporter_template_id: '', change_status: 'deployed' })],
        total: 1,
        page: 1,
        page_size: 20,
      },
    })

    renderPage()
    expect(await screen.findByText('拨测')).toBeInTheDocument()
  })

  it('resolves collector name from exporter_template_id and renders label template column (F1-1)', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          // 常规 job：exporter_template_id 命中模板名「mysqld-exporter」；label_template_id 命中「MySQL 标准标签」
          job(1, { exporter_template_id: 'mysqld-exporter', label_template_id: '7' }),
          // 未关联标签模板
          job(2, { exporter_template_id: 'redis-exporter', label_template_id: undefined }),
          // 查无模板 → 回退「默认采集器」占位，禁止裸 ID
          job(3, { exporter_template_id: 'unknown-exporter' }),
        ],
        total: 3,
        page: 1,
        page_size: 20,
      },
    })

    renderPage()

    expect(await screen.findByText('mysqld-exporter')).toBeInTheDocument()
    expect(screen.getByText('redis-exporter')).toBeInTheDocument()
    // 采集器列真实模板名解析 + 默认占位（非裸 ID）
    expect(screen.getByText('默认采集器')).toBeInTheDocument()
    // 标签模板列（O1/T01-F14 异常驱动）：正常继承只显模板名、无「待配置」Tag
    expect(screen.getByText('MySQL 标准标签')).toBeInTheDocument()
    expect(screen.queryByText('待配置')).toBeNull()
  })

  it('label template column exception-driven: 待配置 only when job lacks label but default mapping has one (O1/T01-F14)', async () => {
    // redis 默认映射已挂标签模板（label_template_id='8'）；mysql 默认映射未挂
    mappingListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { id: 1, monitor_type: 'mysql', exporter_template_id: 1, is_default: true, scrape_interval: '15s', scrape_timeout: '10s', metrics_path: '/metrics', scheme: 'http' },
          { id: 2, monitor_type: 'redis', exporter_template_id: 2, is_default: true, label_template_id: '8', scrape_interval: '15s', scrape_timeout: '10s', metrics_path: '/metrics', scheme: 'http' },
        ],
        total: 2,
        page: 1,
        page_size: 100,
      },
    })
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          // 正常继承：job 已关联标签模板 → 只显模板名、无「待配置」Tag
          job(1, { monitor_type: 'mysql', label_template_id: '7' }),
          // 异常态：job 未关联标签模板，但 redis 默认映射已挂标签 → 显橙色「待配置」Tag
          job(2, { monitor_type: 'redis', label_template_id: undefined }),
          // 无标签：job 未关联且默认映射未挂标签 → '-'
          job(3, { monitor_type: 'mysql', label_template_id: undefined }),
        ],
        total: 3,
        page: 1,
        page_size: 20,
      },
    })

    renderPage()

    expect(await screen.findByText('job-1')).toBeInTheDocument()
    // 正常继承：只显模板名、无「待配置」Tag
    expect(screen.getByText('MySQL 标准标签')).toBeInTheDocument()
    const row1 = screen.getByText('job-1').closest('tr') as HTMLElement
    expect(within(row1).queryByText('待配置')).toBeNull()
    // 异常态：job-2 行显「待配置」橙 Tag
    const row2 = screen.getByText('job-2').closest('tr') as HTMLElement
    expect(within(row2).getByText('待配置')).toBeInTheDocument()
    // 无标签：job-3 行渲染 '-'
    const row3 = screen.getByText('job-3').closest('tr') as HTMLElement
    expect(within(row3).getAllByText('-').length).toBeGreaterThanOrEqual(1)
  })

  it('shows empty state 暂无采集任务', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    renderPage()
    expect(await screen.findByText('暂无采集任务')).toBeInTheDocument()
  })

  it('redirects legacy ?tab=collectors to /collectors (F-09)', async () => {
    // 拆分前 `?scrape-jobs?tab=collectors` 直达采集器管理；拆分后自动跳转独立页
    render(
      <MemoryRouter initialEntries={['/scrape-jobs?tab=collectors']}>
        <Routes>
          <Route path="/scrape-jobs" element={<ScrapeJobListPage />} />
          <Route path="/collectors" element={<div data-testid="collectors-page">collectors</div>} />
        </Routes>
      </MemoryRouter>,
    )
    // 跳转后应落到 /collectors 对应页面，且不再渲染采集 Job 列表主体
    expect(await screen.findByTestId('collectors-page')).toBeInTheDocument()
    expect(screen.queryByText('新增采集任务')).toBeNull()
  })

  it('opening create drawer renders job form', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    renderPage()
    fireEvent.click(screen.getByText('新增采集任务'))
    expect(screen.getByTestId('job-form-drawer')).toBeInTheDocument()
  })

  // 决策 44-1：change_status=pending 的 job 已挂起待确认变更单，编辑/启停/删除均禁用。
  it('disables edit/toggle/delete for pending job, keeps them enabled otherwise', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          job(1, { change_status: 'pending', enabled: true }),
          job(2, { change_status: 'deployed', enabled: true }),
        ],
        total: 2,
        page: 1,
        page_size: 20,
      },
    })

    renderPage()
    expect(await screen.findByText('job-1')).toBeInTheDocument()

    const editButtons = screen.getAllByRole('button', { name: /编\s*辑/ })
    const deleteButtons = screen.getAllByRole('button', { name: /删\s*除/ })
    const toggleButtons = screen.getAllByRole('button', { name: '停用' })

    // 第一行（pending）全部禁用；第二行（deployed）可用。
    expect(editButtons[0]).toBeDisabled()
    expect(deleteButtons[0]).toBeDisabled()
    expect(toggleButtons[0]).toBeDisabled()
    expect(editButtons[1]).not.toBeDisabled()
    expect(deleteButtons[1]).not.toBeDisabled()
    expect(toggleButtons[1]).not.toBeDisabled()
  })

  // M01 PRD（破坏性操作二次确认）：停用需 Popconfirm 确认并提示监控中断影响，
  // 确认后才调用 update(enabled: false)。
  it('disabling a job requires Popconfirm with impact hint before calling update', async () => {
    updateMock.mockResolvedValue({ status: 'success', data: {} })
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [job(1, { change_status: 'deployed', enabled: true })],
        total: 1,
        page: 1,
        page_size: 20,
      },
    })

    renderPage()
    expect(await screen.findByText('job-1')).toBeInTheDocument()

    // 点击「停用」仅弹出二次确认，不直接调用接口。
    fireEvent.click(screen.getByRole('button', { name: '停用' }))
    expect(await screen.findByText(/相关监控中断/)).toBeInTheDocument()
    expect(updateMock).not.toHaveBeenCalled()

    // 确认后才以 enabled: false 调用 update。
    fireEvent.click(screen.getByRole('button', { name: '确认停用' }))
    await vi.waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    expect(updateMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ job_name: 'job-1', enabled: false }),
    )
  })

  // === T01-47-B3：实例采集状态列对齐原型（在线 x / 总数 y · 红/绿/'-' 三态 + 点击打开 Job 详情） ===

  function jobInstance(resourceId: string) {
    return { resource_id: resourceId, instance_name: `srv-${resourceId}`, instance_ip: `10.0.0.${resourceId.slice(-1)}`, status: 'confirmed' }
  }

  function jobTarget(resourceId: string, health: string) {
    return { scrapePool: 'job-x', job: 'job-x', instance: `10.0.0.${resourceId.slice(-1)}:9104`, network_domain: 'default', health, resource_id: resourceId }
  }

  it('实例采集状态列 green Tag（在线 x / 总数 y），点击打开 Job 详情（B3/B4）', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [job(1, { change_status: 'deployed', enabled: true, selected_instance_ids: ['a', 'b'] })], total: 1, page: 1, page_size: 20 },
    })
    instancesMock.mockResolvedValue({ status: 'success', data: { items: [jobInstance('a'), jobInstance('b')], total: 2 } })
    targetsListMock.mockResolvedValue({ status: 'success', data: { activeTargets: [jobTarget('a', 'up'), jobTarget('b', 'up')], droppedTargets: [], targetsByJob: {} } })

    renderPage()

    expect(await screen.findByText('在线 2 / 总数 2')).toBeInTheDocument()
    // 点击 green Tag 打开 Job 详情
    fireEvent.click(screen.getByText('在线 2 / 总数 2'))
    expect(await screen.findByTestId('job-detail-drawer')).toBeInTheDocument()
  })

  it('实例采集状态列 red Tag（存在待采集/已下发未采到），点击打开 Job 详情（B3/B4）', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [job(1, { change_status: 'deployed', enabled: true, selected_instance_ids: ['a', 'b'] })], total: 1, page: 1, page_size: 20 },
    })
    instancesMock.mockResolvedValue({ status: 'success', data: { items: [jobInstance('a'), jobInstance('b')], total: 2 } })
    targetsListMock.mockResolvedValue({ status: 'success', data: { activeTargets: [jobTarget('a', 'up'), jobTarget('b', 'down')], droppedTargets: [], targetsByJob: {} } })

    renderPage()

    // 一个 up + 一个 down → 待采集 down>0 → 高饱和红（#FF4C3A）
    expect(await screen.findByText('在线 1 / 总数 2')).toBeInTheDocument()
    const redTag = screen.getByText('在线 1 / 总数 2').closest('.ant-tag')
    // antd 将 #FF4C3A 归一化为 rgb(255,76,58) 内联背景色
    expect(redTag?.getAttribute('style')).toContain('rgb(255, 76, 58)')
    fireEvent.click(screen.getByText('在线 1 / 总数 2'))
    expect(await screen.findByTestId('job-detail-drawer')).toBeInTheDocument()
  })

  it('实例采集状态列 blackbox / total=0 显示「-」', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          job(1, { job_type: 'blackbox', selected_instance_ids: ['a'] }),
          job(2, { change_status: 'deployed', enabled: true, selected_instance_ids: [] }),
        ],
        total: 2,
        page: 1,
        page_size: 20,
      },
    })

    renderPage()

    expect(await screen.findByText('job-1')).toBeInTheDocument()
    const row1 = screen.getByText('job-1').closest('tr') as HTMLElement
    const row2 = screen.getByText('job-2').closest('tr') as HTMLElement
    // 记录原型锚点：实例采集状态列两行均渲染 '-'（blackbox 无实例维度、total=0）
    expect(within(row1).getAllByText('-').length).toBeGreaterThanOrEqual(1)
    expect(within(row2).getAllByText('-').length).toBeGreaterThanOrEqual(1)
  })
})
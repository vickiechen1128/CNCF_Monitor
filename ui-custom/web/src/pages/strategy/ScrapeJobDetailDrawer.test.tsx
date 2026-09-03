import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import { setupAntdTest } from '../../test/antdTestUtils'
import { ScrapeJobDetailDrawer } from './ScrapeJobDetailDrawer'
import type { ScrapeJob } from '../../types/strategy'

const instancesMock = vi.fn()
const targetsListMock = vi.fn()

vi.mock('../../api/scrapeJobs', () => ({
  scrapeJobApi: { instances: (...args: unknown[]) => instancesMock(...args) },
}))

vi.mock('../../api/targets', () => ({
  targetsApi: { list: (...args: unknown[]) => targetsListMock(...args) },
}))

const job = (over: Partial<ScrapeJob> = {}): ScrapeJob =>
  ({
    id: 1,
    job_name: 'job-x',
    job_type: 'standard',
    resource_type: 'host',
    monitor_type: 'host_linux',
    network_domain_id: 'nd-1',
    instance_selection_mode: 'manual',
    selected_instance_ids: ['a', 'b', 'c'],
    exporter_template_id: 'node-exporter',
    scrape_interval: '15s',
    scrape_timeout: '10s',
    metrics_path: '/metrics',
    scheme: 'http',
    auth_type: 'none',
    tls_skip_verify: false,
    ca_file: '',
    filter_rules: '',
    label_template_id: '7',
    mapping_overrides: [],
    draft_status: 'ready',
    change_status: 'deployed',
    enabled: true,
    created_at: '2026-08-23T00:00:00Z',
    updated_at: '2026-08-23T00:00:00Z',
    ...over,
  }) as ScrapeJob

function instance(resourceId: string) {
  return { resource_id: resourceId, instance_name: `srv-${resourceId}`, instance_ip: `10.0.0.${resourceId}`, status: 'confirmed' as const }
}

function target(resourceId: string, health: string, lastError = '') {
  return { scrapePool: 'job-x', job: 'job-x', instance: `10.0.0.${resourceId}:9104`, network_domain: 'default', health, lastError, resource_id: resourceId }
}

describe('ScrapeJobDetailDrawer（T01-47-B4 Job 详情对齐原型）', () => {
  setupAntdTest()

  beforeEach(() => {
    instancesMock.mockReset()
    targetsListMock.mockReset()
  })

  // 抽屉打开后启动 20s 自动刷新 interval：确保每个用例树卸载释放定时器
  afterEach(() => {
    cleanup()
  })

  it('白描Descriptions 字段齐全 + 实例状态 Tag 三态 + 刷新可见（B4）', async () => {
    instancesMock.mockResolvedValue({ status: 'success', data: { items: [instance('a'), instance('b'), instance('c')], total: 3 } })
    targetsListMock.mockResolvedValue({
      status: 'success',
      data: { activeTargets: [target('a', 'up'), target('b', 'down', 'connect refused')], droppedTargets: [], targetsByJob: {} },
    })

    render(
      <ScrapeJobDetailDrawer
        open
        job={job()}
        onClose={() => {}}
        resolveDomainName={(id) => (id === 'nd-1' ? '网域A' : id)}
        resolveTemplateName={(ref) => (ref === 'node-exporter' ? 'node-exporter' : ref)}
        resolveLabelTemplateName={(id) => (id === '7' ? 'MySQL 标准标签' : id)}
        getDefaultMapping={() => undefined}
      />,
    )

    // Descriptions 概览字段齐全
    expect(await screen.findByText('Job 名称')).toBeInTheDocument()
    // job 名出现在抽屉标题 Tag 与 Job 名称 Descriptions 两处，用 >=1 断言
    expect(screen.getAllByText('job-x').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('标准采集')).toBeInTheDocument()
    expect(screen.getByText('网域A')).toBeInTheDocument()
    expect(screen.getByText('Linux 主机')).toBeInTheDocument()
    expect(screen.getAllByText('node-exporter').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('采集间隔')).toBeInTheDocument()
    expect(screen.getByText('超时')).toBeInTheDocument()
    expect(screen.getByText('指标路径')).toBeInTheDocument()
    expect(screen.getByText('协议')).toBeInTheDocument()
    expect(screen.getByText('手动勾选')).toBeInTheDocument()
    expect(screen.getByText('MySQL 标准标签')).toBeInTheDocument()
    expect(screen.getByText('启用状态')).toBeInTheDocument()
    // 创建/更新时间：与组件同源 toLocaleString，避免 locale/tz 差异导致 flaky
    const expectedTs = new Date('2026-08-23T00:00:00Z').toLocaleString()
    expect(screen.getByText(`${expectedTs} / ${expectedTs}`)).toBeInTheDocument()

    // 已选实例 + 顶部汇总（决策 47-2）
    expect(await screen.findByText('已选实例（3）')).toBeInTheDocument()
    expect(screen.getByText(/在线 1 \/ 总数 3/)).toBeInTheDocument()

    // 实例状态 Tag 三态
    const rowA = screen.getByText('srv-a').closest('.ant-list-item') as HTMLElement
    const rowB = screen.getByText('srv-b').closest('.ant-list-item') as HTMLElement
    const rowC = screen.getByText('srv-c').closest('.ant-list-item') as HTMLElement
    expect(within(rowA).getByText('采集中')).toBeInTheDocument()
    expect(within(rowB).getByText('已下发未采到')).toBeInTheDocument()
    expect(within(rowC).getByText('待采集')).toBeInTheDocument()

    // 手动刷新按钮可见 / 可用
    expect(screen.getByRole('button', { name: /刷\s*新/ })).toBeInTheDocument()
    expect(screen.getByText(/20s 自动刷新/)).toBeInTheDocument()
  })

  it('手动刷新会再次拉取实例与 targets（决策 47-2 只读 + 手动刷新）', async () => {
    instancesMock.mockResolvedValue({ status: 'success', data: { items: [instance('a')], total: 1 } })
    targetsListMock.mockResolvedValue({ status: 'success', data: { activeTargets: [target('a', 'up')], droppedTargets: [], targetsByJob: {} } })

    render(
      <ScrapeJobDetailDrawer open job={job({ selected_instance_ids: ['a'], id: 1 })} onClose={() => {}} resolveDomainName={() => '网域A'} getDefaultMapping={() => undefined} />,
    )

    expect(await screen.findByText('已选实例（1）')).toBeInTheDocument()
    expect(instancesMock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /刷\s*新/ }))
    await vi.waitFor(() => expect(instancesMock).toHaveBeenCalledTimes(2))
    expect(targetsListMock).toHaveBeenCalledWith({ job: 'job-x' })
  })

  it('blackbox Job 展示拨测目标列表，不展示实例采集状态区块（B4）', async () => {
    render(
      <ScrapeJobDetailDrawer
        open
        job={job({ job_type: 'blackbox', blackbox_module: 'http_2xx', blackbox_targets: [{ target: 'https://example.com', protocol: 'https' }], selected_instance_ids: [] })}
        onClose={() => {}}
        getDefaultMapping={() => undefined}
      />,
    )

    expect(await screen.findByText('blackbox 拨测')).toBeInTheDocument()
    expect(screen.getByText('拨测目标（1）')).toBeInTheDocument()
    expect(screen.getByText('HTTPS')).toBeInTheDocument()
    expect(screen.getByText('https://example.com')).toBeInTheDocument()
    expect(screen.queryByText('已选实例')).toBeNull()
  })
})
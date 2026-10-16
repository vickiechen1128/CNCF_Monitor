import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { setupAntdTest } from '../../test/antdTestUtils'
import { ScrapeJobFormDrawer } from './ScrapeJobFormDrawer'

const updateMock = vi.fn()
const createMock = vi.fn()
const domainListMock = vi.fn()
const labelListMock = vi.fn()

vi.mock('../../api/scrapeJobs', () => ({
  scrapeJobApi: {
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    // {T01-P6} 编辑态生效端口回显数据源；blackbox 分支不拉取，返回空即可
    instances: vi.fn().mockResolvedValue({ status: 'success', data: { items: [], total: 0 } }),
  },
}))
vi.mock('../../api/domain', () => ({
  networkDomainApi: { list: (...args: unknown[]) => domainListMock(...args) },
}))
vi.mock('../../api/ciExporterMappings', () => ({
  ciExporterMappingApi: { list: vi.fn().mockResolvedValue({ status: 'success', data: { list: [], total: 0 } }) },
}))
vi.mock('../../api/labelTemplates', () => ({
  labelTemplateApi: { list: (...args: unknown[]) => labelListMock(...args) },
}))
vi.mock('../../api/exporterTemplates', () => ({
  exporterTemplateApi: { create: vi.fn() },
}))
vi.mock('../../api/configCenter', () => ({
  configDraftApi: { create: vi.fn().mockResolvedValue({ status: 'success', data: {} }) },
}))
vi.mock('./InstanceSelector', () => ({ InstanceSelector: () => null }))
vi.mock('./ExporterInstallationPanel', () => ({ ExporterInstallationPanel: () => null }))

beforeEach(() => {
  updateMock.mockReset()
  createMock.mockReset()
  domainListMock.mockReset()
  labelListMock.mockReset()
  domainListMock.mockResolvedValue({
    status: 'success',
    data: { list: [{ id: 'mc-a', name: '网域A', is_monitored: true, status: 'enabled' }], total: 1, page: 1, page_size: 100 },
  })
  labelListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 100 } })
})

// 阶段5：拨测目标改走「从资源选择」——目标清单由 selected_instance_ids 承载
// （指向所选 resource_type 资源）。资源类别限接口服务 / 应用服务两类，探测地址字段由
// 类别写死推导（不提交 target_field）；手填入口已彻底禁用。
const blackboxRecord = {
  id: 5,
  job_name: 'probe-edit-1',
  job_type: 'blackbox',
  monitor_type: '',
  resource_type: 'interface_service',
  target_field: 'api_url',
  network_domain_id: 'mc-a',
  scrape_interval: '15s',
  scrape_timeout: '10s',
  metrics_path: '/metrics',
  scheme: 'http',
  auth_type: 'none',
  tls_skip_verify: false,
  blackbox_module: 'http_2xx',
  selected_instance_ids: ['api-1', 'api-2'],
}

function renderDrawer(open: boolean, record?: unknown) {
  return render(
    <MemoryRouter initialEntries={['/scrape-jobs']}>
      <Routes>
        <Route
          path="/scrape-jobs"
          element={<ScrapeJobFormDrawer open={open} record={record as never} onCancel={() => {}} onSuccess={() => {}} />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ScrapeJobFormDrawer blackbox edit echo (regression)', () => {
  setupAntdTest()

  it('echoes blackbox fields when opened from a closed state (real list-page path)', async () => {
    // 模拟真实列表页：forceRender 下抽屉常驻挂载（open=false, record=null），
    // 用户点「编辑」后 open=true 且 record=blackbox —— 复用同一实例。
    const { rerender } = renderDrawer(false, null)
    rerender(
      <MemoryRouter initialEntries={['/scrape-jobs']}>
        <Routes>
          <Route
            path="/scrape-jobs"
            element={<ScrapeJobFormDrawer open record={blackboxRecord as never} onCancel={() => {}} onSuccess={() => {}} />}
          />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByDisplayValue('probe-edit-1')).toBeInTheDocument()
    // 分支必须切到「拨测」，拨测模块应回显 http_2xx
    expect(await screen.findByText('http_2xx')).toBeInTheDocument()
    // 资源类别回显用户原选值；探测地址字段不再是输入项（由类别写死推导），
    // 改由「拨测目标」的引导文案说明取哪个字段。
    expect(await screen.findByText('接口服务')).toBeInTheDocument()
    expect(screen.queryByText('探测地址字段')).not.toBeInTheDocument()
    expect(await screen.findByText(/目标地址固定取所选实例的接口地址/)).toBeInTheDocument()
    // 拨测目标不再手填：入口是「从资源选择」，旧的 target/url 输入框必须消失
    expect(screen.queryByText('添加拨测目标')).not.toBeInTheDocument()
    // 网域下拉应回显选中项（mc-a → 网域A），而非空值占位文案
    expect(await screen.findByText('网域A')).toBeInTheDocument()
  })

  it('submits edit with echoed resource targets (selected_instance_ids)', async () => {
    updateMock.mockResolvedValue({ status: 'success', data: { ...blackboxRecord } })
    renderDrawer(true, blackboxRecord)

    await screen.findByDisplayValue('probe-edit-1')
    // 直接点保存（编辑态；antd 按钮在中文间插入空格，故用 \s* 匹配「保 存」）
    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    const body = updateMock.mock.calls[0][1] as Record<string, unknown>
    expect(body.job_name).toBe('probe-edit-1')
    expect(body.job_type).toBe('blackbox')
    expect(body.blackbox_module).toBe('http_2xx')
    // 目标改由资源选择承载：只回传类别（探测地址字段由服务端按类别推导），选中集原样回传
    expect(body.resource_type).toBe('interface_service')
    expect(body.target_field).toBeUndefined()
    expect(body.selected_instance_ids).toEqual(['api-1', 'api-2'])
    // 手填字段彻底不再提交（后端亦拒绝写入）
    expect(body.blackbox_targets).toBeUndefined()
  })
})

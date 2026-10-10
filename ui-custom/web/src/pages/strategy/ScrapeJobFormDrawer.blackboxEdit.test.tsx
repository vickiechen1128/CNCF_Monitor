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

const blackboxRecord = {
  id: 5,
  job_name: 'probe-edit-1',
  job_type: 'blackbox',
  monitor_type: '',
  network_domain_id: 'mc-a',
  scrape_interval: '15s',
  scrape_timeout: '10s',
  metrics_path: '/metrics',
  scheme: 'http',
  auth_type: 'none',
  tls_skip_verify: false,
  blackbox_module: 'http_2xx',
  blackbox_targets: [
    { target: 'https://example.com', protocol: 'https', url: 'https://example.com' },
    { target: '1.2.3.4:80', protocol: 'tcp' },
  ],
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
    // 拨测目标应回显两条（target 与 url 各一个输入框，值为 https://example.com 出现两次）
    await waitFor(() => {
      expect(screen.getAllByDisplayValue('https://example.com').length).toBe(2)
    })
    expect(screen.getByDisplayValue('1.2.3.4:80')).toBeInTheDocument()
    // 网域下拉应渲染（拨测分支专属），且值已由 setFieldsValue 写入表单
    expect(screen.getByText('仅已纳管非冻结网域')).toBeInTheDocument()
  })

  it('submits edit with echoed blackbox payload', async () => {
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
    expect((body.blackbox_targets as { target: string }[]).length).toBe(2)
  })
})

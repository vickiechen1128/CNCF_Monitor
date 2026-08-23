import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { setupAntdTest } from '../../test/antdTestUtils'
import { CollectorTemplatesTab } from './CollectorTemplatesTab'

const mappingListMock = vi.fn()
const tmplListMock = vi.fn()

vi.mock('../../api/ciExporterMappings', () => ({
  ciExporterMappingApi: {
    list: (...args: unknown[]) => mappingListMock(...args),
    create: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('../../api/exporterTemplates', () => ({
  exporterTemplateApi: {
    list: (...args: unknown[]) => tmplListMock(...args),
  },
}))

function mapping(id: number, monitor_type: string, exporter_template_id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    monitor_type,
    exporter_template_id,
    is_default: false,
    default_port: 9104,
    metrics_path: '/metrics',
    scheme: 'http',
    scrape_interval: '15s',
    scrape_timeout: '10s',
    is_builtin: false,
    created_at: '2026-08-23T00:00:00Z',
    updated_at: '2026-08-23T00:00:00Z',
    ...extra,
  }
}

function template(id: number, name: string, source = 'official') {
  return {
    id,
    name,
    version: '1.0.0',
    default_port: 9104,
    metrics_path: '/metrics',
    scheme: 'http',
    supported_monitor_types: [],
    os: 'linux',
    arch: 'amd64',
    download_url: '',
    homepage: '',
    install_guide: '',
    is_builtin: true,
    source,
    created_at: '2026-08-23T00:00:00Z',
    updated_at: '2026-08-23T00:00:00Z',
  }
}

describe('CollectorTemplatesTab', () => {
  setupAntdTest()

  beforeEach(() => {
    mappingListMock.mockReset()
    tmplListMock.mockReset()
    tmplListMock.mockResolvedValue({
      status: 'success',
      data: { list: [template(1, 'mysqld-exporter'), template(2, 'redis-exporter')], total: 2, page: 1, page_size: 100 },
    })
  })

  it('renders mapping rows with resolved collector names', async () => {
    mappingListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [mapping(1, 'mysql', 1, { is_default: true }), mapping(2, 'redis', 2, {})],
        total: 2,
        page: 1,
        page_size: 20,
      },
    })

    render(<CollectorTemplatesTab />)

    expect(await screen.findByText('mysqld-exporter')).toBeInTheDocument()
    expect(screen.getByText('redis-exporter')).toBeInTheDocument()
    expect(screen.getByText('MySQL')).toBeInTheDocument()
    expect(screen.getAllByText('默认').length).toBeGreaterThanOrEqual(1)
  })

  it('shows 未被引用 tag when is_referenced=false and 待配置 badge when no label template', async () => {
    mappingListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [mapping(1, 'mysql', 1, { is_referenced: false, has_label_template: false })],
        total: 1,
        page: 1,
        page_size: 20,
      },
    })

    render(<CollectorTemplatesTab />)

    // 等待异步数据渲染完成（mysql mapping 行出现）后再断言
    await screen.findByText('MySQL')
    // 「未被引用」可能同时出现在 mapping 行标记与并入的模板池行，需容忍多处
    expect(screen.getAllByText('未被引用').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('待配置').length).toBeGreaterThanOrEqual(1)
  })

  it('filters rows by source (client-side) when source selected', async () => {
    mappingListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          mapping(1, 'mysql', 1, { is_referenced: false, has_label_template: false }),
          mapping(2, 'redis', 2, { is_referenced: false, has_label_template: false }),
        ],
        total: 2,
        page: 1,
        page_size: 20,
      },
    })
    // mysql → template 1 (official)；redis → template 2 (third_party)
    tmplListMock.mockResolvedValue({
      status: 'success',
      data: { list: [template(1, 'mysqld-exporter', 'official'), template(2, 'redis-exporter', 'third_party')], total: 2, page: 1, page_size: 100 },
    })

    render(<CollectorTemplatesTab />)
    await screen.findByText('mysqld-exporter')

    // 置 official 后仅保留 mysql 行
    fireEvent.mouseDown(screen.getByText('全部来源'))
    fireEvent.click(await screen.findByText('官方'))

    expect(screen.getByText('mysqld-exporter')).toBeInTheDocument()
    expect(screen.queryByText('redis-exporter')).toBeNull()
  })

  it('renders empty state 暂无默认采集配置 with inline register entry (A9)', async () => {
    mappingListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })
    // 空态需采集器池也为空（F1-5：池有模板时以「未被引用」行并入，不显空态）
    tmplListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 100 } })

    render(<CollectorTemplatesTab />)

    expect(await screen.findByText('暂无默认采集配置')).toBeInTheDocument()
    expect(screen.getByText('池中没有需要的采集器？')).toBeInTheDocument()
    expect(screen.getByText('登记自研/第三方采集器')).toBeInTheDocument()
  })

  it('opens registration drawer on 登记采集器 click', async () => {
    mappingListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    render(<CollectorTemplatesTab />)
    // 「登记采集器」同时出现在 Steps 标题与右上按钮，点击右上按钮打开抽屉
    fireEvent.click(screen.getByRole('button', { name: /登记采集器/ }))

    // 抽屉打开后展示登记表单（采集器名称必填输入 + antd 两字按钮自动加空格「登 记」）
    expect(screen.getByPlaceholderText('例如：mysql-exporter')).toBeInTheDocument()
    expect(screen.getByText('登 记')).toBeInTheDocument()
  })

  it('requires default_port/metrics_path/scheme when source=internal on register', async () => {
    mappingListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    render(<CollectorTemplatesTab />)
    fireEvent.click(screen.getByRole('button', { name: /登记采集器/ }))
    await screen.findByPlaceholderText('例如：mysql-exporter')

    // source 默认 internal（内部自建）：default_port/metrics_path/scheme 动态必填
    const drawer = screen.getByPlaceholderText('例如：mysql-exporter').closest('.ant-drawer') as HTMLElement
    fireEvent.click(within(drawer).getByRole('button', { name: /登\s*记/ }))
    expect(await screen.findByText('请输入默认端口')).toBeInTheDocument()
    expect(screen.getByText('请输入采集路径')).toBeInTheDocument()
    // 协议 error 文案与 placeholder 同为「请选择协议」，需容忍多处匹配
    expect(screen.getAllByText('请选择协议').length).toBeGreaterThanOrEqual(1)
  })

  // ---- F10 增强：Steps 动线 / 未被引用模板行并入+去配置 / 安装与文档入口 ----
  it('renders Steps three-step flow (A4)', async () => {
    mappingListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })
    tmplListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 100 } })

    render(<CollectorTemplatesTab />)

    expect(await screen.findByText('部署动线')).toBeInTheDocument()
    // 「登记采集器」同时出现在 Steps 标题与右上按钮，容忍多处
    expect(screen.getAllByText('登记采集器').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('配置默认采集')).toBeInTheDocument()
    expect(screen.getByText('创建 Job 确认安装')).toBeInTheDocument()
  })

  it('merges unreferenced template rows with 去配置 action (F1-5)', async () => {
    // 仅一个 mapping 引用 t1；t3（池中未被引用）应并入列表
    mappingListMock.mockResolvedValue({
      status: 'success',
      data: { list: [mapping(1, 'mysql', 1, {})], total: 1, page: 1, page_size: 20 },
    })
    tmplListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          template(1, 'mysqld-exporter'),
          template(2, 'redis-exporter'),
          template(3, 'snmp-exporter'),
        ],
        total: 3,
        page: 1,
        page_size: 100,
      },
    })

    render(<CollectorTemplatesTab />)

    // 未被引用的池中模板 snmp-exporter 并入为行（引用 t2 及被引用的 t1 通过 mapping 行呈现）
    await screen.findByText('mysqld-exporter')
    expect(screen.findByText('snmp-exporter')).resolves.toBeTruthy()
    expect(screen.getAllByText('未被引用').length).toBeGreaterThanOrEqual(1)
    // 行操作「去配置」存在（每个模板池行各一）
    const gotoConfig = screen.getAllByText('去配置')
    expect(gotoConfig.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(gotoConfig[0])
  })

  it('shows install/download/doc entry on install column (F1-6)', async () => {
    mappingListMock.mockResolvedValue({
      status: 'success',
      data: { list: [mapping(1, 'mysql', 1, {})], total: 1, page: 1, page_size: 20 },
    })
    // 给模板注入 download_url/homepage 以呈现图标链
    tmplListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { ...template(1, 'mysqld-exporter'), download_url: 'https://x/download', homepage: 'https://x/doc', install_guide: 'a,b,c' },
          template(2, 'redis-exporter'),
        ],
        total: 2,
        page: 1,
        page_size: 100,
      },
    })

    render(<CollectorTemplatesTab />)

    await screen.findByText('mysqld-exporter')
    // 安装/文档列按钮存在（点击展开 Popover 图标链）
    const btn = screen.getAllByText('安装指南')[0]
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(await screen.findByText('下载')).toBeInTheDocument()
    expect(screen.getByText('文档')).toBeInTheDocument()
  })
})
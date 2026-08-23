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

    expect(await screen.findByText('未被引用')).toBeInTheDocument()
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

  it('renders empty state 暂无默认采集配置', async () => {
    mappingListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    render(<CollectorTemplatesTab />)

    expect(await screen.findByText('暂无默认采集配置')).toBeInTheDocument()
  })

  it('opens registration drawer on 登记采集器 click', async () => {
    mappingListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    render(<CollectorTemplatesTab />)
    fireEvent.click(screen.getByText('登记采集器'))

    // 抽屉打开后展示登记表单（采集器名称必填输入 + antd 两字按钮自动加空格「登 记」）
    expect(screen.getByPlaceholderText('例如：mysql-exporter')).toBeInTheDocument()
    expect(screen.getByText('登 记')).toBeInTheDocument()
  })

  it('requires default_port/metrics_path/scheme when source=internal on register', async () => {
    mappingListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    render(<CollectorTemplatesTab />)
    fireEvent.click(screen.getByText('登记采集器'))
    await screen.findByPlaceholderText('例如：mysql-exporter')

    // source 默认 internal（内部自建）：default_port/metrics_path/scheme 动态必填
    const drawer = screen.getByPlaceholderText('例如：mysql-exporter').closest('.ant-drawer') as HTMLElement
    fireEvent.click(within(drawer).getByRole('button', { name: /登\s*记/ }))
    expect(await screen.findByText('请输入默认端口')).toBeInTheDocument()
    expect(screen.getByText('请输入采集路径')).toBeInTheDocument()
    // 协议 error 文案与 placeholder 同为「请选择协议」，需容忍多处匹配
    expect(screen.getAllByText('请选择协议').length).toBeGreaterThanOrEqual(1)
  })
})
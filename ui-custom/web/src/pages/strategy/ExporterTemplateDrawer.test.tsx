import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupAntdTest } from '../../test/antdTestUtils'
import { ExporterTemplateDrawer } from './ExporterTemplateDrawer'

const exporterCreateMock = vi.fn()

vi.mock('../../api/exporterTemplates', () => ({
  exporterTemplateApi: { create: (...args: unknown[]) => exporterCreateMock(...args) },
}))

function renderDrawer() {
  render(<ExporterTemplateDrawer open onCancel={() => {}} onSuccess={() => {}} />)
}

describe('ExporterTemplateDrawer', () => {
  setupAntdTest()

  beforeEach(() => {
    exporterCreateMock.mockReset()
    exporterCreateMock.mockResolvedValue({ status: 'success', data: { id: 1, name: 't', source: 'internal' } })
  })

  it('renders register form with required fields (source=internal)', async () => {
    renderDrawer()
    expect(screen.getByText('登记采集器')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('例如：mysql-exporter')).toBeInTheDocument()
    expect(screen.getByText('登 记')).toBeInTheDocument()
  })

  // M01 v2.0：采集器模板不再声明「支持的监控对象类型」（后端已删除 supported_monitor_types），
  // 采集模板与指标锚点各自直接引用 template_code。
  it('does not render 支持监控类型 anymore (supported_monitor_types 已删除)', () => {
    renderDrawer()
    expect(screen.queryByText('支持监控类型')).toBeNull()
    expect(screen.queryByText('关联的监控对象类型')).toBeNull()
  })

  it('offers 官方 / 第三方 / 内部自建 source options (F-29 D 放开来源登记)', async () => {
    renderDrawer()
    // 默认选中「内部自建」；打开下拉可见官方 / 第三方 / 内部自建三选项（用户登记已放开）
    fireEvent.mouseDown(screen.getByText('内部自建'))
    expect(await screen.findByText('官方')).toBeInTheDocument()
    expect(screen.getByText('第三方')).toBeInTheDocument()
    expect(screen.getAllByText('内部自建').length).toBeGreaterThanOrEqual(1)
  })

  it('submits without supported_monitor_types', async () => {
    exporterCreateMock.mockResolvedValue({
      status: 'success',
      data: { id: 9, name: 'mysql-exporter-custom', source: 'internal' },
    })
    renderDrawer()

    await userEvent.type(screen.getByPlaceholderText('例如：mysql-exporter'), 'mysql-exporter-custom')
    await userEvent.type(screen.getByPlaceholderText('例如：9104'), '9104')
    await userEvent.type(screen.getByPlaceholderText('/metrics（默认）'), '/metrics')
    // antd 会同时渲染 accessibility role=option 与 option-content，用 selector 精确定位可点击的 option-content
    fireEvent.mouseDown(screen.getAllByText('请选择协议')[0])
    const httpOption = await screen.findByText('http', { selector: '.ant-select-item-option-content' })
    await userEvent.click(httpOption)

    fireEvent.click(screen.getByRole('button', { name: /登\s*记/ }))
    await waitFor(() => expect(exporterCreateMock).toHaveBeenCalled())
    const body = exporterCreateMock.mock.calls[0][0] as Record<string, unknown>
    expect(body.name).toBe('mysql-exporter-custom')
    expect(body).not.toHaveProperty('supported_monitor_types')
  })

  it('submits os/arch default any and download_url/homepage on register (原型字段对齐)', async () => {
    renderDrawer()
    await userEvent.type(screen.getByPlaceholderText('例如：mysql-exporter'), 'my-exporter')
    await userEvent.type(screen.getByPlaceholderText('例如：9104'), '9104')
    await userEvent.type(screen.getByPlaceholderText('/metrics（默认）'), '/metrics')
    fireEvent.mouseDown(screen.getAllByText('请选择协议')[0])
    const httpOption = await screen.findByText('http', { selector: '.ant-select-item-option-content' })
    await userEvent.click(httpOption)
    // 下载地址 / 官方文档主页 均使用 https://... 占位符，取第一个（下载地址）填写
    const urlInputs = screen.getAllByPlaceholderText('https://...')
    await userEvent.type(urlInputs[0], 'https://repo.example.com/exporter.tar.gz')
    await userEvent.type(screen.getByPlaceholderText('采集器用途与能力说明'), '自研采集器')

    fireEvent.click(screen.getByRole('button', { name: /登\s*记/ }))
    await waitFor(() => expect(exporterCreateMock).toHaveBeenCalled())
    const body = exporterCreateMock.mock.calls[0][0] as Record<string, unknown>
    expect(body.os).toBe('any')
    expect(body.arch).toBe('any')
    expect(body.download_url).toBe('https://repo.example.com/exporter.tar.gz')
    expect(body.description).toBe('自研采集器')
  })
})

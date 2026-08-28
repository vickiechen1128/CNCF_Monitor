import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupAntdTest } from '../../test/antdTestUtils'
import { ExporterTemplateDrawer } from './ExporterTemplateDrawer'
import type { MonitorType } from '../../types/strategy'

const exporterCreateMock = vi.fn()

vi.mock('../../api/exporterTemplates', () => ({
  exporterTemplateApi: { create: (...args: unknown[]) => exporterCreateMock(...args) },
}))

function renderDrawer(initialMonitorTypes?: MonitorType[]) {
  render(
    <ExporterTemplateDrawer open onCancel={() => {}} onSuccess={() => {}} initialMonitorTypes={initialMonitorTypes} />,
  )
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

  it('prefills supported_monitor_types from initialMonitorTypes (O2/T01-F15)', async () => {
    renderDrawer(['mysql'])
    // 预填后「支持监控类型」多选 Select 展示当前监控对象类型 MySQL（MONITOR_TYPE_MAP）
    expect(screen.getByText('MySQL')).toBeInTheDocument()
  })

  it('does not prefill supported_monitor_types when initialMonitorTypes omitted (O2/T01-F15)', async () => {
    renderDrawer()
    // 采集器管理 Tab 直接登记不传该 prop → 不预填，无选中项
    expect(screen.queryByText('MySQL')).toBeNull()
  })

  it('offers 官方 / 第三方 / 内部自建 source options (F-29 D 放开来源登记)', async () => {
    renderDrawer()
    // 默认选中「内部自建」；打开下拉可见官方 / 第三方 / 内部自建三选项（用户登记已放开）
    fireEvent.mouseDown(screen.getByText('内部自建'))
    expect(await screen.findByText('官方')).toBeInTheDocument()
    expect(screen.getByText('第三方')).toBeInTheDocument()
    expect(screen.getAllByText('内部自建').length).toBeGreaterThanOrEqual(1)
  })

  it('submits prefilled supported_monitor_types on register (O2/T01-F15)', async () => {
    exporterCreateMock.mockResolvedValue({
      status: 'success',
      data: { id: 9, name: 'mysql-exporter-custom', source: 'internal' },
    })
    renderDrawer(['mysql'])

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
    expect(body.supported_monitor_types).toEqual(['mysql'])
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

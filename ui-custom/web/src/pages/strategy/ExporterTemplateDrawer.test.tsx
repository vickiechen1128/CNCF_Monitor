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
})

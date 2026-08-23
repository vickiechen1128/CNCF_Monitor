import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { setupAntdTest, selectAntdOption } from '../../test/antdTestUtils'
import { MappingDrawer } from './MappingDrawer'

const createMock = vi.fn()
const updateMock = vi.fn()
const templateListMock = vi.fn()

vi.mock('../../api/ciExporterMappings', () => ({
  ciExporterMappingApi: {
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
  },
}))

vi.mock('../../api/exporterTemplates', () => ({
  exporterTemplateApi: { list: (...args: unknown[]) => templateListMock(...args) },
}))

beforeEach(() => {
  createMock.mockReset()
  updateMock.mockReset()
  templateListMock.mockReset()
  templateListMock.mockResolvedValue({
    status: 'success',
    data: { list: [{ id: 'exp-1', name: 'mysql-exporter' }], total: 1, page: 1, page_size: 100 },
  })
})

function renderDrawer(record?: unknown) {
  render(<MappingDrawer open record={record as never} onCancel={() => {}} onSuccess={() => {}} />)
}

describe('MappingDrawer', () => {
  setupAntdTest()

  it('renders create drawer with two independent category/type fields (F1-8)', async () => {
    renderDrawer()
    expect(screen.getByText('新增默认采集配置')).toBeInTheDocument()
    expect(screen.getByText('资源类别')).toBeInTheDocument()
    expect(screen.getByText('监控对象类型')).toBeInTheDocument()
  })

  it('cascades monitor type by resource category and submits single monitor_type (F1-8)', async () => {
    createMock.mockResolvedValue({ status: 'success', data: { id: 1 } })
    renderDrawer()

    // 选中资源类别=数据库 → 监控对象类型下拉仅展示数据库类型，不含主机类型
    fireEvent.mouseDown(screen.getByText('请选择'))
    await selectAntdOption('数据库')
    fireEvent.mouseDown(screen.getByText('请选择监控对象类型'))
    expect(await screen.findByText('MySQL')).toBeInTheDocument()
    expect(screen.queryByText('Linux 主机')).toBeNull()

    // 选中 MySQL → 选择默认采集器 → 提交
    await selectAntdOption('MySQL')
    fireEvent.mouseDown(screen.getByText('选择采集器模板'))
    await selectAntdOption('mysql-exporter')

    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))

    await waitFor(() => expect(createMock).toHaveBeenCalled())
    const body = createMock.mock.calls[0][0] as Record<string, unknown>
    expect(body.monitor_type).toBe('mysql')
    expect(body.exporter_template_id).toBe('exp-1')
    // resource_category 仅用于表单级联，不进入提交载荷
    expect(body).not.toHaveProperty('resource_category')
  })

  it('echoes resource category derived from monitor_type and keeps fields disabled in edit mode (F1-8)', async () => {
    renderDrawer({
      id: 2,
      monitor_type: 'mysql',
      exporter_template_id: 'exp-1',
      is_default: true,
      default_port: 9104,
      metrics_path: '/metrics',
      scheme: 'http',
      scrape_interval: '15s',
      scrape_timeout: '10s',
    })

    expect(screen.getByText('编辑默认采集配置')).toBeInTheDocument()
    // 编辑态回显：由 monitor_type=mysql 反推资源类别=数据库、监控对象类型=MySQL
    expect(await screen.findByText('数据库')).toBeInTheDocument()
    expect(screen.getByText('MySQL')).toBeInTheDocument()
    // 编辑态两个 Select 均 disabled
    expect(screen.getByText('数据库').closest('.ant-select')?.className).toContain('ant-select-disabled')
    expect(screen.getByText('MySQL').closest('.ant-select')?.className).toContain('ant-select-disabled')
    // Q1b：编辑抽屉不再包含标签模板字段（入口收敛到「更换/补配」轻量抽屉）
    expect(screen.queryByText(/默认标签模板/)).toBeNull()
    // 快照语义提示：编辑默认采集配置只影响新建 Job、不影响已存 Job（PRD §5.4 保护存量）
    expect(screen.getByText('变更仅影响新建 Job，不影响已存在 Job')).toBeInTheDocument()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ResourceFormDrawer } from './ResourceFormDrawer'
import type { ResourceCategory } from '../../types/resource'
import type { NetworkDomain } from '../../types/domain'
import type { ResourceListItem } from './useResources'

const createMock = vi.fn()
const updateMock = vi.fn()
const networkDomainListMock = vi.fn()
const businessDomainListMock = vi.fn()
const osOptionListMock = vi.fn()

vi.mock('../../api/resources', () => ({
  resourceApi: {
    create: (...a: unknown[]) => createMock(...a),
    update: (...a: unknown[]) => updateMock(...a),
  },
  businessDomainApi: {
    list: (...a: unknown[]) => businessDomainListMock(...a),
  },
  osOptionApi: {
    list: (...a: unknown[]) => osOptionListMock(...a),
  },
}))

vi.mock('../../api/domain', () => ({
  networkDomainApi: {
    list: (...a: unknown[]) => networkDomainListMock(...a),
  },
}))

const cancelMock = vi.fn()
const successMock = vi.fn()

const networkDomain: NetworkDomain = {
  id: 'mc-a',
  name: '政务网A区',
  description: '',
  domain_type: 'edge',
  zone_type: 'internet',
  tenant_id: 'platform_admin',
  authorized_tenant_ids: ['platform_admin'],
  cmdb_cloud_area_id: '',
  cmdb_cloud_area_path: '',
  channel: 'local',
  is_monitored: false,
  status: 'enabled',
  created_at: '2026-08-21T00:00:00Z',
  updated_at: '2026-08-21T00:00:00Z',
}

const businessDomains = [
  { code: 'infra', name: '公共基础设施', description: '', enabled: true },
  { code: 'legacy', name: '停用业务', description: '', enabled: false },
]

function hostRecord(): ResourceListItem {
  return {
    resource_id: 'mc-res-1',
    resource_category: 'host',
    network_domain_id: 'mc-a',
    biz_code: 'infra',
    app_name: 'order',
    env: 'prod',
    cluster: 'c1',
    owner: 'chenrt',
    status: 'online',
    source_type: 'manual',
    instance_name: 'prod-web-01',
    hostname: 'prod-web-01.volc',
    instance_ip: '10.0.1.11',
    os_type: 'Linux',
  }
}

function renderDrawer(
  over: Partial<{
    open: boolean
    mode: 'create' | 'edit'
    category: ResourceCategory
    record: ResourceListItem | null
  }> = {},
) {
  const open = over.open ?? true
  const mode: 'create' | 'edit' = over.mode ?? 'create'
  const category = over.category ?? 'host'
  const record = over.record ?? null
  return render(
    <ResourceFormDrawer open={open} mode={mode} category={category} record={record} onCancel={cancelMock} onSuccess={successMock} />,
  )
}

/** 选择下拉：打开占位符为 placeholder 的 Select 并点击 option 文本 */
function openSelect(placeholder: string) {
  fireEvent.mouseDown(screen.getByText(placeholder))
}

/** 填必填共享字段 + host 差异化字段（网域/业务/环境/实例名/IP/操作系统，§5.6 os_type 必填） */
async function fillHostRequiredFields() {
  openSelect('请选择网域')
  fireEvent.click(await screen.findByText('政务网A区 (mc-a)'))
  openSelect('请选择业务')
  fireEvent.click(await screen.findByText('公共基础设施 (infra)'))
  openSelect('请选择环境')
  fireEvent.click(await screen.findByText('prod'))
  fireEvent.change(screen.getByPlaceholderText('例如：prod-web-01'), { target: { value: 'prod-web-01' } })
  fireEvent.change(screen.getByPlaceholderText('例如：10.0.1.11'), { target: { value: '10.0.1.11' } })
  fireEvent.change(getOsInput(), { target: { value: 'Ubuntu' } })
}

/**
 * 操作系统字段为 antd AutoComplete（内部渲染成 Select combobox 模式）：
 * placeholder 渲染为 div.ant-select-selection-placeholder 文本，输入框不带
 * placeholder 属性，故不能按 getByPlaceholderText 定位；AutoComplete 根节点
 * 带 .ant-select-auto-complete 类，可唯一定位其输入框。
 */
function getOsInput(): HTMLInputElement {
  const wrapper = document.querySelector<HTMLElement>('.ant-select-auto-complete')
  if (!wrapper) throw new Error('操作系统 AutoComplete 未渲染')
  const input = wrapper.querySelector<HTMLInputElement>('input')
  if (!input) throw new Error('操作系统 AutoComplete 缺少输入框')
  return input
}

describe('ResourceFormDrawer', () => {
  beforeEach(() => {
    createMock.mockReset()
    updateMock.mockReset()
    networkDomainListMock.mockReset()
    businessDomainListMock.mockReset()
    osOptionListMock.mockReset()
    cancelMock.mockReset()
    successMock.mockReset()
    networkDomainListMock.mockResolvedValue({
      status: 'success',
      data: { list: [networkDomain], total: 1, page: 1, page_size: 100 },
    })
    businessDomainListMock.mockResolvedValue({
      status: 'success',
      data: { list: businessDomains, total: 2 },
    })
    osOptionListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { name: 'Ubuntu', family: 'linux' },
          { name: 'CentOS', family: 'linux' },
          { name: 'Windows Server 2019', family: 'windows' },
        ],
      },
    })
  })

  it('submits create with shared + host fields and calls onSuccess/onCancel', async () => {
    createMock.mockResolvedValue({ status: 'success', data: {} })
    renderDrawer({ category: 'host' })
    await fillHostRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))
    await waitFor(() => expect(createMock).toHaveBeenCalled())
    const input = createMock.mock.calls[0][0]
    expect(input).toMatchObject({
      resource_category: 'host',
      network_domain_id: 'mc-a',
      biz_code: 'infra',
      env: 'prod',
      instance_name: 'prod-web-01',
      instance_ip: '10.0.1.11',
      os_type: 'Ubuntu',
      status: 'online',
    })
    expect(input).not.toHaveProperty('resource_id')
    expect(successMock).toHaveBeenCalled()
    expect(cancelMock).toHaveBeenCalled()
  })

  it('rejects submit when required fields are empty and shows field-level errors', async () => {
    renderDrawer({ category: 'host' })
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))
    // antd Form 校验错误为异步渲染，逐项用异步查询避免与校验完成时机竞态
    await waitFor(() => expect(screen.getByText('请选择网域')).toBeInTheDocument())
    expect(await screen.findByText('请选择业务')).toBeInTheDocument()
    expect(await screen.findByText('请选择环境')).toBeInTheDocument()
    expect(await screen.findByText('请输入实例名')).toBeInTheDocument()
    expect(await screen.findByText('请输入 IP 地址')).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('rejects invalid IPv4 address', async () => {
    renderDrawer({ category: 'host' })
    await fillHostRequiredFields()
    fireEvent.change(screen.getByPlaceholderText('例如：10.0.1.11'), { target: { value: '999.1.1.1' } })
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))
    await waitFor(() => expect(screen.getByText('请输入合法的 IPv4 地址')).toBeInTheDocument())
    expect(createMock).not.toHaveBeenCalled()
  })

  it('prevents duplicate submit while request in flight', async () => {
    createMock.mockReturnValue(new Promise(() => {}))
    renderDrawer({ category: 'host' })
    await fillHostRequiredFields()
    const submit = screen.getByRole('button', { name: /提\s*交/ })
    fireEvent.click(submit)
    fireEvent.click(submit)
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
  })

  it('shows backend error Alert on submit failure', async () => {
    createMock.mockRejectedValue(new Error('业务已停用，禁止新增资源'))
    renderDrawer({ category: 'host' })
    await fillHostRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))
    await waitFor(() => expect(screen.getByText('提交失败')).toBeInTheDocument())
    expect(screen.getByText('业务已停用，禁止新增资源')).toBeInTheDocument()
    expect(cancelMock).not.toHaveBeenCalled()
  })

  it('submits update with resource_id and without resource_category/source_type', async () => {
    updateMock.mockResolvedValue({ status: 'success', data: {} })
    renderDrawer({ mode: 'edit', category: 'host', record: hostRecord() })
    // 只读信息展示（§5.2 不可改字段）；「数据来源：手动录入」为同一 span 混合文本，用正则命中
    expect(await screen.findByText('mc-res-1')).toBeInTheDocument()
    expect(await screen.findByText(/手动录入/)).toBeInTheDocument()
    // 编辑态预填行字段
    expect((screen.getByPlaceholderText('例如：prod-web-01') as HTMLInputElement).value).toBe('prod-web-01')
    expect((screen.getByPlaceholderText('例如：10.0.1.11') as HTMLInputElement).value).toBe('10.0.1.11')
    // 修改 IP 后保存
    fireEvent.change(screen.getByPlaceholderText('例如：10.0.1.11'), { target: { value: '10.0.1.99' } })
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    expect(updateMock.mock.calls[0][0]).toBe('mc-res-1')
    const input = updateMock.mock.calls[0][1]
    expect(input).toMatchObject({ instance_ip: '10.0.1.99', network_domain_id: 'mc-a', biz_code: 'infra' })
    expect(input).not.toHaveProperty('resource_category')
    expect(input).not.toHaveProperty('source_type')
    expect(successMock).toHaveBeenCalled()
    expect(cancelMock).toHaveBeenCalled()
  })

  it('renders database differentiated fields for database category', async () => {
    renderDrawer({ category: 'database' })
    expect(screen.getByText('数据库类型')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('例如：3306')).toBeInTheDocument()
    expect(screen.queryByText('主机名')).toBeNull()
  })

  it('renders middleware differentiated fields for middleware category', async () => {
    renderDrawer({ category: 'middleware' })
    expect(screen.getByText('中间件类型')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('例如：9092')).toBeInTheDocument()
    expect(screen.queryByText('数据库类型')).toBeNull()
  })

  it('renders application and generic target differentiated fields', async () => {
    renderDrawer({ category: 'application' })
    expect(screen.getByText('服务名')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('例如：/api/v1/order')).toBeInTheDocument()

    // 重新渲染为 generic_target：目标名称 / 采集路径 / 自定义标签
    renderDrawer({ category: 'generic_target' })
    expect(screen.getByText('目标名称')).toBeInTheDocument()
    expect(screen.getByText('自定义标签')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('例如：region=cn-north;role=db')).toBeInTheDocument()
  })

  it('shows only enabled business domains in the select', async () => {
    renderDrawer({ category: 'host' })
    openSelect('请选择业务')
    expect(await screen.findByText('公共基础设施 (infra)')).toBeInTheDocument()
    expect(screen.queryByText('停用业务 (legacy)')).toBeNull()
  })

  it('submits generic target with custom_labels parsed into map', async () => {
    createMock.mockResolvedValue({ status: 'success', data: {} })
    renderDrawer({ category: 'generic_target' })
    openSelect('请选择网域')
    fireEvent.click(await screen.findByText('政务网A区 (mc-a)'))
    openSelect('请选择业务')
    fireEvent.click(await screen.findByText('公共基础设施 (infra)'))
    openSelect('请选择环境')
    fireEvent.click(await screen.findByText('prod'))
    fireEvent.change(screen.getByPlaceholderText('例如：node-exporter-cn-north'), {
      target: { value: 'node-exporter-cn-north' },
    })
    fireEvent.change(screen.getByPlaceholderText('例如：10.0.1.51 或 exporter.example.com'), {
      target: { value: 'exporter.example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('例如：region=cn-north;role=db'), {
      target: { value: 'region=cn-north;role=db' },
    })
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))
    await waitFor(() => expect(createMock).toHaveBeenCalled())
    const input = createMock.mock.calls[0][0]
    expect(input).toMatchObject({
      resource_category: 'generic_target',
      target_name: 'node-exporter-cn-north',
      instance_ip: 'exporter.example.com',
      scheme: 'http',
      custom_labels: { region: 'cn-north', role: 'db' },
    })
  })
})

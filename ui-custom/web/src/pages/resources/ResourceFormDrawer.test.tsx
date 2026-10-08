import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { ResourceFormDrawer } from './ResourceFormDrawer'
import type {
  AppPlatformRel,
  ApplicationDict,
  CloudDict,
  PlatformDict,
  ResourceCategory,
} from '../../types/resource'
import type { NetworkDomain } from '../../types/domain'
import type { ResourceListItem } from './useResources'

const createMock = vi.fn()
const updateMock = vi.fn()
const networkDomainListMock = vi.fn()
const businessDomainListMock = vi.fn()
// 字典类 mock 一律声明为无参 vi.fn()，默认返回值在 beforeEach 里 mockResolvedValue 给出——
// 若用 `vi.fn(() => Promise.resolve(...))` 声明，TS 会把 mock 推断成零参函数，
// 既 spread 不进 `(...a) => mock(...a)` 的代理，也把 resolved value 锁成 never。
const applicationDictListMock = vi.fn()
const cloudDictListMock = vi.fn()
// 决策 105：表单「服务编码」下拉经服务字典启用项解析（仅 application / generic_target 渲染）
const serviceDictListMock = vi.fn()
// 决策 110：「平台归属」下拉经平台字典启用项解析（资源行一等字段）
const platformDictListMock = vi.fn()
// 决策 111：应用↔平台 M:N 关联（app_platform_rel），应用下拉按所选平台过滤的数据源
const appPlatformRelListMock = vi.fn()
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
  // 决策 92：表单「应用」字段改为应用字典启用条目下拉
  applicationDictApi: {
    list: (...a: unknown[]) => applicationDictListMock(...a),
  },
  // 决策 105：表单「服务编码」下拉（仅 application / generic_target）
  serviceDictApi: {
    list: (...a: unknown[]) => serviceDictListMock(...a),
  },
  // 云字典 mock：决策 103 scheme-B 后资源表单不再消费云字典（无「云」录入项），
  // 此处保留仅为字典类 mock 的兼容性，不被本文件用例断言。
  cloudDictApi: {
    list: (...a: unknown[]) => cloudDictListMock(...a),
  },
  // 决策 110：「平台归属」下拉（仅启用条目）
  platformDictApi: {
    list: (...a: unknown[]) => platformDictListMock(...a),
  },
  // 决策 111：应用↔平台 M:N 关联，支撑「先选平台 → 应用按平台过滤」级联
  appPlatformRelApi: {
    list: (...a: unknown[]) => appPlatformRelListMock(...a),
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

/**
 * 平台字典（§5.21 / 决策 110：「平台归属」下拉仅列启用条目，停用平台禁止新引用）
 */
const platformDicts: PlatformDict[] = [
  { platform_code: 'ecommerce', platform_name: '电商平台', enabled: true },
  { platform_code: 'legacy-pf', platform_name: '旧平台', enabled: false },
]

/**
 * 应用字典（决策 92 / 110）：条目上的单值 `platform_code` 已废弃（决策 111 M:N），
 * 「平台归属」不在此处填写。
 */
const applicationDicts: ApplicationDict[] = [
  { app_code: 'order', app_name: '订单应用', status: 'enabled' },
  { app_code: 'billing', app_name: '计费应用', status: 'enabled' },
  { app_code: 'legacy-app', app_name: '停用应用', status: 'disabled' },
]

/** 应用↔平台关联（决策 111）：order 挂电商平台（主），billing 挂另一平台 */
const appPlatformRels: AppPlatformRel[] = [
  { rel_id: 'r-1', app_code: 'order', platform_code: 'ecommerce', is_primary: true, created_at: '' },
  { rel_id: 'r-2', app_code: 'billing', platform_code: 'finance', is_primary: true, created_at: '' },
]

/** 云字典（§5.20 / 决策 98：部署级只读；表单已不再消费，保留供字典 mock 兼容） */
const cloudDicts: CloudDict[] = [
  { cloud_code: 'PUB-TX', cloud_name: '腾讯云', cloud_type: 'PUB', carrier: 'TX', enabled: true },
  { cloud_code: 'OLD-TX', cloud_name: '已下线云', cloud_type: 'PUB', carrier: 'TX', enabled: false },
]

function hostRecord(): ResourceListItem {
  return {
    resource_id: 'mc-res-1',
    resource_category: 'host',
    network_domain_id: 'mc-a',
    biz_code: 'infra',
    app_code: 'order',
    // 决策 110：平台归属为资源行一等字段，编辑态应回显
    platform_code: 'ecommerce',
    env: 'prod',
    cluster: 'c1',
    owner: 'chenrt',
    status: 'online',
    source_type: 'manual',
    instance_name: 'prod-web-01',
    hostname: 'prod-web-01.volc',
    instance_ip: '10.0.1.11',
    os_type: 'Linux',
    cloud_code: 'PUB-TX',
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

/**
 * 打开**已选中值**为 selectedText 的 Select（切换场景用）。
 * 已选中的 Select 不再显示 placeholder，且其回显项与 dropdown option 同名，
 * 故按 .ant-select 根节点定位唯一容器，避免 findByText 命中多个。
 */
function openSelectBySelectedText(selectedText: string) {
  const root = Array.from(document.querySelectorAll<HTMLElement>('.ant-select')).find((el) =>
    (el.querySelector('.ant-select-selection-item')?.textContent ?? '') === selectedText,
  )
  if (!root) throw new Error(`未找到已选值为「${selectedText}」的 Select`)
  fireEvent.mouseDown(root)
}

/**
 * 等待抽屉打开时并发的字典请求（网域 / 业务 / 操作系统 / 应用 / 服务 / 平台 + app_platform_rel）到位。
 * 字典未 resolve 时下拉内无 option，故所有下拉交互前必须先 await 本函数。
 *
 * 不依赖任何 UI 状态（新增态看 placeholder、编辑态看回显值，都不稳），
 * 改为断言 mock 已被调用后用 act 冲刷 promise 链与 setState 渲染。
 */
async function waitForDicts() {
  await waitFor(() => {
    expect(networkDomainListMock).toHaveBeenCalled()
    expect(businessDomainListMock).toHaveBeenCalled()
    expect(platformDictListMock).toHaveBeenCalled()
    expect(appPlatformRelListMock).toHaveBeenCalled()
  })
  await act(async () => {
    await Promise.resolve()
  })
}

/** 填必填共享字段 + host 差异化字段（网域/业务/环境/运行状态/实例名/IP/操作系统，§5.6 os_type 必填） */
async function fillHostRequiredFields() {
  openSelect('请选择网域')
  fireEvent.click(await screen.findByText('政务网A区 (mc-a)'))
  openSelect('请选择业务')
  fireEvent.click(await screen.findByText('公共基础设施 (infra)'))
  openSelect('请选择环境')
  fireEvent.click(await screen.findByText('prod'))
  openSelect('请选择运行状态')
  fireEvent.click(await screen.findByText('在线'))
  // 决策 103 scheme-B：表单已无「云」录入项（云由所属网域派生）
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

/**
 * 读取所有 antd Select 的已选值展示文本。
 * antd 5 的已选项渲染为 `.ant-select-selection-item`（不带 title 属性，title 仅在
 * option 未命中 label 时用 value 兜底），故回显断言统一走这里而非 getByTitle。
 */
function selectedItemTexts(): string[] {
  return Array.from(document.querySelectorAll('.ant-select-selection-item')).map((el) => el.textContent ?? '')
}

describe('ResourceFormDrawer', () => {
  beforeEach(() => {
    createMock.mockReset()
    updateMock.mockReset()
    networkDomainListMock.mockReset()
    businessDomainListMock.mockReset()
    osOptionListMock.mockReset()
    cloudDictListMock.mockReset()
    platformDictListMock.mockReset()
    appPlatformRelListMock.mockReset()
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
    cloudDictListMock.mockResolvedValue({ status: 'success', data: { list: cloudDicts, total: 2 } })
    applicationDictListMock.mockResolvedValue({ status: 'success', data: { list: applicationDicts, total: 3 } })
    serviceDictListMock.mockReset()
    serviceDictListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0 } })
    platformDictListMock.mockResolvedValue({ status: 'success', data: { list: platformDicts, total: 2 } })
    appPlatformRelListMock.mockResolvedValue({ status: 'success', data: { list: appPlatformRels, total: 2 } })
  })

  // ---- 决策 110 / 118-4：平台归属录入 + 「平台 → 应用 → 服务」级联 ----

  it('决策 110：「平台归属」下拉取平台字典启用条目（停用平台不供新引用）', async () => {
    renderDrawer({ category: 'host' })
    await waitForDicts()
    openSelect('请选择平台归属（可选）')
    expect(await screen.findByText('电商平台 (ecommerce)')).toBeInTheDocument()
    // 停用平台不出现在可选下拉中
    expect(screen.queryByText('旧平台 (legacy-pf)')).toBeNull()
  })

  it('决策 110：编辑态回显资源行 platform_code，提交时原样带回', async () => {
    updateMock.mockResolvedValue({ status: 'success', data: {} })
    const rec = hostRecord()
    renderDrawer({ mode: 'edit', category: 'host', record: rec })
    // hostRecord().platform_code = 'ecommerce' → 选择器回显平台展示名
    await waitFor(() => expect(selectedItemTexts()).toContain('电商平台 (ecommerce)'))
    // 其余共享字段编辑态已由 record 回显，仅补录 host 差异化必填项
    fireEvent.change(screen.getByPlaceholderText('例如：prod-web-01'), { target: { value: 'prod-web-01' } })
    fireEvent.change(screen.getByPlaceholderText('例如：10.0.1.11'), { target: { value: '10.0.1.11' } })
    fireEvent.change(getOsInput(), { target: { value: 'Ubuntu' } })
    // 编辑态主按钮文案为「保存」（新增态为「提交」）
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    expect(updateMock.mock.calls[0][1]).toMatchObject({ platform_code: 'ecommerce' })
  })

  it('决策 110：登记时选中平台归属即写入 create 请求体', async () => {
    createMock.mockResolvedValue({ status: 'success', data: {} })
    renderDrawer({ category: 'host' })
    await waitForDicts()
    await fillHostRequiredFields()
    openSelect('请选择平台归属（可选）')
    fireEvent.click(await screen.findByText('电商平台 (ecommerce)'))
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))
    await waitFor(() => expect(createMock).toHaveBeenCalled())
    expect(createMock.mock.calls[0][0]).toMatchObject({ platform_code: 'ecommerce' })
  })

  it('决策 110：平台归属留空时不下发 platform_code（向后兼容纯自由文本路径）', async () => {
    createMock.mockResolvedValue({ status: 'success', data: {} })
    renderDrawer({ category: 'host' })
    await waitForDicts()
    await fillHostRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))
    await waitFor(() => expect(createMock).toHaveBeenCalled())
    expect(createMock.mock.calls[0][0].platform_code).toBeUndefined()
  })

  it('决策 110 ④：选中平台后应用下拉仅列出该平台关联的应用（决策 111 M:N）', async () => {
    renderDrawer({ category: 'host' })
    await waitForDicts()
    openSelect('请选择平台归属（可选）')
    fireEvent.click(await screen.findByText('电商平台 (ecommerce)'))
    // 级联提示随平台切换
    expect(await screen.findByText('仅列出关联到所选平台的应用；`app` 标签取编码，展示名由字典解析')).toBeInTheDocument()
    openSelect('请选择应用（可选）')
    // order 关联 ecommerce → 保留
    expect(await screen.findByText('订单应用 (order)')).toBeInTheDocument()
    // billing 关联 finance，不在 ecommerce → 被过滤
    expect(screen.queryByText('计费应用 (billing)')).toBeNull()
    // 停用应用恒不列出
    expect(screen.queryByText('停用应用 (legacy-app)')).toBeNull()
  })

  it('决策 110 ④：切换平台后已选应用不再归属新平台则一并清空（避免提交被自洽性校验拒绝）', async () => {
    platformDictListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { platform_code: 'ecommerce', platform_name: '电商平台', enabled: true },
          { platform_code: 'finance', platform_name: '财务平台', enabled: true },
          { platform_code: 'legacy-pf', platform_name: '旧平台', enabled: false },
        ],
        total: 3,
      },
    })
    renderDrawer({ category: 'host' })
    await waitForDicts()
    // 先选电商平台 + 订单应用
    openSelect('请选择平台归属（可选）')
    fireEvent.click(await screen.findByText('电商平台 (ecommerce)'))
    openSelect('请选择应用（可选）')
    fireEvent.click(await screen.findByText('订单应用 (order)'))
    await waitFor(() => expect(selectedItemTexts()).toContain('订单应用 (order)'))
    // 切换到财务平台：订单应用不归属 finance → 应用选择被清空
    openSelectBySelectedText('电商平台 (ecommerce)')
    fireEvent.click(await screen.findByText('财务平台 (finance)'))
    await waitFor(() => expect(selectedItemTexts()).not.toContain('订单应用 (order)'))
  })

  it('决策 112：服务编码下拉随所选应用过滤（应用↔服务 1:N 关系权威）', async () => {
    serviceDictListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { service_code: 'order-svc', service_name: '订单服务', app_code: 'order', enabled: true },
          { service_code: 'billing-svc', service_name: '计费服务', app_code: 'billing', enabled: true },
          { service_code: 'shared-svc', service_name: '公共组件', app_code: null, enabled: true },
        ],
        total: 3,
      },
    })
    renderDrawer({ category: 'application' })
    await waitForDicts()
    openSelect('请选择应用')
    fireEvent.click(await screen.findByText('订单应用 (order)'))
    openSelect('请选择服务编码（可选）')
    expect(await screen.findByText('订单服务 (order-svc)')).toBeInTheDocument()
    expect(screen.queryByText('计费服务 (billing-svc)')).toBeNull()
    // 无所属应用的游离服务不参与过滤，始终可选
    expect(screen.getByText('公共组件 (shared-svc)')).toBeInTheDocument()
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

  it('requires running status to be explicitly selected (no default) and passes chosen value through', async () => {
    createMock.mockResolvedValue({ status: 'success', data: {} })
    renderDrawer({ category: 'host' })
    // 填好其余必填项，唯独不选运行状态 → 触发必填校验「请选择运行状态」且不提交
    openSelect('请选择网域')
    fireEvent.click(await screen.findByText('政务网A区 (mc-a)'))
    openSelect('请选择业务')
    fireEvent.click(await screen.findByText('公共基础设施 (infra)'))
    openSelect('请选择环境')
    fireEvent.click(await screen.findByText('prod'))
    // 决策 103 scheme-B：表单已无「云」录入项（云由所属网域派生）
    fireEvent.change(screen.getByPlaceholderText('例如：prod-web-01'), { target: { value: 'prod-web-01' } })
    fireEvent.change(screen.getByPlaceholderText('例如：10.0.1.11'), { target: { value: '10.0.1.11' } })
    // §5.6 操作系统必填（AutoComplete combobox 模式）
    fireEvent.change(getOsInput(), { target: { value: 'Ubuntu' } })
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))
    await waitFor(() => expect(screen.getByText('请选择运行状态')).toBeInTheDocument())
    expect(createMock).not.toHaveBeenCalled()
    // 显式选择「离线」后提交 → payload.status = offline（非默认 online）
    openSelect('请选择运行状态')
    fireEvent.click(await screen.findByText('离线'))
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))
    await waitFor(() => expect(createMock).toHaveBeenCalled())
    expect(createMock.mock.calls[0][0]).toMatchObject({ status: 'offline' })
    expect(successMock).toHaveBeenCalled()
  })

  it('rejects submit when required fields are empty and shows field-level errors', async () => {
    renderDrawer({ category: 'host' })
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))
    // antd Form 校验错误为异步渲染，逐项用异步查询避免与校验完成时机竞态
    await waitFor(() =>
      expect(screen.getByText('请选择网域', { selector: '.ant-form-item-explain-error' })).toBeInTheDocument(),
    )
    expect(await screen.findByText('请选择业务', { selector: '.ant-form-item-explain-error' })).toBeInTheDocument()
    expect(await screen.findByText('请选择环境', { selector: '.ant-form-item-explain-error' })).toBeInTheDocument()
    // 「运行状态」PRD 必填、无默认值，placeholder 与校验文案同名；用 selector 定位错误元素断言
    expect(await screen.findByText('请选择运行状态', { selector: '.ant-form-item-explain-error' })).toBeInTheDocument()
    expect(await screen.findByText('请输入实例名', { selector: '.ant-form-item-explain-error' })).toBeInTheDocument()
    expect(await screen.findByText('请输入 IP 地址', { selector: '.ant-form-item-explain-error' })).toBeInTheDocument()
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
    // 采集地址拆分：健康检查 URL（可选）/ 端点 + 端口（采集地址，必填）
    expect(screen.getByText('健康检查 URL')).toBeInTheDocument()
    expect(screen.getByText('端点（采集地址主机）')).toBeInTheDocument()
    expect(screen.getByText('端口（采集端口）')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('例如：10.10.1.4')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('例如：8081')).toBeInTheDocument()

    // 重新渲染为 generic_target：目标名称 / 采集路径 / 自定义标签
    renderDrawer({ category: 'generic_target' })
    expect(screen.getByText('目标名称')).toBeInTheDocument()
    expect(screen.getByText('自定义标签')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('如 device_type=snmp_switch;vendor=h3c')).toBeInTheDocument()
  })

  // 采集地址拆分（M07 字段治理）：application 的端点（主机）+ 端口（采集端口）均必填；
  // health_check_url 恢复为「应用实际访问地址」语义，可选、不参与采集。
  it('application requires endpoint and port (采集地址拆分)', async () => {
    renderDrawer({ category: 'application' })
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))
    // 端点 / 端口为空 → 必填校验拦截且不提交
    await waitFor(() =>
      expect(screen.getByText('请输入采集地址主机', { selector: '.ant-form-item-explain-error' })).toBeInTheDocument(),
    )
    expect(await screen.findByText('请输入端口', { selector: '.ant-form-item-explain-error' })).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('submits application with endpoint + port and omits empty health_check_url', async () => {
    createMock.mockResolvedValue({ status: 'success', data: {} })
    // 应用类别 app_code 必填，需字典启用条目（§5.2）
    applicationDictListMock.mockResolvedValue({
      status: 'success',
      data: { list: [{ app_code: 'order', app_name: '订单服务', status: 'enabled' }], total: 1 },
    })
    renderDrawer({ category: 'application' })
    openSelect('请选择网域')
    fireEvent.click(await screen.findByText('政务网A区 (mc-a)'))
    openSelect('请选择业务')
    fireEvent.click(await screen.findByText('公共基础设施 (infra)'))
    openSelect('请选择环境')
    fireEvent.click(await screen.findByText('prod'))
    openSelect('请选择运行状态')
    fireEvent.click(await screen.findByText('在线'))
    openSelect('请选择应用')
    fireEvent.click(await screen.findByText('订单服务 (order)'))
    fireEvent.change(screen.getByPlaceholderText('例如：order-service'), { target: { value: 'pay-service' } })
    fireEvent.change(screen.getByPlaceholderText('例如：10.10.1.4'), { target: { value: '10.10.1.4' } })
    fireEvent.change(screen.getByPlaceholderText('例如：8081'), { target: { value: '8081' } })
    // health_check_url 留空 → 可提交，且不写入请求体
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))
    await waitFor(() => expect(createMock).toHaveBeenCalled())
    const input = createMock.mock.calls[0][0]
    expect(input).toMatchObject({
      resource_category: 'application',
      service_name: 'pay-service',
      endpoint: '10.10.1.4',
      port: 8081,
    })
    expect(input.health_check_url).toBeUndefined()
    expect(successMock).toHaveBeenCalled()
    expect(cancelMock).toHaveBeenCalled()
  })

  it('rejects invalid health_check_url format but keeps it optional', async () => {
    renderDrawer({ category: 'application' })
    fireEvent.change(screen.getByPlaceholderText('例如：http://10.10.1.4:8081/actuator/health'), {
      target: { value: 'not-a-url' },
    })
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))
    await waitFor(() => expect(screen.getByText('请输入合法的 http/https 地址')).toBeInTheDocument())
    expect(createMock).not.toHaveBeenCalled()
  })

  // 采集地址字段仅出现于类别 = 应用（host 表单无端点/健康检查 URL）
  it('does not show application-only fields for non-application category', async () => {
    renderDrawer({ category: 'host' })
    expect(screen.queryByText('健康检查 URL')).toBeNull()
    expect(screen.queryByText('端点（采集地址主机）')).toBeNull()
    expect(screen.queryByText('端口（采集端口）')).toBeNull()
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
    openSelect('请选择运行状态')
    fireEvent.click(await screen.findByText('在线'))
    fireEvent.change(screen.getByPlaceholderText('如 核心交换-01'), {
      target: { value: 'node-exporter-cn-north' },
    })
    fireEvent.change(screen.getByPlaceholderText('如 172.16.0.1'), {
      target: { value: 'exporter.example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('如 device_type=snmp_switch;vendor=h3c'), {
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

  it('prefills 采集路径=/metrics and 协议=http for generic_target create', async () => {
    createMock.mockResolvedValue({ status: 'success', data: {} })
    renderDrawer({ category: 'generic_target' })
    // 采集路径默认预填 /metrics；协议默认 http
    expect((screen.getByPlaceholderText('/metrics') as HTMLInputElement).value).toBe('/metrics')
    // 填必填共享字段 + 其他监控目标必填项后提交
    openSelect('请选择网域')
    fireEvent.click(await screen.findByText('政务网A区 (mc-a)'))
    openSelect('请选择业务')
    fireEvent.click(await screen.findByText('公共基础设施 (infra)'))
    openSelect('请选择环境')
    fireEvent.click(await screen.findByText('prod'))
    openSelect('请选择运行状态')
    fireEvent.click(await screen.findByText('在线'))
    fireEvent.change(screen.getByPlaceholderText('如 核心交换-01'), { target: { value: 'core-sw-01' } })
    fireEvent.change(screen.getByPlaceholderText('如 172.16.0.1'), { target: { value: '172.16.0.1' } })
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))
    await waitFor(() => expect(createMock).toHaveBeenCalled())
    expect(createMock.mock.calls[0][0]).toMatchObject({ metrics_path: '/metrics', scheme: 'http' })
  })

  it('renders generic_target extra hints for port and exporter_type', async () => {
    renderDrawer({ category: 'generic_target' })
    expect(screen.getByText('留空时不生成实例标识（instance）')).toBeInTheDocument()
    expect(screen.getByText('如 snmp_exporter / gpu_exporter / oracle_exporter')).toBeInTheDocument()
  })

  it('renders generic_target IP label and required message', async () => {
    renderDrawer({ category: 'generic_target' })
    expect(screen.getByText('目标 IP / 域名')).toBeInTheDocument()
    // 未填 IP 直接提交，触发必填校验 message
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))
    await waitFor(() => expect(screen.getByText('请输入目标 IP 或域名')).toBeInTheDocument())
    expect(createMock).not.toHaveBeenCalled()
  })

  // #19 通病（v1.35 规范）：antd Drawer 首次打开时内容惰性挂载（rc-drawer 动画期晚于
  // useEffect(open) 的 setFieldsValue），字段注册前 setFieldsValue 被吞、编辑回显首次为空；
  // forceRender 保证 Form 常驻挂载后，关闭→打开切换（刷新后首次点「编辑」）即正确回显。
  // 决策 103 scheme-B：云由资源所属网域派生（列表 / 详情只读呈现），资源表单不再提供
  // 「云」录入项——既无下拉、也不再拉取云字典（原决策 98/102 的「必填分化」口径作废）。
  it('决策 103 scheme-B：资源表单不提供「云」录入项（云由所属网域派生）', async () => {
    renderDrawer({ category: 'host' })
    await waitFor(() => expect(screen.getByText('请选择网域')).toBeInTheDocument())
    expect(screen.queryByText('请选择云')).toBeNull()
    expect(screen.queryByText('请选择云（可选）')).toBeNull()
    // 决策 102-③ 精神延续：云随部署预置、全局只读，表单无任何「新建云」入口
    expect(screen.queryByText(/新建云|创建云|登记云/)).toBeNull()
  })

  it('决策 103 scheme-B：generic_target 提交体不含 cloud_code（云不经资源写链路）', async () => {
    createMock.mockResolvedValue({ status: 'success', data: {} })
    // 决策 103 scheme-B：填其余必填项即可提交，请求体不再携带 cloud_code
    renderDrawer({ category: 'generic_target' })
    openSelect('请选择网域')
    fireEvent.click(await screen.findByText('政务网A区 (mc-a)'))
    openSelect('请选择业务')
    fireEvent.click(await screen.findByText('公共基础设施 (infra)'))
    openSelect('请选择环境')
    fireEvent.click(await screen.findByText('prod'))
    openSelect('请选择运行状态')
    fireEvent.click(await screen.findByText('在线'))
    fireEvent.change(screen.getByPlaceholderText('如 核心交换-01'), { target: { value: 'core-sw-01' } })
    fireEvent.change(screen.getByPlaceholderText('如 172.16.0.1'), { target: { value: '172.16.0.1' } })
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))
    await waitFor(() => expect(createMock).toHaveBeenCalled())
    expect(createMock.mock.calls[0][0]).toMatchObject({ resource_category: 'generic_target' })
    expect(createMock.mock.calls[0][0].cloud_code).toBeUndefined()
  })

  it('决策 103 scheme-B：host 提交体不含 cloud_code（云由所属网域派生）', async () => {
    createMock.mockResolvedValue({ status: 'success', data: {} })
    renderDrawer({ category: 'host' })
    await fillHostRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))
    await waitFor(() => expect(createMock).toHaveBeenCalled())
    const payload = createMock.mock.calls[0][0] as Record<string, unknown>
    expect(payload.cloud_code).toBeUndefined()
    expect(Object.keys(payload)).not.toContain('cloud_code')
  })

  it('决策 103 scheme-B：编辑态不再回填 cloud_code（无该表单项）', async () => {
    renderDrawer({ mode: 'edit', category: 'host', record: hostRecord() })
    // 以实例名回填完成作为「编辑态字段已装载」的信号（网域/运行状态回填后不再显示 placeholder）
    expect(await screen.findByDisplayValue('prod-web-01')).toBeInTheDocument()
    // 云值由所属网域派生，表单无任何「云」录入项，故不再回填 cloud_code
    expect(screen.queryByText('腾讯云 (PUB-TX)')).toBeNull()
    expect(screen.queryByText('请选择云')).toBeNull()
  })

  it('edit mode echoes fields on first open (closed → open switch)', async () => {
    const { rerender } = render(
      <ResourceFormDrawer
        open={false}
        mode="edit"
        category="host"
        record={hostRecord()}
        onCancel={cancelMock}
        onSuccess={successMock}
      />,
    )
    rerender(
      <ResourceFormDrawer
        open
        mode="edit"
        category="host"
        record={hostRecord()}
        onCancel={cancelMock}
        onSuccess={successMock}
      />,
    )
    // 首次打开即回显实例名/主机名/IP，而非空表单
    expect(await screen.findByDisplayValue('prod-web-01')).toBeInTheDocument()
    expect(screen.getByDisplayValue('prod-web-01.volc')).toBeInTheDocument()
    expect(screen.getByDisplayValue('10.0.1.11')).toBeInTheDocument()
  })
})

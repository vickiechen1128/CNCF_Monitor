import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DomainDrawer } from './DomainForm'
import type { NetworkDomain, ZoneType } from '../../../types/domain'
import type { CloudDict } from '../../../types/resource'
import { setupAntdTest, mockAntdModal } from '../../../test/antdTestUtils'

const createMock = vi.fn()
const updateMock = vi.fn()
const zoneTypeListMock = vi.fn()
const tenantListMock = vi.fn()
const cloudDictListMock = vi.fn()

vi.mock('../../../api/domain', () => ({
  networkDomainApi: { create: (...a: unknown[]) => createMock(...a), update: (...a: unknown[]) => updateMock(...a) },
  zoneTypeApi: { list: (...a: unknown[]) => zoneTypeListMock(...a) },
  tenantApi: { list: (...a: unknown[]) => tenantListMock(...a) },
}))

// 云归属下拉数据源（云字典只读接口，M06 §5.2 / M07 §5.20）
vi.mock('../../../api/resources', () => ({
  cloudDictApi: { list: (...a: unknown[]) => cloudDictListMock(...a) },
}))

const zoneType: ZoneType = {
  id: 1,
  code: 'internet',
  display_name: '互联网区',
  description: '',
  enabled: true,
  created_at: '',
  updated_at: '',
}

const enabledCloudTx: CloudDict = {
  cloud_code: 'PUB-TX',
  cloud_name: '腾讯云',
  cloud_type: 'PUB',
  carrier: 'TX',
  enabled: true,
}
const enabledCloudHw: CloudDict = {
  cloud_code: 'PUB-HW',
  cloud_name: '华为云',
  cloud_type: 'PUB',
  carrier: 'HW',
  enabled: true,
}
// 停用条目：云归属下拉不得展示
const disabledCloud: CloudDict = {
  cloud_code: 'PRI-OLD',
  cloud_name: '旧私有云',
  cloud_type: 'PRI',
  carrier: 'OLD',
  enabled: false,
}

const editDomain: NetworkDomain = {
  id: 'mc-a',
  name: '政务网A区',
  description: '旧描述',
  domain_type: 'edge',
  cloud_code: 'PUB-TX',
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

function renderDrawer(over: Partial<{ open: boolean; mode: 'create' | 'edit'; domain: NetworkDomain | null }> = {}) {
  const open = over.open ?? true
  const mode: 'create' | 'edit' = over.mode ?? 'create'
  const domain = over.domain ?? null
  return render(
    <DomainDrawer open={open} mode={mode} domain={domain} onCancel={cancelMock} onSuccess={successMock} />,
  )
}

/** 点击自检双选择卡中的一项（按标题文案定位） */
function pickDirect(label: string) {
  const radio = screen.getByText(label).closest('[role="radio"]')
  fireEvent.click(radio as HTMLElement)
}

/** 选择指定文案的 antd Select 选项（点击打开面板 → 等待选项 → 点击） */
async function pickOption(label: string, optionText: string) {
  const user = userEvent.setup()
  await user.click(screen.getByLabelText(label))
  await user.click(await screen.findByText(optionText))
}

/**
 * 按 FormSection 的分组标题取出各分组容器（标题左侧品牌色竖条宽 3px 为稳定判别特征）。
 * 用于断言字段归属的新分组（dev-feedback #18 方案 A）。
 */
function formSections(): { title: string; root: HTMLElement }[] {
  const bars = Array.from(document.querySelectorAll('span')).filter(
    (s) => (s as HTMLElement).style.width === '3px',
  )
  return bars.map((bar) => {
    const header = bar.parentElement as HTMLElement
    const root = header.parentElement as HTMLElement
    const title = header.querySelector('.ant-typography')?.textContent ?? ''
    return { title, root }
  })
}

const cancelMock = vi.fn()
const successMock = vi.fn()

describe('DomainDrawer（网域登记/编辑抽屉）', () => {
  setupAntdTest()

  beforeEach(() => {
    createMock.mockReset()
    updateMock.mockReset()
    zoneTypeListMock.mockReset()
    tenantListMock.mockReset()
    cloudDictListMock.mockReset()
    cancelMock.mockReset()
    successMock.mockReset()
    zoneTypeListMock.mockResolvedValue({ status: 'success', data: [zoneType] })
    tenantListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 100 } })
    cloudDictListMock.mockResolvedValue({
      status: 'success',
      data: { list: [enabledCloudTx, enabledCloudHw, disabledCloud], total: 3 },
    })
  })

  it('登记态默认：未选自检前表单主体不展开、确认按钮禁用（决策79硬劝阻前置）', async () => {
    renderDrawer()
    // 表单主体（网域名称）未展开
    expect(screen.queryByPlaceholderText('例如：政务网 A 区')).toBeNull()
    expect(screen.getByRole('button', { name: /确认登记/ })).toBeDisabled()
  })

  it('登记态选「能」→ 硬劝阻 Callout，表单不展开、按钮仍禁用', async () => {
    renderDrawer()
    pickDirect('中心能直接访问')
    expect(await screen.findByText('无需登记网域，请关闭本窗口')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('例如：政务网 A 区')).toBeNull()
    expect(screen.getByRole('button', { name: /确认登记/ })).toBeDisabled()
  })

  it('登记态选「不能」→ 展开表单主体、极简采集节点说明、按钮可用', async () => {
    renderDrawer()
    pickDirect('中心访问不到')
    expect(
      await screen.findByText(/采集节点域：登记后由该网域内一台常开机器上的采集节点单向回传数据至中心/)
    ).toBeInTheDocument()
    expect(screen.getByPlaceholderText('例如：政务网 A 区')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /确认登记/ })).toBeEnabled()
  })

  it('提交登记：携带 cloud_code / zone_type / ip_cidrs 数组、不含 tenant_id，成功后 onSuccess+onCancel', async () => {
    createMock.mockResolvedValue({ status: 'success', data: editDomain })
    renderDrawer()
    pickDirect('中心访问不到')
    fireEvent.change(await screen.findByPlaceholderText('例如：政务网 A 区'), { target: { value: '政务网A区' } })
    fireEvent.change(screen.getByPlaceholderText(/逗号分隔，掩码必填/), {
      target: { value: '10.20.0.0/16, 10.30.0.0/24' },
    })
    await pickOption('云归属', '腾讯云')
    await pickOption('网络分区', '互联网区')
    fireEvent.click(screen.getByRole('button', { name: /确认登记/ }))
    await waitFor(() => expect(createMock).toHaveBeenCalled())
    const input = createMock.mock.calls[0][0]
    expect(input).toMatchObject({
      name: '政务网A区',
      domain_type: 'edge',
      cloud_code: 'PUB-TX',
      zone_type: 'internet',
      ip_cidrs: ['10.20.0.0/16', '10.30.0.0/24'],
    })
    expect(input).not.toHaveProperty('tenant_id')
    expect(successMock).toHaveBeenCalled()
    expect(cancelMock).toHaveBeenCalled()
  })

  it('云归属下拉数据来自 cloudDictApi 且仅展示启用条目', async () => {
    renderDrawer()
    pickDirect('中心访问不到')
    await screen.findByPlaceholderText('例如：政务网 A 区')
    const user = userEvent.setup()
    await user.click(screen.getByLabelText('云归属'))
    expect(await screen.findByText('腾讯云')).toBeInTheDocument()
    expect(screen.getByText('华为云')).toBeInTheDocument()
    // 停用条目不得出现在下拉
    expect(screen.queryByText('旧私有云')).toBeNull()
    expect(cloudDictListMock).toHaveBeenCalled()
  })

  it('云归属为必填：未选择时提交被拦截，不发起创建请求', async () => {
    renderDrawer()
    pickDirect('中心访问不到')
    fireEvent.change(await screen.findByPlaceholderText('例如：政务网 A 区'), { target: { value: '政务网A区' } })
    await pickOption('网络分区', '互联网区')
    fireEvent.click(screen.getByRole('button', { name: /确认登记/ }))
    expect(await screen.findByText('请选择云归属')).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('网络分区为必填：未选择时提交被拦截，不发起创建请求', async () => {
    renderDrawer()
    pickDirect('中心访问不到')
    fireEvent.change(await screen.findByPlaceholderText('例如：政务网 A 区'), { target: { value: '政务网A区' } })
    await pickOption('云归属', '腾讯云')
    fireEvent.click(screen.getByRole('button', { name: /确认登记/ }))
    expect(await screen.findByText('请选择网络分区')).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('编辑态：直接渲染主体，提交用 id 且不含 tenant_id / cloud_code（无二次确认）', async () => {
    updateMock.mockResolvedValue({ status: 'success', data: editDomain })
    const modal = mockAntdModal()
    renderDrawer({ mode: 'edit', domain: editDomain })
    await screen.findByPlaceholderText('例如：政务网 A 区')
    fireEvent.change(screen.getByPlaceholderText('例如：政务网 A 区'), { target: { value: '政务网A区-改' } })
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    expect(modal.confirm).not.toHaveBeenCalled()
    expect(updateMock.mock.calls[0][0]).toBe(editDomain.id)
    const input = updateMock.mock.calls[0][1]
    expect(input).toMatchObject({ name: '政务网A区-改' })
    // MVP 收口：编辑入参不承载云归属
    expect(input).not.toHaveProperty('cloud_code')
    expect(input).not.toHaveProperty('tenant_id')
    expect(createMock).not.toHaveBeenCalled()
  })

  it('编辑态：云归属只读展示 cloud_name、不可编辑并给出提示（不再有迁云二次确认）', async () => {
    const modal = mockAntdModal()
    renderDrawer({ mode: 'edit', domain: editDomain })
    await screen.findByPlaceholderText('例如：政务网 A 区')
    // 只读展示云名（经云字典解析 cloud_code），且为 disabled 输入
    const cloudInput = (await screen.findByDisplayValue('腾讯云')) as HTMLInputElement
    expect(cloudInput).toBeDisabled()
    // 编辑态不渲染可选云归属下拉
    expect(screen.queryByLabelText('云归属')).toBeNull()
    expect(
      await screen.findByText('网域云归属登记后不可修改；如需跨云请新登记网域'),
    ).toBeInTheDocument()
    expect(modal.confirm).not.toHaveBeenCalled()
  })

  it('抽屉分组（方案 A）：授权独立成组、网络分区+网段归「网络与分区」、云归属留在「行政信息」', async () => {
    renderDrawer({ mode: 'edit', domain: editDomain })
    await screen.findByPlaceholderText('例如：政务网 A 区')

    const sections = formSections()
    // 分组顺序：行政归属 → 网络拓扑 → 授权 → 描述
    expect(sections.map((s) => s.title)).toEqual(['行政信息', '网络与分区', '授权', '描述'])
    // 旧组标题不再存在
    expect(screen.queryByText('授权与分区')).toBeNull()
    expect(screen.queryByText('网络与描述')).toBeNull()

    const byTitle = (t: string) => sections.find((s) => s.title === t)!.root
    // 云归属保留在「行政信息」（编辑态只读展示 cloud_name）
    expect(within(byTitle('行政信息')).getByDisplayValue('腾讯云')).toBeInTheDocument()
    // 网络分区 + 网段（CIDR）归入「网络与分区」
    expect(within(byTitle('网络与分区')).getByLabelText('网络分区')).toBeInTheDocument()
    expect(within(byTitle('网络与分区')).getByPlaceholderText(/逗号分隔，掩码必填/)).toBeInTheDocument()
    // 授权租户从原组独立为「授权」组
    expect(within(byTitle('授权')).getByLabelText('授权租户')).toBeInTheDocument()
    // 描述单独收尾
    expect(within(byTitle('描述')).getByLabelText('描述')).toBeInTheDocument()
  })

  it('登记态：非法的网段（如 1.111.11111.1/0）阻止提交并给出格式提示', async () => {
    renderDrawer()
    pickDirect('中心访问不到')
    fireEvent.change(await screen.findByPlaceholderText('例如：政务网 A 区'), { target: { value: '政务网A区' } })
    fireEvent.change(screen.getByPlaceholderText(/逗号分隔，掩码必填/), {
      target: { value: '10.20.0.0/16, 1.111.11111.1/0' },
    })
    fireEvent.click(screen.getByRole('button', { name: /确认登记/ }))
    expect(await screen.findByText(/网段格式不合法.*1\.111\.11111\.1\/0/)).toBeInTheDocument()
    // 校验失败 -> 不提交
    expect(createMock).not.toHaveBeenCalled()
  })
})
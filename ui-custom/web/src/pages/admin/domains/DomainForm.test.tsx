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
  code: 'internet',
  display_name: '互联网区',
  enabled: true,
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
  channel: 'agent_pull',
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

/** 选择指定文案的 antd Select 选项（点击打开面板 → 等待选项 → 点击） */
async function pickOption(label: string, optionText: string) {
  const user = userEvent.setup()
  await user.click(screen.getByLabelText(label))
  await user.click(await screen.findByText(optionText))
}

/**
 * 按 FormSection 的分组标题取出各分组容器（标题左侧品牌色竖条宽 3px 为稳定判别特征）。
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

  it('登记态：直接渲染表单主体，接入方式固定采集节点域', async () => {
    renderDrawer()
    expect(await screen.findByPlaceholderText('例如：政务网 A 区')).toBeInTheDocument()
    expect(screen.getByDisplayValue('采集节点域')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /确认登记/ })).toBeEnabled()
  })

  it('提交登记：携带 cloud_code / zone_type，不含 tenant_id / domain_type / ip_cidrs', async () => {
    createMock.mockResolvedValue({ status: 'success', data: editDomain })
    renderDrawer()
    fireEvent.change(await screen.findByPlaceholderText('例如：政务网 A 区'), {
      target: { value: '政务网A区' },
    })
    await pickOption('云归属', '腾讯云')
    await pickOption('网络分区', '互联网区')
    fireEvent.click(screen.getByRole('button', { name: /确认登记/ }))
    await waitFor(() => expect(createMock).toHaveBeenCalled())
    const input = createMock.mock.calls[0][0]
    expect(input).toEqual({
      name: '政务网A区',
      cloud_code: 'PUB-TX',
      zone_type: 'internet',
      authorized_tenant_ids: ['platform_admin'],
    })
    expect(input).not.toHaveProperty('tenant_id')
    expect(input).not.toHaveProperty('domain_type')
    expect(input).not.toHaveProperty('ip_cidrs')
    expect(successMock).toHaveBeenCalled()
    expect(cancelMock).toHaveBeenCalled()
  })

  it('云归属下拉数据来自 cloudDictApi 且仅展示启用条目', async () => {
    renderDrawer()
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
    fireEvent.change(await screen.findByPlaceholderText('例如：政务网 A 区'), {
      target: { value: '政务网A区' },
    })
    await pickOption('网络分区', '互联网区')
    fireEvent.click(screen.getByRole('button', { name: /确认登记/ }))
    expect(await screen.findByText('请选择云归属')).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('网络分区为必填：未选择时提交被拦截，不发起创建请求', async () => {
    renderDrawer()
    fireEvent.change(await screen.findByPlaceholderText('例如：政务网 A 区'), {
      target: { value: '政务网A区' },
    })
    await pickOption('云归属', '腾讯云')
    fireEvent.click(screen.getByRole('button', { name: /确认登记/ }))
    expect(await screen.findByText('请选择网络分区')).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('编辑态：直接渲染主体，提交用 id 且不含 tenant_id / cloud_code', async () => {
    updateMock.mockResolvedValue({ status: 'success', data: editDomain })
    const modal = mockAntdModal()
    renderDrawer({ mode: 'edit', domain: editDomain })
    await screen.findByPlaceholderText('例如：政务网 A 区')
    fireEvent.change(screen.getByPlaceholderText('例如：政务网 A 区'), {
      target: { value: '政务网A区-改' },
    })
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    expect(modal.confirm).not.toHaveBeenCalled()
    expect(updateMock.mock.calls[0][0]).toBe(editDomain.id)
    const input = updateMock.mock.calls[0][1]
    expect(input).toMatchObject({ name: '政务网A区-改' })
    // 编辑入参不承载云归属 / 归属租户
    expect(input).not.toHaveProperty('cloud_code')
    expect(input).not.toHaveProperty('tenant_id')
    expect(createMock).not.toHaveBeenCalled()
  })

  it('编辑态：云归属只读展示 cloud_name、不可编辑并给出提示', async () => {
    const modal = mockAntdModal()
    renderDrawer({ mode: 'edit', domain: editDomain })
    await screen.findByPlaceholderText('例如：政务网 A 区')
    const cloudInput = (await screen.findByDisplayValue('腾讯云')) as HTMLInputElement
    expect(cloudInput).toBeDisabled()
    // 编辑态不渲染可选云归属下拉
    expect(screen.queryByLabelText('云归属')).toBeNull()
    expect(
      await screen.findByText('网域云归属登记后不可修改；如需跨云请新登记网域'),
    ).toBeInTheDocument()
    expect(modal.confirm).not.toHaveBeenCalled()
  })

  it('抽屉分组：授权独立成组、网络分区归「网络与分区」、云归属留在「行政信息」', async () => {
    renderDrawer({ mode: 'edit', domain: editDomain })
    await screen.findByPlaceholderText('例如：政务网 A 区')

    const sections = formSections()
    expect(sections.map((s) => s.title)).toEqual(['行政信息', '网络与分区', '授权', '描述'])
    expect(screen.queryByText('授权与分区')).toBeNull()
    expect(screen.queryByText('网络与描述')).toBeNull()

    const byTitle = (t: string) => sections.find((s) => s.title === t)!.root
    expect(within(byTitle('行政信息')).getByDisplayValue('腾讯云')).toBeInTheDocument()
    expect(within(byTitle('网络与分区')).getByLabelText('网络分区')).toBeInTheDocument()
    expect(within(byTitle('授权')).getByLabelText('授权租户')).toBeInTheDocument()
    expect(within(byTitle('描述')).getByLabelText('描述')).toBeInTheDocument()
  })
})

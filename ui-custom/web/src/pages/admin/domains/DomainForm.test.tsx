import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DomainDrawer } from './DomainForm'
import type { NetworkDomain, ZoneType } from '../../../types/domain'

const createMock = vi.fn()
const updateMock = vi.fn()
const zoneTypeListMock = vi.fn()
const tenantListMock = vi.fn()

vi.mock('../../../api/domain', () => ({
  networkDomainApi: { create: (...a: unknown[]) => createMock(...a), update: (...a: unknown[]) => updateMock(...a) },
  zoneTypeApi: { list: (...a: unknown[]) => zoneTypeListMock(...a) },
  tenantApi: { list: (...a: unknown[]) => tenantListMock(...a) },
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

const editDomain: NetworkDomain = {
  id: 'mc-a',
  name: '政务网A区',
  description: '旧描述',
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

const cancelMock = vi.fn()
const successMock = vi.fn()

describe('DomainDrawer（网域登记/编辑抽屉）', () => {
  beforeEach(() => {
    createMock.mockReset()
    updateMock.mockReset()
    zoneTypeListMock.mockReset()
    tenantListMock.mockReset()
    cancelMock.mockReset()
    successMock.mockReset()
    zoneTypeListMock.mockResolvedValue({ status: 'success', data: [zoneType] })
    tenantListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 100 } })
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

  it('提交登记：携带 ip_cidrs 数组、不含 tenant_id，成功后 onSuccess+onCancel', async () => {
    createMock.mockResolvedValue({ status: 'success', data: editDomain })
    renderDrawer()
    pickDirect('中心访问不到')
    fireEvent.change(await screen.findByPlaceholderText('例如：政务网 A 区'), { target: { value: '政务网A区' } })
    fireEvent.change(screen.getByPlaceholderText(/逗号分隔，掩码必填/), {
      target: { value: '10.20.0.0/16, 10.30.0.0/24' },
    })
    fireEvent.click(screen.getByRole('button', { name: /确认登记/ }))
    await waitFor(() => expect(createMock).toHaveBeenCalled())
    const input = createMock.mock.calls[0][0]
    expect(input).toMatchObject({ name: '政务网A区', domain_type: 'edge', ip_cidrs: ['10.20.0.0/16', '10.30.0.0/24'] })
    expect(input).not.toHaveProperty('tenant_id')
    expect(successMock).toHaveBeenCalled()
    expect(cancelMock).toHaveBeenCalled()
  })

  it('编辑态：直接渲染主体，提交用 id 且不含 tenant_id', async () => {
    updateMock.mockResolvedValue({ status: 'success', data: editDomain })
    renderDrawer({ mode: 'edit', domain: editDomain })
    fireEvent.change(screen.getByPlaceholderText('例如：政务网 A 区'), { target: { value: '政务网A区-改' } })
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    expect(updateMock.mock.calls[0][0]).toBe(editDomain.id)
    const input = updateMock.mock.calls[0][1]
    expect(input).toMatchObject({ name: '政务网A区-改' })
    expect(input).not.toHaveProperty('tenant_id')
    expect(createMock).not.toHaveBeenCalled()
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
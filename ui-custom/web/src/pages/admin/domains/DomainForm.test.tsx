import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DomainFormModal } from './DomainForm'
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

function renderModal(over: Partial<{ open: boolean; mode: 'create' | 'edit'; domain: NetworkDomain | null }> = {}) {
  const open = over.open ?? true
  const mode: 'create' | 'edit' = over.mode ?? 'create'
  const domain = over.domain ?? null
  return render(
    <DomainFormModal open={open} mode={mode} domain={domain} onCancel={cancelMock} onSuccess={successMock} />,
  )
}

const cancelMock = vi.fn()
const successMock = vi.fn()

describe('DomainFormModal', () => {
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

  it('submits create without tenant_id and calls onSuccess', async () => {
    createMock.mockResolvedValue({ status: 'success', data: editDomain })
    renderModal()
    fireEvent.change(screen.getByPlaceholderText('例如：政务网 A 区'), { target: { value: '政务网A区' } })
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))
    await waitFor(() => expect(createMock).toHaveBeenCalled())
    const input = createMock.mock.calls[0][0]
    expect(input).toMatchObject({ name: '政务网A区', domain_type: 'edge' })
    expect(input).not.toHaveProperty('tenant_id')
    expect(successMock).toHaveBeenCalled()
    expect(cancelMock).toHaveBeenCalled()
  })

  it('rejects submit when required field is empty', async () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))
    await waitFor(() => expect(screen.getByText('请输入网域名称')).toBeInTheDocument())
    expect(createMock).not.toHaveBeenCalled()
  })

  it('prevents duplicate submit while loading', async () => {
    createMock.mockReturnValue(new Promise(() => {}))
    renderModal()
    fireEvent.change(screen.getByPlaceholderText('例如：政务网 A 区'), { target: { value: '政务网A区' } })
    const ok = screen.getByRole('button', { name: /提\s*交/ })
    fireEvent.click(ok)
    fireEvent.click(ok)
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
  })

  it('submits edit with id and without tenant_id', async () => {
    updateMock.mockResolvedValue({ status: 'success', data: editDomain })
    renderModal({ mode: 'edit', domain: editDomain })
    // 编辑态域类型不可改，仅展示；修改名称后提交
    fireEvent.change(screen.getByPlaceholderText('例如：政务网 A 区'), { target: { value: '政务网A区-改' } })
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))
    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    expect(updateMock.mock.calls[0][0]).toBe(editDomain.id)
    const input = updateMock.mock.calls[0][1]
    expect(input).toMatchObject({ name: '政务网A区-改' })
    expect(input).not.toHaveProperty('tenant_id')
    expect(createMock).not.toHaveBeenCalled()
  })
})

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupAntdTest } from '../../test/antdTestUtils'
import { InhibitionsPage } from './InhibitionsPage'

const { listMock, saveMock } = vi.hoisted(() => ({ listMock: vi.fn(), saveMock: vi.fn() }))
vi.mock('../../api/inhibitions', () => ({
  inhibitionsApi: { list: listMock, save: saveMock },
}))
vi.mock('../../layouts/MainLayout', () => ({
  MainLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>()
  return { ...actual, getStoredUser: () => ({ id: 'admin', role: 'admin' }) }
})

const existing = {
  id: 'inhibit-1', name: '现有抑制规则', enabled: true,
  source_matchers: [{ name: 'severity', value: 'critical', is_equal: true, is_regex: false }],
  target_matchers: [{ name: 'severity', value: 'warning', is_equal: true, is_regex: false }],
  equal: ['network_domain'],
}

describe('InhibitionsPage', () => {
  setupAntdTest()
  beforeEach(() => {
    listMock.mockReset()
    saveMock.mockReset()
    listMock.mockResolvedValue({ status: 'success', data: { items: [existing], effective_checksum: 'sum-1', pending: null } })
    saveMock.mockResolvedValue({ status: 'success', data: { change_no: 'CHG-001' } })
  })

  it('starts read-only, adds a rule in edit mode and submits the shared change pipeline', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><InhibitionsPage /></MemoryRouter>)
    expect(await screen.findByText('现有抑制规则')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新建抑制规则' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '编辑抑制规则' }))
    await user.click(screen.getByRole('button', { name: '新建抑制规则' }))
    expect(await screen.findByLabelText('规则名称')).toHaveValue('')
    await user.type(screen.getByLabelText('规则名称'), '网域离线抑制')
    const source = within(screen.getByTestId('source-matchers'))
    await user.type(source.getByPlaceholderText('标签名'), 'alertname')
    await user.type(source.getByPlaceholderText('标签值'), 'EdgeSiteOffline')
    const target = within(screen.getByTestId('target-matchers'))
    await user.type(target.getByPlaceholderText('标签名'), 'inhibitable')
    await user.type(target.getByPlaceholderText('标签值'), 'true')
    await user.click(screen.getByRole('button', { name: '确定' }))
    await user.click(screen.getByRole('button', { name: '保存并提交变更' }))

    await waitFor(() => expect(saveMock).toHaveBeenCalled())
    const payload = saveMock.mock.calls[0][0]
    expect(payload.base_checksum).toBe('sum-1')
    expect(payload.inhibit_rules).toHaveLength(2)
    expect(payload.inhibit_rules[1].name).toBe('网域离线抑制')
    expect(payload.inhibit_rules[1].source_matchers[0].value).toBe('EdgeSiteOffline')
    expect(payload.inhibit_rules[1].target_matchers[0].value).toBe('true')
    expect(await screen.findByText('抑制规则变更已提交，等待确认下发')).toBeInTheDocument()
  })

  it('shows load errors', async () => {
    listMock.mockRejectedValueOnce(new Error('加载失败'))
    render(<MemoryRouter><InhibitionsPage /></MemoryRouter>)
    expect(await screen.findByText('加载失败')).toBeInTheDocument()
  })

  it('hides the pending banner when only routes changed', async () => {
    listMock.mockResolvedValueOnce({
      status: 'success',
      data: {
        items: [existing], effective_checksum: 'sum-1',
        pending: { change_no: 'CHG-ROUTE', created_at: '2026-10-26T00:00:00Z', route_changed: true, inhibit_rules_changed: false },
      },
    })
    render(<MemoryRouter><InhibitionsPage /></MemoryRouter>)
    expect(await screen.findByText('现有抑制规则')).toBeInTheDocument()
    expect(screen.queryByText('当前显示的是待确认版本')).not.toBeInTheDocument()
  })
})

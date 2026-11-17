import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { setupAntdTest, selectAntdOption } from '../../../test/antdTestUtils'
import { DeploymentsPage } from './DeploymentsPage'
import type { ConfigSnapshotHistoryRow, NetworkDomain } from '../../../types/config-center'
import { shortChecksum } from '../../../utils/shortChecksum'

const useSnapshotHistoryMock = vi.fn()
vi.mock('./useSnapshotHistory', () => ({
  useSnapshotHistory: (...args: unknown[]) => useSnapshotHistoryMock(...args),
}))

vi.mock('../../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/client')>()
  return {
    ...actual,
    getStoredUser: () => ({
      id: 'u1',
      username: 'admin',
      display_name: '系统管理员',
      tenant_id: 'platform_admin',
      role: 'admin',
    }),
  }
})

const snapshotGetMock = vi.fn()
const snapshotContentMock = vi.fn()
vi.mock('../../../api/configCenter', () => ({
  configSnapshotApi: {
    list: vi.fn(),
    get: (...args: unknown[]) => snapshotGetMock(...args),
    content: (...args: unknown[]) => snapshotContentMock(...args),
  },
}))

vi.mock('../../../utils/triggerBlobDownload', () => ({ triggerBlobDownload: vi.fn() }))
vi.mock('antd/locale/zh_CN', () => ({ default: {} }))

const reloadMock = vi.fn()

const domain = (id: string, name: string): NetworkDomain =>
  ({
    id,
    name,
    channel: 'agent_pull',
    is_monitored: true,
    domain_type: 'edge',
    tenant_id: '',
  }) as NetworkDomain

const row = (over: Partial<ConfigSnapshotHistoryRow> = {}): ConfigSnapshotHistoryRow => ({
  id: 42,
  network_domain_id: 'mc-demo',
  network_domain_name: '演示域',
  version: '20261111-0a1b',
  checksum: 'sha256:deadbeef0123456789abcdef',
  validation_status: 'passed',
  validation_cause: 'none',
  validation_details: {},
  is_current: true,
  generated_by: 'system',
  created_at: '2026-11-11T10:00:00Z',
  ...over,
})

function result(over: Record<string, unknown> = {}) {
  return {
    rows: [] as ConfigSnapshotHistoryRow[],
    loading: false,
    error: null,
    permissionDenied: false,
    partialErrors: [],
    domains: [domain('mc-demo', '演示域')],
    domainsLoading: false,
    domainError: false,
    reload: reloadMock,
    ...over,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DeploymentsPage />
    </MemoryRouter>,
  )
}

describe('DeploymentsPage（快照历史）', () => {
  setupAntdTest()

  beforeEach(() => {
    useSnapshotHistoryMock.mockReset()
    snapshotGetMock.mockReset()
    snapshotContentMock.mockReset()
    reloadMock.mockReset()
  })

  it('加载中提示', () => {
    useSnapshotHistoryMock.mockReturnValue(result({ loading: true }))
    renderPage()
    expect(screen.getAllByText('快照历史').length).toBeGreaterThan(0)
    expect(screen.getByText('加载中…')).toBeInTheDocument()
  })

  it('渲染聚合快照：网域 / 版本 / 校验状态 / 当前版本 / 生成来源 / 校验值', async () => {
    useSnapshotHistoryMock.mockReturnValue(
      result({
        rows: [
          row(),
          row({
            id: 41,
            network_domain_id: 'mc-edge',
            network_domain_name: '边缘域',
            version: '20261110-x9y8',
            checksum: 'sha256:00112233445566778899aabb',
            validation_status: 'failed',
            is_current: false,
            generated_by: 'alertmanager',
          }),
        ],
        domains: [domain('mc-demo', '演示域'), domain('mc-edge', '边缘域')],
      }),
    )
    renderPage()

    expect(await screen.findByText('20261111-0a1b')).toBeInTheDocument()
    expect(screen.getByText('20261110-x9y8')).toBeInTheDocument()
    expect(screen.getAllByText('演示域').length).toBeGreaterThan(0)
    expect(screen.getAllByText('边缘域').length).toBeGreaterThan(0)
    expect(screen.getByText('成功')).toBeInTheDocument()
    expect(screen.getByText('失败')).toBeInTheDocument()
    expect(screen.getByText('当前生效')).toBeInTheDocument()
    expect(screen.getByText('告警配置同步')).toBeInTheDocument()
    expect(screen.getByText(shortChecksum('sha256:deadbeef0123456789abcdef'))).toBeInTheDocument()
  })

  it('空态：暂无配置快照', async () => {
    useSnapshotHistoryMock.mockReturnValue(result())
    renderPage()
    expect(await screen.findByText('暂无配置快照')).toBeInTheDocument()
  })

  it('按网域筛选：仅保留所选网域的行', async () => {
    useSnapshotHistoryMock.mockReturnValue(
      result({
        rows: [
          row(),
          row({
            id: 41,
            network_domain_id: 'mc-edge',
            network_domain_name: '边缘域',
            version: '20261110-x9y8',
            created_at: '2026-11-10T10:00:00Z',
          }),
        ],
        domains: [domain('mc-demo', '演示域'), domain('mc-edge', '边缘域')],
      }),
    )
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('20261110-x9y8')).toBeInTheDocument()

    await user.click(screen.getAllByRole('combobox')[0])
    await selectAntdOption(
      '边缘域',
      document.querySelector('.ant-select-dropdown') as HTMLElement,
    )

    await waitFor(() => expect(screen.queryByText('20261111-0a1b')).not.toBeInTheDocument())
    expect(screen.getByText('20261110-x9y8')).toBeInTheDocument()
  })

  it('按校验状态筛选：仅保留失败快照', async () => {
    useSnapshotHistoryMock.mockReturnValue(
      result({
        rows: [
          row(),
          row({
            id: 41,
            version: '20261110-x9y8',
            validation_status: 'failed',
            is_current: false,
            created_at: '2026-11-10T10:00:00Z',
          }),
        ],
      }),
    )
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('20261111-0a1b')).toBeInTheDocument()

    await user.click(screen.getAllByRole('combobox')[1])
    await selectAntdOption(
      '失败',
      document.querySelector('.ant-select-dropdown') as HTMLElement,
    )

    await waitFor(() => expect(screen.queryByText('20261111-0a1b')).not.toBeInTheDocument())
    expect(screen.getByText('20261110-x9y8')).toBeInTheDocument()
  })

  it('关键字筛选：命中版本或校验值，未命中展示无匹配提示', async () => {
    useSnapshotHistoryMock.mockReturnValue(
      result({
        rows: [
          row(),
          row({
            id: 41,
            version: '20261110-x9y8',
            checksum: 'sha256:00112233445566778899aabb',
            created_at: '2026-11-10T10:00:00Z',
          }),
        ],
      }),
    )
    renderPage()
    expect(await screen.findByText('20261111-0a1b')).toBeInTheDocument()

    const input = screen.getByPlaceholderText('搜索版本或校验值')
    fireEvent.change(input, { target: { value: 'x9y8' } })
    await waitFor(() => expect(screen.queryByText('20261111-0a1b')).not.toBeInTheDocument())
    expect(screen.getByText('20261110-x9y8')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: '00112233' } })
    expect(screen.getByText('20261110-x9y8')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'no-such-snapshot' } })
    expect(await screen.findByText('没有匹配的快照记录')).toBeInTheDocument()
  })

  it('部分网域失败：提示条列出失败域，其余行正常展示', async () => {
    useSnapshotHistoryMock.mockReturnValue(
      result({
        rows: [row()],
        domains: [domain('mc-demo', '演示域'), domain('mc-fail', '故障域')],
        partialErrors: [
          { domain_id: 'mc-fail', network_domain_name: '故障域', message: '请求超时' },
        ],
      }),
    )
    renderPage()
    expect(await screen.findByText('部分网域快照加载失败（1 个）')).toBeInTheDocument()
    expect(screen.getByText(/故障域（mc-fail）：请求超时/)).toBeInTheDocument()
    expect(screen.getByText('20261111-0a1b')).toBeInTheDocument()
  })

  it('接口错误：Alert + 重试触发 reload', async () => {
    useSnapshotHistoryMock.mockReturnValue(result({ error: '接口异常' }))
    renderPage()
    expect(await screen.findByText('快照历史加载失败')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }))
    expect(reloadMock).toHaveBeenCalled()
  })

  it('权限不足：显示权限不足空态', async () => {
    useSnapshotHistoryMock.mockReturnValue(result({ permissionDenied: true }))
    renderPage()
    expect(await screen.findByText('当前账号无此页面查看权限')).toBeInTheDocument()
  })

  it('前端分页：20 条/页，可翻到第二页', async () => {
    const rows = Array.from({ length: 21 }, (_, index) =>
      row({
        id: 100 + index,
        version: `version-${String(index + 1).padStart(2, '0')}`,
        checksum: `sha256:${String(index).padStart(8, '0')}abcdefgh`,
        created_at: `2026-11-${String(21 - index).padStart(2, '0')}T10:00:00Z`,
      }),
    )
    useSnapshotHistoryMock.mockReturnValue(result({ rows }))
    renderPage()

    expect(await screen.findByText('version-01')).toBeInTheDocument()
    expect(screen.queryByText('version-21')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTitle('2'))
    expect(await screen.findByText('version-21')).toBeInTheDocument()
    expect(screen.queryByText('version-01')).not.toBeInTheDocument()
  })

  it('详情抽屉：可查看失败快照的校验归因与明细', async () => {
    useSnapshotHistoryMock.mockReturnValue(
      result({ rows: [row({ validation_status: 'failed', validation_cause: 'platform_fault' })] }),
    )
    snapshotGetMock.mockResolvedValue({
      status: 'success',
      data: row({
        validation_status: 'failed',
        validation_cause: 'platform_fault',
        validation_details: { message: 'promtool 不可调用' },
      }),
    })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    expect(snapshotGetMock).toHaveBeenCalledWith('mc-demo', 42)
    expect(await screen.findByText('快照详情：20261111-0a1b')).toBeInTheDocument()
    expect(screen.getByText('平台故障')).toBeInTheDocument()
    expect(await screen.findByText(/"message": "promtool 不可调用"/)).toBeInTheDocument()
  })

  it('只读页面：无回滚 / 重试 / 下发动作', async () => {
    useSnapshotHistoryMock.mockReturnValue(result({ rows: [row()] }))
    renderPage()
    expect(await screen.findByText('20261111-0a1b')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /回滚/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /重试/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /下发/ })).not.toBeInTheDocument()
  })
})

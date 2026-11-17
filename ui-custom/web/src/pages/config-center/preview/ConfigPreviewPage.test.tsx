import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setupAntdTest, mockAntdMessage } from '../../../test/antdTestUtils'
import { ConfigPreviewPage } from './ConfigPreviewPage'
import { ApiError } from '../../../api/client'
import type { ConfigSnapshot, NetworkDomain } from '../../../types/config-center'
import { shortChecksum } from '../../../utils/shortChecksum'

const { userState } = vi.hoisted(() => ({ userState: { role: 'admin' as string | undefined } }))

vi.mock('../../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/client')>()
  return {
    ...actual,
    getStoredUser: () =>
      userState.role
        ? {
            id: 'u1',
            username: 'admin',
            display_name: '系统管理员',
            tenant_id: 'platform_admin',
            role: userState.role,
          }
        : null,
  }
})

const useConfigSnapshotsMock = vi.fn()
vi.mock('./useConfigSnapshots', () => ({
  useConfigSnapshots: (...args: unknown[]) => useConfigSnapshotsMock(...args),
  fetchMonitoredDomains: vi.fn(),
}))

const snapshotGetMock = vi.fn()
const snapshotContentMock = vi.fn()
vi.mock('../../../api/configCenter', () => ({
  configSnapshotApi: {
    list: vi.fn(),
    get: (...args: unknown[]) => snapshotGetMock(...args),
    content: (...args: unknown[]) => snapshotContentMock(...args),
  },
}))

const triggerBlobDownloadMock = vi.fn()
vi.mock('../../../utils/triggerBlobDownload', () => ({
  triggerBlobDownload: (...args: unknown[]) => triggerBlobDownloadMock(...args),
}))

vi.mock('antd/locale/zh_CN', () => ({ default: {} }))

const reloadMock = vi.fn()
const setDomainIdMock = vi.fn()

const domain = (over: Partial<NetworkDomain> = {}): NetworkDomain =>
  ({
    id: 'mc-demo',
    name: '演示域',
    channel: 'agent_pull',
    is_monitored: true,
    domain_type: 'edge',
    tenant_id: '',
    ...over,
  }) as NetworkDomain

const snapshot = (over: Partial<ConfigSnapshot> = {}): ConfigSnapshot => ({
  id: 42,
  network_domain_id: 'mc-demo',
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
    snapshots: [] as ConfigSnapshot[],
    total: 0,
    loading: false,
    error: null,
    permissionDenied: false,
    domains: [domain()],
    domainsLoading: false,
    domainError: false,
    domainId: 'mc-demo',
    setDomainId: setDomainIdMock,
    reload: reloadMock,
    ...over,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ConfigPreviewPage />
    </MemoryRouter>,
  )
}

describe('ConfigPreviewPage（配置快照）', () => {
  setupAntdTest()

  beforeEach(() => {
    useConfigSnapshotsMock.mockReset()
    snapshotGetMock.mockReset()
    snapshotContentMock.mockReset()
    triggerBlobDownloadMock.mockReset()
    reloadMock.mockReset()
    setDomainIdMock.mockReset()
    userState.role = 'admin'
  })

  it('加载中提示', () => {
    useConfigSnapshotsMock.mockReturnValue(result({ loading: true }))
    renderPage()
    expect(screen.getAllByText('配置快照').length).toBeGreaterThan(0)
    expect(screen.getByText(/加载中/)).toBeInTheDocument()
  })

  it('渲染快照列表：版本 / 校验状态 / 当前版本 / 生成来源 / 校验值 / 生成时间', async () => {
    useConfigSnapshotsMock.mockReturnValue(
      result({
        snapshots: [
          snapshot(),
          snapshot({
            id: 41,
            version: '20261110-x9y8',
            checksum: 'sha256:00112233445566778899aabb',
            validation_status: 'failed',
            is_current: false,
            generated_by: 'alertmanager',
            created_at: '2026-11-10T09:30:00Z',
          }),
        ],
        total: 2,
      }),
    )
    renderPage()

    expect(await screen.findByText('20261111-0a1b')).toBeInTheDocument()
    expect(screen.getByText('20261110-x9y8')).toBeInTheDocument()
    expect(screen.getByText('成功')).toBeInTheDocument()
    expect(screen.getByText('失败')).toBeInTheDocument()
    expect(screen.getByText('当前生效')).toBeInTheDocument()
    expect(screen.getByText('系统自动生成')).toBeInTheDocument()
    expect(screen.getByText('告警配置同步')).toBeInTheDocument()
    expect(screen.getByText(shortChecksum(snapshot().checksum))).toBeInTheDocument()
  })

  it('空态：该网域暂无配置快照', async () => {
    useConfigSnapshotsMock.mockReturnValue(result())
    renderPage()
    expect(await screen.findByText('该网域暂无配置快照')).toBeInTheDocument()
  })

  it('空态：暂无已纳管网域', async () => {
    useConfigSnapshotsMock.mockReturnValue(result({ domains: [], domainId: undefined }))
    renderPage()
    expect(await screen.findByText(/暂无已纳管网域/)).toBeInTheDocument()
  })

  it('接口错误：Alert + 重新加载触发 reload', async () => {
    useConfigSnapshotsMock.mockReturnValue(result({ error: 'boom' }))
    renderPage()
    expect(await screen.findByText('快照列表加载失败，请稍后重试')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重新加载/ }))
    expect(reloadMock).toHaveBeenCalled()
  })

  it('网域列表失败：展示提示并可重新加载', async () => {
    useConfigSnapshotsMock.mockReturnValue(result({ domainError: true, domains: [], domainId: undefined }))
    renderPage()
    expect(await screen.findByText('网域列表加载失败')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重新加载/ }))
    expect(reloadMock).toHaveBeenCalled()
  })

  it('权限不足：显示权限不足空态', async () => {
    useConfigSnapshotsMock.mockReturnValue(result({ permissionDenied: true }))
    renderPage()
    expect(await screen.findByText('当前账号无此页面查看权限')).toBeInTheDocument()
  })

  it('点击详情：按 v3 路径拉取详情，展示校验归因与 JSON 美化明细', async () => {
    useConfigSnapshotsMock.mockReturnValue(
      result({
        snapshots: [
          snapshot({
            validation_status: 'failed',
            validation_cause: 'user_config',
            is_current: false,
          }),
        ],
        total: 1,
      }),
    )
    snapshotGetMock.mockResolvedValue({
      status: 'success',
      data: snapshot({
        validation_status: 'failed',
        validation_cause: 'user_config',
        validation_details: { errors: [{ file: 'a.json', message: '禁止覆盖内置标签' }] },
        is_current: false,
      }),
    })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    expect(snapshotGetMock).toHaveBeenCalledWith('mc-demo', 42)
    expect(await screen.findByText('快照详情：20261111-0a1b')).toBeInTheDocument()
    expect(screen.getByText('用户配置问题')).toBeInTheDocument()
    expect(await screen.findByText(/"message": "禁止覆盖内置标签"/)).toBeInTheDocument()
  })

  it('校验通过且明细为空对象：展示无明细空态', async () => {
    useConfigSnapshotsMock.mockReturnValue(result({ snapshots: [snapshot()], total: 1 }))
    snapshotGetMock.mockResolvedValue({ status: 'success', data: snapshot() })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    expect(await screen.findByText('校验通过，无明细')).toBeInTheDocument()
  })

  it('admin 下载快照内容：调用 content 并触发文件下载', async () => {
    const antdMessage = mockAntdMessage()
    useConfigSnapshotsMock.mockReturnValue(result({ snapshots: [snapshot()], total: 1 }))
    snapshotGetMock.mockResolvedValue({ status: 'success', data: snapshot() })
    snapshotContentMock.mockResolvedValue('prometheus_yml: |\n  scrape_interval: 15s\n')
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    fireEvent.click(await screen.findByRole('button', { name: /下载配置内容/ }))

    await waitFor(() => expect(snapshotContentMock).toHaveBeenCalledWith('mc-demo', 42))
    expect(triggerBlobDownloadMock).toHaveBeenCalledWith(expect.any(Blob), '20261111-0a1b.json')
    expect(antdMessage.success).toHaveBeenCalledWith('配置内容已开始下载')
  })

  it('非 admin 不展示内容下载按钮', async () => {
    userState.role = 'user'
    useConfigSnapshotsMock.mockReturnValue(result({ snapshots: [snapshot()], total: 1 }))
    snapshotGetMock.mockResolvedValue({ status: 'success', data: snapshot() })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    expect(await screen.findByText('快照详情：20261111-0a1b')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /下载配置内容/ })).not.toBeInTheDocument()
  })

  it('内容下载 403：提示需管理员权限，不触发下载', async () => {
    const antdMessage = mockAntdMessage()
    useConfigSnapshotsMock.mockReturnValue(result({ snapshots: [snapshot()], total: 1 }))
    snapshotGetMock.mockResolvedValue({ status: 'success', data: snapshot() })
    snapshotContentMock.mockRejectedValue(new ApiError('forbidden', 403, 'forbidden'))
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    fireEvent.click(await screen.findByRole('button', { name: /下载配置内容/ }))

    await waitFor(() => expect(antdMessage.error).toHaveBeenCalledWith('当前账号无下载配置内容的权限，请联系管理员开通'))
    expect(triggerBlobDownloadMock).not.toHaveBeenCalled()
  })

  it('内容下载 401：提示登录过期，不触发下载', async () => {
    const antdMessage = mockAntdMessage()
    useConfigSnapshotsMock.mockReturnValue(result({ snapshots: [snapshot()], total: 1 }))
    snapshotGetMock.mockResolvedValue({ status: 'success', data: snapshot() })
    snapshotContentMock.mockRejectedValue(new ApiError('unauthorized', 401, 'unauthorized'))
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    fireEvent.click(await screen.findByRole('button', { name: /下载配置内容/ }))

    await waitFor(() => expect(antdMessage.error).toHaveBeenCalledWith('登录已过期，请重新登录后再下载'))
    expect(triggerBlobDownloadMock).not.toHaveBeenCalled()
  })

  it('详情加载失败：展示错误 Alert 并可重试', async () => {
    useConfigSnapshotsMock.mockReturnValue(result({ snapshots: [snapshot()], total: 1 }))
    snapshotGetMock
      .mockRejectedValueOnce(new Error('网络异常'))
      .mockResolvedValueOnce({ status: 'success', data: snapshot({ version: 'retried-version' }) })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    expect(await screen.findByText('快照详情加载失败')).toBeInTheDocument()
    expect(screen.getByText('网络异常')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重试/ }))
    await waitFor(() => expect(snapshotGetMock).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('快照详情：retried-version')).toBeInTheDocument()
  })
})

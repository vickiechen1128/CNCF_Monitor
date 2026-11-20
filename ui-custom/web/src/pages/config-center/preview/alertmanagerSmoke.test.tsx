import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setupAntdTest } from '../../../test/antdTestUtils'
import { ConfigPreviewPage } from './ConfigPreviewPage'
import type { ConfigSnapshotHistoryRow, NetworkDomain } from '../../../types/config-center'

/**
 * M08 告警配置 → M09 配置快照冒烟（v3 契约 §4）。
 *
 * v3 语义：告警配置变更即自动同步并生成快照，不再产生待确认草稿、无人工确认 / 废弃 /
 * 回滚动作。本冒烟只验证 M09 侧页面以只读方式呈现 alertmanager 来源的快照，
 * 且不出现任何 v2 写操作入口。
 */
const useConfigSnapshotsMock = vi.fn()

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

vi.mock('./useConfigArtifacts', () => ({
  useConfigArtifacts: (...args: unknown[]) => useConfigSnapshotsMock(...args),
}))

const snapshotGetMock = vi.fn()
const snapshotContentMock = vi.fn()
vi.mock('../../../api/configCenter', () => ({
  configArtifactApi: {
    list: vi.fn(),
    get: (...args: unknown[]) => snapshotGetMock(...args),
    preview: (...args: unknown[]) => snapshotContentMock(...args),
    recoveryBundle: vi.fn(),
  },
}))

const triggerBlobDownloadMock = vi.fn()
vi.mock('../../../utils/triggerBlobDownload', () => ({
  triggerBlobDownload: (...args: unknown[]) => triggerBlobDownloadMock(...args),
}))

vi.mock('antd/locale/zh_CN', () => ({ default: {} }))

const domain: NetworkDomain = {
  id: 'mc-am',
  name: '告警配置域',
  channel: 'agent_pull',
  is_monitored: true,
  domain_type: 'edge',
  tenant_id: '',
}

/** 告警配置自动同步生成的快照（version 前缀 am-） */
const amSnapshot = (over: Partial<ConfigSnapshotHistoryRow> = {}): ConfigSnapshotHistoryRow => ({
  id: 77,
  network_domain_id: 'mc-am',
  network_domain_name: '告警配置域',
  version: 'am-20260902-0a1b',
  checksum: 'sha256:alertmanagerchecksum0001',
  validation_status: 'passed',
  validation_cause: 'none',
  validation_details: {},
  is_current: true,
  generated_by: 'alertmanager',
  created_at: '2026-09-02T09:00:00Z',
  artifact_type: 'alertmanager',
  content_available: true,
  ...over,
})

function result(over: Record<string, unknown> = {}) {
  return {
    rows: [amSnapshot()],
    loading: false,
    error: null,
    permissionDenied: false,
    partialErrors: [],
    domains: [domain],
    domainsLoading: false,
    domainError: false,
    domainFilter: 'mc-am',
    setDomainFilter: vi.fn(),
    reload: vi.fn(),
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

describe('alertmanagerSmoke（v3：告警配置自动同步 → 只读快照）', () => {
  setupAntdTest()

  beforeEach(() => {
    useConfigSnapshotsMock.mockReset()
    snapshotGetMock.mockReset()
    snapshotContentMock.mockReset()
    snapshotContentMock.mockResolvedValue({ status: 'success', data: { artifact: amSnapshot(), files: [{ name: 'alertmanager.yml', content: 'route:\n  receiver: web\n' }] } })
    triggerBlobDownloadMock.mockReset()
  })

  it('告警配置来源的快照可见，且页面无确认 / 废弃 / 重新校验 / 回滚入口', async () => {
    useConfigSnapshotsMock.mockReturnValue(result())
    renderPage()

    expect(await screen.findByText('am-20260902-0a1b')).toBeInTheDocument()
    expect(screen.getByText('告警配置同步')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /确认发布/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /废弃/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /重新校验/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /回滚/ })).not.toBeInTheDocument()
  })

  it('告警配置快照详情可只读查看', async () => {
    useConfigSnapshotsMock.mockReturnValue(result())
    snapshotGetMock.mockResolvedValue({
      status: 'success',
      data: amSnapshot({ validation_details: { file: 'alertmanager.yml' } }),
    })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    expect(snapshotGetMock).toHaveBeenCalledWith(77)
    expect(await screen.findByText(/receiver: web/)).toBeInTheDocument()
  })
})

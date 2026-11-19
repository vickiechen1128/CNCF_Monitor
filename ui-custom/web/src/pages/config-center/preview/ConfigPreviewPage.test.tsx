import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { setupAntdTest, mockAntdMessage, selectAntdOption } from '../../../test/antdTestUtils'
import { ConfigPreviewPage } from './ConfigPreviewPage'
import { ApiError } from '../../../api/client'
import type { ConfigSnapshotHistoryRow, NetworkDomain } from '../../../types/config-center'

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
vi.mock('./useConfigArtifacts', () => ({
  useConfigArtifacts: (...args: unknown[]) => useConfigSnapshotsMock(...args),
}))

const snapshotGetMock = vi.fn()
const snapshotContentMock = vi.fn()
const artifactExportMock = vi.fn()
const recoveryBundleMock = vi.fn()
vi.mock('../../../api/configCenter', () => ({
  configArtifactApi: {
    list: vi.fn(),
    get: (...args: unknown[]) => snapshotGetMock(...args),
    preview: (...args: unknown[]) => snapshotContentMock(...args),
    export: (...args: unknown[]) => artifactExportMock(...args),
    recoveryBundle: (...args: unknown[]) => recoveryBundleMock(...args),
  },
}))

const triggerBlobDownloadMock = vi.fn()
vi.mock('../../../utils/triggerBlobDownload', () => ({
  triggerBlobDownload: (...args: unknown[]) => triggerBlobDownloadMock(...args),
}))

vi.mock('antd/locale/zh_CN', () => ({ default: {} }))

const reloadMock = vi.fn()
const setDomainFilterMock = vi.fn()

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
  artifact_type: 'domain',
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
    domainFilter: undefined,
    setDomainFilter: setDomainFilterMock,
    reload: reloadMock,
    ...over,
  }
}

function renderPage(entry = '/config-snapshots') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ConfigPreviewPage />
    </MemoryRouter>,
  )
}

describe('ConfigPreviewPage（配置快照：单域与快照历史合并）', () => {
  setupAntdTest()

  beforeEach(() => {
    useConfigSnapshotsMock.mockReset()
    snapshotGetMock.mockReset()
    snapshotContentMock.mockReset()
    snapshotContentMock.mockResolvedValue({ status: 'success', data: { artifact: row(), files: [] } })
    triggerBlobDownloadMock.mockReset()
    artifactExportMock.mockReset()
    recoveryBundleMock.mockReset()
    reloadMock.mockReset()
    setDomainFilterMock.mockReset()
    userState.role = 'admin'
  })

  it('加载中提示', () => {
    useConfigSnapshotsMock.mockReturnValue(result({ loading: true }))
    renderPage()
    expect(screen.getAllByText('配置备份历史').length).toBeGreaterThan(0)
    expect(screen.getByText('加载中…')).toBeInTheDocument()
  })

  it('渲染配置列表：网域 / 配置日期 / 版本 / 状态 / 当前版本 / 生成来源 / 生成时间', async () => {
    useConfigSnapshotsMock.mockReturnValue(
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
            created_at: '2026-11-10T09:30:00Z',
          }),
        ],
        domains: [domain('mc-demo', '演示域'), domain('mc-edge', '边缘域')],
      }),
    )
    renderPage()

    expect(await screen.findByText('20261111-0a1b')).toBeInTheDocument()
    expect(screen.getByText('20261110-x9y8')).toBeInTheDocument()
    // 合并后列表保留「网域」列（原快照历史页能力）
    expect(screen.getAllByText('演示域').length).toBeGreaterThan(0)
    expect(screen.getAllByText('边缘域').length).toBeGreaterThan(0)
    expect(screen.getByText('成功')).toBeInTheDocument()
    expect(screen.getByText('失败')).toBeInTheDocument()
    expect(screen.getByText('当前使用')).toBeInTheDocument()
    expect(screen.getByText('系统自动生成')).toBeInTheDocument()
    expect(screen.getByText('告警配置同步')).toBeInTheDocument()
    expect(screen.getAllByText('2026-11-11').length).toBeGreaterThan(0)
    expect(screen.getByText('2026-11-10')).toBeInTheDocument()
  })

  it('空态：暂无已纳管网域（引导先去网域纳管）', async () => {
    useConfigSnapshotsMock.mockReturnValue(result({ domains: [] }))
    renderPage()
    expect(await screen.findByText(/暂无配置备份/)).toBeInTheDocument()
  })

  it('空态：全部网域暂无配置快照', async () => {
    useConfigSnapshotsMock.mockReturnValue(result())
    renderPage()
    expect(await screen.findByText('暂无配置备份')).toBeInTheDocument()
  })

  it('空态：选中某一网域且该域无快照时文案限定为该网域', async () => {
    useConfigSnapshotsMock.mockReturnValue(result({ domainFilter: 'mc-demo' }))
    renderPage()
    expect(await screen.findByText('该网域暂无配置备份')).toBeInTheDocument()
  })

  it('按网域筛选：选择网域后调用 setDomainFilter（默认「全部网域」= 跨域聚合）', async () => {
    useConfigSnapshotsMock.mockReturnValue(
      result({
        rows: [row()],
        domains: [domain('mc-demo', '演示域'), domain('mc-edge', '边缘域')],
      }),
    )
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('20261111-0a1b')).toBeInTheDocument()

    await user.click(screen.getAllByRole('combobox')[0])
    await selectAntdOption(
      '边缘域',
      document.querySelector('.ant-select-dropdown') as HTMLElement,
    )
    expect(setDomainFilterMock).toHaveBeenCalledWith('mc-edge')
  })

  it('按配置日期筛选：仅保留所选日期的配置，并提示仅保留 30 天', async () => {
    useConfigSnapshotsMock.mockReturnValue(
      result({
        rows: [
          row(),
          row({
            id: 41,
            version: '20261110-x9y8',
            created_at: '2026-11-10T10:00:00Z',
          }),
        ],
      }),
    )
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('20261111-0a1b')).toBeInTheDocument()
    expect(screen.getAllByText('仅保留最近 30 天').length).toBeGreaterThan(0)

    await user.click(screen.getAllByRole('combobox')[3])
    const dateOption = document.querySelector(
      '.ant-select-dropdown .ant-select-item-option[title="2026-11-10"]',
    ) as HTMLElement
    expect(dateOption).not.toBeNull()
    await user.click(dateOption)

    await waitFor(() => expect(screen.queryByText('20261111-0a1b')).not.toBeInTheDocument())
    expect(screen.getByText('20261110-x9y8')).toBeInTheDocument()
  })

  it('按状态筛选：仅保留失败配置', async () => {
    useConfigSnapshotsMock.mockReturnValue(
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

  it('关键字筛选：命中版本或日期，未命中展示无匹配提示', async () => {
    useConfigSnapshotsMock.mockReturnValue(
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

    const input = screen.getByPlaceholderText('搜索版本或日期')
    fireEvent.change(input, { target: { value: 'x9y8' } })
    await waitFor(() => expect(screen.queryByText('20261111-0a1b')).not.toBeInTheDocument())
    expect(screen.getByText('20261110-x9y8')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: '2026-11-10' } })
    expect(screen.getByText('20261110-x9y8')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'no-such-snapshot' } })
    expect(await screen.findByText('没有符合条件的配置备份')).toBeInTheDocument()
  })

  it('部分网域失败：提示条列出失败域，其余行正常展示', async () => {
    useConfigSnapshotsMock.mockReturnValue(
      result({
        rows: [row()],
        domains: [domain('mc-demo', '演示域'), domain('mc-fail', '故障域')],
        partialErrors: [{ domain_id: 'mc-fail', network_domain_name: '故障域', message: '请求超时' }],
      }),
    )
    renderPage()
    expect(await screen.findByText('部分网域的配置暂时无法读取（1 个）')).toBeInTheDocument()
    expect(screen.getByText(/故障域：请稍后刷新重试/)).toBeInTheDocument()
    expect(screen.getByText('20261111-0a1b')).toBeInTheDocument()
  })

  it('接口错误：Alert + 重新加载触发 reload', async () => {
    useConfigSnapshotsMock.mockReturnValue(result({ error: 'boom' }))
    renderPage()
    expect(await screen.findByText('配置列表暂时加载失败')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /刷新/ })[0])
    expect(reloadMock).toHaveBeenCalled()
  })

  it('网域列表失败：展示提示并可刷新', async () => {
    useConfigSnapshotsMock.mockReturnValue(result({ domainError: true, domains: [] }))
    renderPage()
    expect(await screen.findByText('网域信息暂时无法读取')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /刷新/ })[0])
    expect(reloadMock).toHaveBeenCalled()
  })

  it('权限不足：显示权限不足空态', async () => {
    useConfigSnapshotsMock.mockReturnValue(result({ permissionDenied: true }))
    renderPage()
    expect(await screen.findByText('当前账号无此页面查看权限')).toBeInTheDocument()
  })

  it('深链 ?network_domain=<id> 作为初始网域筛选传给 Hook', async () => {
    useConfigSnapshotsMock.mockReturnValue(result({ rows: [row()], domainFilter: 'mc-demo' }))
    renderPage('/config-snapshots?network_domain=mc-demo')
    expect(useConfigSnapshotsMock).toHaveBeenCalledWith({ initialDomainId: 'mc-demo' })
    expect(await screen.findByText('20261111-0a1b')).toBeInTheDocument()
  })

  it('点击详情：按 v3 路径拉取详情，展示校验归因与 JSON 美化明细', async () => {
    useConfigSnapshotsMock.mockReturnValue(
      result({
        rows: [row({ validation_status: 'failed', validation_cause: 'user_config', is_current: false })],
      }),
    )
    snapshotGetMock.mockResolvedValue({
      status: 'success',
      data: row({
        validation_status: 'failed',
        validation_cause: 'user_config',
        validation_details: { errors: [{ file: 'a.json', message: '禁止覆盖内置标签' }] },
        is_current: false,
      }),
    })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    expect(snapshotGetMock).toHaveBeenCalledWith(42)
    expect(await screen.findByText('配置详情：20261111-0a1b')).toBeInTheDocument()
    expect(screen.getByText('用户配置问题')).toBeInTheDocument()
    expect(await screen.findByText(/"message": "禁止覆盖内置标签"/)).toBeInTheDocument()
  })

  it('校验通过且明细为空对象：展示无明细空态', async () => {
    useConfigSnapshotsMock.mockReturnValue(result({ rows: [row()] }))
    snapshotGetMock.mockResolvedValue({ status: 'success', data: row() })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    expect(await screen.findByText('配置检查通过，没有需要处理的明细')).toBeInTheDocument()
  })

  it('admin 下载网域配置包：调用 export 并触发 zip 下载', async () => {
    const antdMessage = mockAntdMessage()
    useConfigSnapshotsMock.mockReturnValue(result({ rows: [row()] }))
    snapshotGetMock.mockResolvedValue({ status: 'success', data: row() })
    artifactExportMock.mockResolvedValue({
      blob: new Blob(['zip']),
      filename: 'mc-demo-20261111-0a1b.zip',
    })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    fireEvent.click(await screen.findByRole('button', { name: /下载配置包/ }))

    await waitFor(() => expect(artifactExportMock).toHaveBeenCalledWith(42, false))
    expect(triggerBlobDownloadMock).toHaveBeenCalledWith(expect.any(Blob), 'mc-demo-20261111-0a1b.zip')
    expect(antdMessage.success).toHaveBeenCalledWith('配置已开始下载')
  })

  it('非 admin 不展示内容预览与导出按钮', async () => {
    userState.role = 'user'
    useConfigSnapshotsMock.mockReturnValue(result({ rows: [row()] }))
    snapshotGetMock.mockResolvedValue({ status: 'success', data: row() })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    expect(await screen.findByText('配置详情：20261111-0a1b')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /下载配置包/ })).not.toBeInTheDocument()
    expect(screen.getByText('配置里可能包含账号密码，只有管理员可以查看和下载。')).toBeInTheDocument()
  })

  it('导出 403：提示需管理员权限，不触发下载', async () => {
    const antdMessage = mockAntdMessage()
    useConfigSnapshotsMock.mockReturnValue(result({ rows: [row()] }))
    snapshotGetMock.mockResolvedValue({ status: 'success', data: row() })
    artifactExportMock.mockRejectedValue(new ApiError('forbidden', 403, 'forbidden'))
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    fireEvent.click(await screen.findByRole('button', { name: /下载配置包/ }))

    await waitFor(() =>
      expect(antdMessage.error).toHaveBeenCalledWith('当前账号不能下载配置，请联系管理员开通权限'),
    )
    expect(triggerBlobDownloadMock).not.toHaveBeenCalled()
  })

  it('导出 401：提示登录过期，不触发下载', async () => {
    const antdMessage = mockAntdMessage()
    useConfigSnapshotsMock.mockReturnValue(result({ rows: [row()] }))
    snapshotGetMock.mockResolvedValue({ status: 'success', data: row() })
    artifactExportMock.mockRejectedValue(new ApiError('unauthorized', 401, 'unauthorized'))
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    fireEvent.click(await screen.findByRole('button', { name: /下载配置包/ }))

    await waitFor(() =>
      expect(antdMessage.error).toHaveBeenCalledWith('登录已过期，请重新登录后再下载'),
    )
    expect(triggerBlobDownloadMock).not.toHaveBeenCalled()
  })

  it('详情加载失败：展示错误 Alert 并可重试', async () => {
    useConfigSnapshotsMock.mockReturnValue(result({ rows: [row()] }))
    snapshotGetMock
      .mockRejectedValueOnce(new Error('网络异常'))
      .mockResolvedValueOnce({ status: 'success', data: row({ version: 'retried-version' }) })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    expect(await screen.findByText('配置详情加载失败')).toBeInTheDocument()
    expect(screen.getByText('请点击「重试」；如果一直失败，请联系管理员。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重试/ }))
    await waitFor(() => expect(snapshotGetMock).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('配置详情：retried-version')).toBeInTheDocument()
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
    useConfigSnapshotsMock.mockReturnValue(result({ rows }))
    renderPage()

    expect(await screen.findByText('version-01')).toBeInTheDocument()
    expect(screen.queryByText('version-21')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTitle('2'))
    expect(await screen.findByText('version-21')).toBeInTheDocument()
    expect(screen.queryByText('version-01')).not.toBeInTheDocument()
  })

  it('按类型筛选：仅保留中心规则', async () => {
    useConfigSnapshotsMock.mockReturnValue(
      result({
        rows: [
          row(),
          row({
            id: 43,
            artifact_type: 'center',
            network_domain_id: '',
            network_domain_name: '中心规则',
            version: 'center-rule-1',
            is_current: true,
          }),
          row({
            id: 44,
            artifact_type: 'alertmanager',
            network_domain_id: '',
            network_domain_name: '告警配置',
            version: 'am-1',
            is_current: true,
          }),
        ],
      }),
    )
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('center-rule-1')).toBeInTheDocument()

    await user.click(screen.getAllByRole('combobox')[2])
    await selectAntdOption(
      '中心规则',
      document.querySelector('.ant-select-dropdown') as HTMLElement,
    )

    await waitFor(() => expect(screen.queryByText('20261111-0a1b')).not.toBeInTheDocument())
    expect(screen.getByText('center-rule-1')).toBeInTheDocument()
    expect(screen.queryByText('am-1')).not.toBeInTheDocument()
  })

  it('平台级配置展示类型标签与「中心」范围', async () => {
    useConfigSnapshotsMock.mockReturnValue(
      result({
        rows: [
          row({
            id: 43,
            artifact_type: 'center',
            network_domain_id: '',
            network_domain_name: '中心规则',
            version: 'center-rule-1',
            generated_by: '',
          }),
          row({
            id: 44,
            artifact_type: 'alertmanager',
            network_domain_id: '',
            network_domain_name: '告警配置',
            version: 'am-1',
            generated_by: 'admin',
          }),
        ],
      }),
    )
    renderPage()
    expect(await screen.findByText('center-rule-1')).toBeInTheDocument()
    expect(screen.getAllByText('中心规则').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('告警配置').length).toBeGreaterThanOrEqual(1)
  })

  it('admin 下载恢复包', async () => {
    const antdMessage = mockAntdMessage()
    useConfigSnapshotsMock.mockReturnValue(result({ rows: [row()] }))
    recoveryBundleMock.mockResolvedValue({
      blob: new Blob(['zip']),
      filename: 'center-recovery-20261117-aaaa.zip',
    })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /下载恢复包/ }))
    await waitFor(() => expect(recoveryBundleMock).toHaveBeenCalled())
    expect(triggerBlobDownloadMock).toHaveBeenCalledWith(
      expect.any(Blob),
      'center-recovery-20261117-aaaa.zip',
    )
    expect(antdMessage.success).toHaveBeenCalledWith('恢复包已开始下载')
  })

  it('详情预览按文件 Tab 展示内容', async () => {
    useConfigSnapshotsMock.mockReturnValue(result({ rows: [row()] }))
    snapshotGetMock.mockResolvedValue({ status: 'success', data: row() })
    snapshotContentMock.mockResolvedValue({
      status: 'success',
      data: {
        artifact: row(),
        files: [
          { name: 'prometheus.yml', content: 'global:\n  scrape_interval: 15s\n' },
          { name: 'targets/node.json', content: '[{"targets":["10.0.0.1:9100"]}]' },
        ],
      },
    })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /详情/ }))
    expect(await screen.findByText('prometheus.yml')).toBeInTheDocument()
    expect(screen.getByText('targets/node.json')).toBeInTheDocument()
    expect(await screen.findByText(/scrape_interval: 15s/)).toBeInTheDocument()
  })

  it('只读页面：无回滚 / 重试 / 下发动作', async () => {
    useConfigSnapshotsMock.mockReturnValue(result({ rows: [row()] }))
    renderPage()
    expect(await screen.findByText('20261111-0a1b')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /回滚/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /重试/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /下发/ })).not.toBeInTheDocument()
  })
})

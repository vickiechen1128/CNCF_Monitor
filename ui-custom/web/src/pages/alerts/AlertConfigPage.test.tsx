import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from 'antd'
import { setupAntdTest } from '../../test/antdTestUtils'
import { AlertConfigPage } from './AlertConfigPage'
import type { AlertmanagerConfigVersionListItem } from '../../types/alertmanager'

const useAlertConfigMock = vi.fn()
const getVersionMock = vi.fn()
const manualReloadMock = vi.fn()

vi.mock('./useAlertConfig', () => ({
  useAlertConfig: (...a: unknown[]) => useAlertConfigMock(...a),
}))

vi.mock('../../api/alertmanager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/alertmanager')>()
  return {
    ...actual,
    alertmanagerConfigApi: {
      getVersion: (...a: unknown[]) => getVersionMock(...a),
      reload: (...a: unknown[]) => manualReloadMock(...a),
    },
  }
})

const reloadMock = vi.fn()
const downloadMock = vi.fn()

vi.mock('../../utils/triggerBlobDownload', () => ({
  triggerBlobDownload: (...a: unknown[]) => downloadMock(...a),
}))

const versionRow = (over: Partial<AlertmanagerConfigVersionListItem> = {}): AlertmanagerConfigVersionListItem => ({
  id: 'acv-1',
  checksum: '7e1b4d9c2a6f8e0d3b9a1c5e7f2d4b8c',
  generated_at: '2026-11-16T10:00:00Z',
  generated_by: 'chenrt',
  is_current: false,
  created_at: '2026-11-16T10:00:00Z',
  ...over,
})

function result(over: Record<string, unknown> = {}) {
  return {
    current: null,
    lastReload: null,
    versions: [],
    total: 0,
    loading: false,
    error: null,
    permissionDenied: false,
    reload: reloadMock,
    page: 1,
    pageSize: 20,
    ...over,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <App>
        <AlertConfigPage />
      </App>
    </MemoryRouter>,
  )
}

describe('AlertConfigPage（告警配置只读视图，v3）', () => {
  setupAntdTest()

  beforeEach(() => {
    useAlertConfigMock.mockReset()
    getVersionMock.mockReset()
    downloadMock.mockReset()
    manualReloadMock.mockReset()
    reloadMock.mockReset()
  })

  const expandIntroGuide = () => {
    fireEvent.click(screen.getByTestId('alert-config-intro-guide-label'))
  }

  it('加载中提示', () => {
    useAlertConfigMock.mockReturnValue(result({ loading: true }))
    renderPage()
    expect(screen.getByText('告警配置')).toBeInTheDocument()
    expect(screen.getByText('加载中…')).toBeInTheDocument()
  })

  it('空态：无当前生效配置时引导去「路由规则」页，保存后立即生效', () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    expect(screen.getByText(/当前无生效配置/)).toBeInTheDocument()
    expect(screen.getByText(/保存后立即生效/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '「路由规则」' })).toHaveAttribute('href', '/routes')
  })

  it('不再提供导入 / 手写说明 / 变更单入口', () => {
    useAlertConfigMock.mockReturnValue(result({ versions: [versionRow()], total: 1 }))
    renderPage()
    expect(screen.queryByTestId('alert-import-card')).toBeNull()
    expect(screen.queryByTestId('import-config-button')).toBeNull()
    expect(screen.queryByTestId('alert-advanced-collapse')).toBeNull()
    expect(document.body.textContent ?? '').not.toContain('导入整份配置文件')
    // v3：告警配置页不再出现 M09 变更单 / 确认下发语义
    expect(document.body.textContent ?? '').not.toContain('变更单')
    expect(document.body.textContent ?? '').not.toContain('待确认下发')
    expect(document.body.textContent ?? '').not.toContain('配置变更确认')
  })

  it('配置版本历史：常驻可见，且位于现状卡之后', () => {
    useAlertConfigMock.mockReturnValue(result({ versions: [versionRow()], total: 1 }))
    renderPage()
    expect(screen.getByTestId('alert-versions-card')).toBeInTheDocument()
    expect(screen.getByText('配置版本历史')).toBeInTheDocument()
    const domOrder = Array.from(document.querySelectorAll('[data-testid]'))
      .map((el) => el.getAttribute('data-testid'))
    expect(domOrder.indexOf('alert-current-card')).toBeLessThan(domOrder.indexOf('alert-versions-card'))
  })

  it('PageIntro：副标为只读视图，说明区默认收起且不含确认下发口径', () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    expect(screen.getByTestId('alert-config-intro')).toBeInTheDocument()
    expect(screen.getByTestId('alert-config-intro-subtitle').textContent ?? '').toContain(
      '查看当前生效的告警配置与历史版本',
    )
    expandIntroGuide()
    const points = screen.getByTestId('alert-config-intro-guide-points')
    expect(points.querySelectorAll('li').length).toBeGreaterThanOrEqual(3)
    expect(points.textContent ?? '').toContain('立即 reload 生效')
    expect(points.textContent ?? '').not.toContain('变更单')
  })

  it('渲染当前生效版本、生成信息、最近 reload 与折叠 YAML', async () => {
    useAlertConfigMock.mockReturnValue(
      result({
        current: {
          id: 'acv-1',
          content: 'global:\n  resolve_timeout: 30s',
          checksum: 'abc',
          generated_at: '2026-11-16T10:00:00Z',
          generated_by: 'chenrt',
          is_current: true,
        },
        lastReload: {
          id: '7',
          status: 'succeeded',
          trigger: 'route_save',
          started_at: '2026-11-16T10:00:01Z',
          duration_ms: 980,
        },
        versions: [versionRow({ is_current: true })],
        total: 1,
      }),
    )
    renderPage()
    expect((await screen.findAllByText('acv-1')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('生成时间').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('生成人').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/最近重载：成功/)).toBeInTheDocument()
    // 完整配置默认折叠
    expect(screen.getByText('查看完整配置内容')).toBeInTheDocument()
    expect(screen.queryByText(/resolve_timeout/)).toBeNull()
    fireEvent.click(screen.getByText('查看完整配置内容'))
    expect(await screen.findByText(/resolve_timeout/)).toBeInTheDocument()
  })

  it('最近 reload 回退：展示回退标签', () => {
    useAlertConfigMock.mockReturnValue(
      result({
        current: { id: 'acv-1', content: 'route: {}', checksum: 'abc', is_current: true },
        lastReload: {
          id: '8',
          status: 'rolled_back',
          trigger: 'route_save',
          started_at: '2026-11-16T11:00:00Z',
          duration_ms: 1200,
        },
        versions: [versionRow({ is_current: true })],
        total: 1,
      }),
    )
    renderPage()
    expect(screen.getByText(/最近重载：已回退上一版/)).toBeInTheDocument()
  })

  it('版本历史：当前版本标记「当前生效」，历史版本标记「历史版本」', async () => {
    useAlertConfigMock.mockReturnValue(
      result({
        versions: [versionRow({ id: 'v2', is_current: true }), versionRow({ id: 'v1' })],
        total: 2,
      }),
    )
    renderPage()
    expect(await screen.findAllByText('当前生效')).not.toHaveLength(0)
    expect(screen.getAllByText('历史版本').length).toBeGreaterThanOrEqual(1)
  })

  it('手动重载：调用接口并刷新数据', async () => {
    manualReloadMock.mockResolvedValue({ status: 'success', data: { status: 'succeeded', duration_ms: 870 } })
    useAlertConfigMock.mockReturnValue(
      result({ current: { id: 'acv-1', content: 'route: {}', checksum: 'abc', is_current: true } }),
    )
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /重新加载 Alertmanager/ }))
    await waitFor(() => expect(manualReloadMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(reloadMock).toHaveBeenCalled())
  })

  it('权限不足：显示权限不足空态', () => {
    useAlertConfigMock.mockReturnValue(result({ permissionDenied: true }))
    renderPage()
    expect(screen.getByText('当前账号无此页面查看权限')).toBeInTheDocument()
  })

  it('接口错误：Alert + 重新加载触发 hook reload', () => {
    const res = result({ error: 'boom' })
    useAlertConfigMock.mockReturnValue(res)
    renderPage()
    expect(screen.getByText('配置信息加载失败，请稍后重试')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(res.reload).toHaveBeenCalled()
  })

  it('版本详情支持下载 alertmanager.yml（截图：历史快照可直接落盘）', async () => {
    useAlertConfigMock.mockReturnValue(
      result({ versions: [versionRow()], total: 1 }),
    )
    getVersionMock.mockResolvedValue({ data: { content: 'route:\n  receiver: web\n' } })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /查看/ }))
    const downloadButton = await screen.findByRole('button', { name: /下载 alertmanager.yml/ })
    await waitFor(() => expect(downloadButton).not.toBeDisabled())
    fireEvent.click(downloadButton)

    expect(downloadMock).toHaveBeenCalledWith(expect.any(Blob), 'acv-1-alertmanager.yml')
  })

  it('版本历史：不提供「重新挂载」，操作列只剩只读查看', async () => {
    useAlertConfigMock.mockReturnValue(result({ versions: [versionRow()], total: 1 }))
    renderPage()
    expect(await screen.findByTestId('alert-versions-card')).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toContain('重新挂载')
    expect(screen.queryByRole('button', { name: /重新挂载此版本/ })).toBeNull()
    expect(screen.getByRole('button', { name: /查看/ })).toBeInTheDocument()
  })
})

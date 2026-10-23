import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from 'antd'
import { setupAntdTest } from '../../test/antdTestUtils'
import { AlertConfigPage } from './AlertConfigPage'
import type { AlertmanagerConfigVersionListItem } from '../../types/alertmanager'

const useAlertConfigMock = vi.fn()
const getVersionMock = vi.fn()

vi.mock('./useAlertConfig', () => ({
  useAlertConfig: (...a: unknown[]) => useAlertConfigMock(...a),
}))

vi.mock('../../api/alertmanager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/alertmanager')>()
  return {
    ...actual,
    alertmanagerConfigApi: {
      getVersion: (...a: unknown[]) => getVersionMock(...a),
    },
  }
})

const reloadMock = vi.fn()

const versionRow = (over: Partial<AlertmanagerConfigVersionListItem> = {}): AlertmanagerConfigVersionListItem => ({
  id: 'acv-1',
  checksum: '7e1b4d9c2a6f8e0d3b9a1c5e7f2d4b8c',
  applied_at: '2026-08-31T10:00:00Z',
  applied_by: '张伟（运维）',
  status: 'applied',
  source_change_no: 'CHG-20260831-001',
  created_at: '2026-08-31T10:00:00Z',
  ...over,
})

function result(over: Record<string, unknown> = {}) {
  return {
    current: null,
    versions: [],
    total: 0,
    loading: false,
    error: null,
    permissionDenied: false,
    reload: reloadMock,
    // 与 UseAlertConfigResult 契约一致：分页受控值需回传
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

describe('AlertConfigPage（告警配置只读视图）', () => {
  setupAntdTest()

  beforeEach(() => {
    useAlertConfigMock.mockReset()
    getVersionMock.mockReset()
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

  it('空态：无当前生效配置时引导去「路由规则」页直接配置', () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    expect(screen.getByText(/当前无生效配置/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '「路由规则」' })).toHaveAttribute('href', '/routes')
  })

  // 2026-10-22：导入能力已删除，本页不再提供任何配置入口。
  it('不再提供导入 / 手写说明入口', () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    expect(screen.queryByTestId('alert-import-card')).toBeNull()
    expect(screen.queryByTestId('import-config-button')).toBeNull()
    expect(screen.queryByTestId('alert-advanced-collapse')).toBeNull()
    expect(screen.queryByText('希望直接编辑整份 alertmanager.yml？')).toBeNull()
    expect(screen.queryByText('手写配置说明')).toBeNull()
    expect(document.body.textContent ?? '').not.toContain('导入整份配置文件')
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

  it('PageIntro：副标定位为只读视图，说明区默认收起', () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    expect(screen.getByTestId('alert-config-intro')).toBeInTheDocument()
    expect(screen.getByTestId('alert-config-intro-subtitle').textContent ?? '').toContain(
      '只读查看当前生效的告警配置与历史版本',
    )
    expect(screen.getByTestId('alert-config-intro-guide-label')).toBeInTheDocument()
    expect(screen.queryByTestId('alert-config-intro-guide-points')).toBeNull()
    expandIntroGuide()
    const points = screen.getByTestId('alert-config-intro-guide-points')
    expect(points.querySelectorAll('li').length).toBeGreaterThanOrEqual(3)
    // 跨模块指引：路由去「路由规则」页、渠道去「通知渠道」页
    expect(screen.getByText(/去「路由规则」页直接编辑路由树/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '去写规则 →' })).toHaveAttribute('href', '/rules')
  })

  it('渲染当前生效状态摘要、完整配置（折叠）与版本列表', async () => {
    useAlertConfigMock.mockReturnValue(
      result({
        current: { id: 'acv-1', content: 'global:\n  resolve_timeout: 30s', checksum: 'abc', status: 'applied' },
        versions: [versionRow()],
        total: 1,
      }),
    )
    renderPage()
    expect((await screen.findAllByText('acv-1')).length).toBeGreaterThan(0)
    // 完整配置默认折叠
    expect(screen.getByText('查看完整配置内容')).toBeInTheDocument()
    expect(screen.queryByText(/resolve_timeout/)).toBeNull()
    fireEvent.click(screen.getByText('查看完整配置内容'))
    expect(await screen.findByText(/resolve_timeout/)).toBeInTheDocument()
    expect(screen.getByText('CHG-20260831-001')).toBeInTheDocument()
  })

  // dev-feedback §25 方案 A（前端侧）：applied_at 是唯一真实生效信号。
  it('§25：applied_at 有值 → 展示「已生效」，不出现「待确认下发 / 已应用」', () => {
    useAlertConfigMock.mockReturnValue(
      result({
        current: {
          id: 'acv-1',
          content: 'route:\n  receiver: default',
          checksum: 'abc',
          status: 'applied',
          applied_at: '2026-08-31T10:00:00Z',
          applied_by: '张伟（运维）',
        },
        versions: [versionRow()],
        total: 1,
      }),
    )
    renderPage()
    expect(screen.getAllByText('已生效').length).toBeGreaterThanOrEqual(1)
    expect(document.body.textContent ?? '').not.toContain('已提交，待确认下发')
    expect(document.body.textContent ?? '').not.toContain('需确认下发后才会生效')
    expect(document.body.textContent ?? '').not.toContain('已应用')
  })

  it('§25：applied_at 为空 → 展示「已提交，待确认下发」+ 配置变更单深链', async () => {
    useAlertConfigMock.mockReturnValue(
      result({ current: null, versions: [versionRow({ applied_at: undefined, applied_by: undefined })], total: 1 }),
    )
    renderPage()
    expect(await screen.findAllByText('已提交，待确认下发')).not.toHaveLength(0)
    expect(screen.getAllByText(/需确认下发后才会生效/).length).toBeGreaterThanOrEqual(1)
    const link = screen.getByRole('link', { name: '变更单 CHG-20260831-001' })
    expect(link).toHaveAttribute('href', '/config-preview?change_no=CHG-20260831-001')
    expect(document.body.textContent ?? '').not.toContain('已应用')
    expect(screen.queryByText('已生效')).toBeNull()
  })

  it('§25：applied_at 为空且无变更单号 → 入口落到「配置变更确认」列表页（不造死链）', async () => {
    useAlertConfigMock.mockReturnValue(
      result({
        current: null,
        versions: [versionRow({ applied_at: undefined, applied_by: undefined, source_change_no: undefined })],
        total: 1,
      }),
    )
    renderPage()
    expect(await screen.findAllByText('已提交，待确认下发')).not.toHaveLength(0)
    const link = screen.getByRole('link', { name: '「配置变更确认」' })
    expect(link).toHaveAttribute('href', '/config-preview')
  })

  // dev-feedback #44：status=discarded → 终态 + 恢复指引，无待确认入口。
  it('#44：status=discarded → 展示「已废弃」+ 恢复指引，且无待确认提示/确认入口', async () => {
    useAlertConfigMock.mockReturnValue(
      result({
        current: null,
        versions: [
          versionRow({ status: 'discarded', applied_at: undefined, applied_by: undefined, source_change_no: undefined }),
        ],
        total: 1,
      }),
    )
    renderPage()
    expect(await screen.findAllByText('已废弃')).not.toHaveLength(0)
    expect(screen.getAllByText(/如需生效请重新挂载/).length).toBeGreaterThanOrEqual(1)
    expect(document.body.textContent ?? '').not.toContain('已提交，待确认下发')
    expect(screen.queryByRole('link', { name: '「配置变更确认」' })).toBeNull()
    expect(screen.queryByRole('link', { name: /变更单 CHG-/ })).toBeNull()
  })

  it('权限不足：显示权限不足空态', () => {
    useAlertConfigMock.mockReturnValue(result({ permissionDenied: true }))
    renderPage()
    expect(screen.getByText('当前账号无此页面查看权限')).toBeInTheDocument()
  })

  it('决策 69-③：版本历史的 M09 变更单号渲染为跳转链接', async () => {
    useAlertConfigMock.mockReturnValue(result({ current: null, versions: [versionRow()], total: 1 }))
    renderPage()
    const link = await screen.findByRole('link', { name: 'CHG-20260831-001' })
    expect(link).toHaveAttribute('href', '/config-preview?change_no=CHG-20260831-001')
  })

  it('接口错误：Alert + 重新加载触发 reload', () => {
    const res = result({ error: 'boom' })
    useAlertConfigMock.mockReturnValue(res)
    renderPage()
    expect(screen.getByText('配置信息加载失败，请稍后重试')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重新加载/ }))
    expect(res.reload).toHaveBeenCalled()
  })

  it('版本历史：不再提供「重新挂载此版本」，操作列只剩只读查看', async () => {
    useAlertConfigMock.mockReturnValue(result({ versions: [versionRow()], total: 1 }))
    renderPage()
    expect(await screen.findByTestId('alert-versions-card')).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toContain('重新挂载')
    expect(screen.queryByRole('button', { name: /重新挂载此版本/ })).toBeNull()
    expect(screen.getByRole('button', { name: /查看/ })).toBeInTheDocument()
  })
})

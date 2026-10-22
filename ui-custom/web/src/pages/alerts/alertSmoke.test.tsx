/**
 * Module_08 端到端冒烟（T08-F5 收尾 + T08-F7 告警状态页增量）：告警配置页 / 静默管理页 /
 * 告警状态页在 MainLayout 顶级 tab「告警收敛与通知管理」下通过真实路由渲染，
 * 验证各页可加载、导航联动与默认空态。
 * 通过 mock api/alertmanager 与 api/domain 模块隔离真实后端；覆盖默认/local 主链路的前端可走通断言。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { App } from 'antd'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { setupAntdTest } from '../../test/antdTestUtils'
import { AlertConfigPage } from './AlertConfigPage'
import { SilencesPage } from './SilencesPage'
import { AlertStatusPage } from './AlertStatusPage'

const getCurrentMock = vi.fn()
const getVersionsMock = vi.fn()
const getSilencesMock = vi.fn()
const getPromAlertsMock = vi.fn()
const getAmAlertsMock = vi.fn()
const listDomainsMock = vi.fn()

vi.mock('../../api/alertmanager', () => ({
  alertmanagerConfigApi: {
    getCurrent: (...a: unknown[]) => getCurrentMock(...a),
    getVersions: (...a: unknown[]) => getVersionsMock(...a),
    getVersion: vi.fn(),
    submit: vi.fn(),
    remount: vi.fn(),
  },
  alertmanagerSilenceApi: {
    getSilences: (...a: unknown[]) => getSilencesMock(...a),
    createSilence: vi.fn(),
    deleteSilence: vi.fn(),
  },
  alertStatusApi: {
    getPromAlerts: (...a: unknown[]) => getPromAlertsMock(...a),
    getAlertmanagerAlerts: (...a: unknown[]) => getAmAlertsMock(...a),
  },
  readValidateErrors: vi.fn(() => null),
}))

// 告警状态页网域筛选数据源（M06 网域管理），冒烟中断言空选项降级即可；
// 注意：实现必须在 beforeEach 中重设（setupAntdTest 的 afterEach restoreAllMocks 会清空 vi.fn 实现）
vi.mock('../../api/domain', () => ({
  networkDomainApi: {
    list: (...a: unknown[]) => listDomainsMock(...a),
  },
}))

function renderM08(initialPath: string) {
  return render(
    <App>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          {/* 页面组件自带 MainLayout（与其他模块一致），路由层不再包裹，避免双布局 */}
          <Route path="/alert-config" element={<AlertConfigPage />} />
          <Route path="/silences" element={<SilencesPage />} />
          <Route path="/alert-status" element={<AlertStatusPage />} />
        </Routes>
      </MemoryRouter>
    </App>,
  )
}

describe('M08 alert 端到端冒烟（告警配置 ⇄ 静默管理 导航联动）', () => {
  setupAntdTest()

  beforeEach(() => {
    getCurrentMock.mockReset()
    getVersionsMock.mockReset()
    getSilencesMock.mockReset()
    getPromAlertsMock.mockReset()
    getAmAlertsMock.mockReset()
    listDomainsMock.mockReset()
    // 默认空态：无当前生效、无历史版本、无活跃静默、无告警
    getCurrentMock.mockResolvedValue({ status: 'success', data: null })
    getVersionsMock.mockResolvedValue({ status: 'success', data: { items: [], total: 0 } })
    getSilencesMock.mockResolvedValue({ status: 'success', data: { items: [], total: 0 } })
    getPromAlertsMock.mockResolvedValue({ status: 'success', data: { alerts: [] } })
    getAmAlertsMock.mockResolvedValue({ status: 'success', data: { items: [] } })
    listDomainsMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0 } })
  })

  // 2026-10-22：告警配置页收敛为只读视图，空态引导去「路由规则」页直接配置。
  it('主链路前端可走通：/alert-config 加载告警配置页，顶级 tab + 两二级子项就位', async () => {
    renderM08('/alert-config')
    expect(await screen.findByText(/当前无生效配置/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '「路由规则」' })).toHaveAttribute('href', '/routes')
    expect(screen.getByTestId('alert-config-intro')).toBeInTheDocument()
    // 顶级 tab 用 PRD 模块名（出现于顶部一级 tab 与二级菜单组）
    expect(screen.getAllByText('告警收敛与通知管理').length).toBeGreaterThan(0)
    // 二级导航展示「告警配置 / 静默管理 / 告警状态」
    expect(screen.getAllByText('告警配置').length).toBeGreaterThan(0)
    expect(screen.getAllByText('静默管理').length).toBeGreaterThan(0)
    expect(screen.getAllByText('告警状态').length).toBeGreaterThan(0)
  })

  it('静默管理链路前端可走通：/silences 加载静默页，空态 + 创建入口', async () => {
    renderM08('/silences')
    expect((await screen.findAllByText('静默管理')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /创建静默/ })).toBeInTheDocument()
    expect(screen.getAllByText(/屏蔽特定告警的通知/).length).toBeGreaterThan(0)
  })

  it('导航联动：从 /silences 点击「告警配置」二级菜单切回告警配置页', async () => {
    renderM08('/silences')
    expect((await screen.findAllByText('静默管理')).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('menuitem', { name: /告警配置/ }))
    expect(await screen.findByText(/当前无生效配置/)).toBeInTheDocument()
  })

  it('告警状态链路前端可走通：/alert-status 加载双视图页，Sider 三子项就位且当前项高亮', async () => {
    renderM08('/alert-status')
    // 双 Tab 就位（通知状态 + 当前告警）
    expect(await screen.findByRole('tab', { name: /通知状态/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /当前告警/ })).toBeInTheDocument()
    // 顶级 tab 用 PRD 模块名
    expect(screen.getAllByText('告警收敛与通知管理').length).toBeGreaterThan(0)
    // Sider「告警配置」组三子项展示，当前路由项高亮
    const current = screen.getByRole('menuitem', { name: /告警状态/ })
    expect(current.className).toContain('ant-menu-item-selected')
    // 两视图真实 API 已调用
    expect(getAmAlertsMock).toHaveBeenCalled()
    expect(getPromAlertsMock).toHaveBeenCalled()
  })

  it('导航联动：从 /alert-status 点击「静默管理」二级菜单切换到静默页', async () => {
    renderM08('/alert-status')
    expect(await screen.findByRole('tab', { name: /通知状态/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /静默管理/ }))
    expect((await screen.findAllByText(/屏蔽特定告警的通知/)).length).toBeGreaterThan(0)
  })

  it('接口错误可观测：加载失败展示错误 Alert 与重新加载入口', async () => {
    getCurrentMock.mockRejectedValue(new Error('backend unreachable'))
    getVersionsMock.mockRejectedValue(new Error('backend unreachable'))
    renderM08('/alert-config')
    expect(await screen.findByText('配置信息加载失败，请稍后重试')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重新加载/ })).toBeInTheDocument()
  })

  // 2026-10-22 用户裁决：告警配置页只读，导入能力与策略控件均不得残留。
  it('告警配置页无导入入口 / 策略控件，路由由「路由规则」页直接配置', async () => {
    renderM08('/alert-config')
    expect(await screen.findByText(/当前无生效配置/)).toBeInTheDocument()
    expect(screen.queryByTestId('alert-import-card')).toBeNull()
    expect(screen.queryByTestId('import-config-button')).toBeNull()
    expect(screen.queryByTestId('alert-policy-card')).toBeNull()
    expect(screen.queryByTestId('alert-guide-card')).toBeNull()
    expect(screen.queryByRole('combobox', { name: '没匹配到具体规则的告警，发给哪个渠道' })).toBeNull()
    expect(document.body.textContent ?? '').not.toContain('不接管（保留配置文件里已有的值）')
    expect(document.body.textContent ?? '').not.toContain('路由规则由谁维护')
    expect(document.body.textContent ?? '').not.toContain('默认兜底接收人')
  })

  // T08-F9（#26 / #28.5）收口：旧过渡表述「route 段由你手写维护」在全站消除。
  // 2026-10-02 #39：承载 L3 口径的「平台自动写入 receivers 定义；默认兜底在你选定后由平台接管」
  // 渠道配置在「通知渠道」页的编辑抽屉中维护。
  // 「接收人配置：抽屉展示接收人名 / 桥接地址 / 片段…」用例；此处只守派生预览迁移后的无残留。
  it('T08-F9（#39）：派生预览已迁至「通知渠道」页，本页无旧宣传残留', async () => {
    renderM08('/alert-config')
    expect(await screen.findByTestId('alert-config-intro')).toBeInTheDocument()
    // 旧的派生预览面板标题与「枚举式」表述均已消失
    expect(document.body.textContent ?? '').not.toContain('派生预览：平台将写入的接收人')
    expect(document.body.textContent ?? '').not.toContain('平台自动生成的接收人')
    // 旧的一期过渡表述在全站消除
    expect(document.body.textContent ?? '').not.toContain('route 段由你手写维护')
    expect(document.body.textContent ?? '').not.toContain('route 段由用户手写维护')
  })
})
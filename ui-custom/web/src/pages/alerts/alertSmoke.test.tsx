/**
 * Module_08 端到端冒烟（T08-F5 收尾）：告警配置页 + 静默管理页在 MainLayout 顶级 tab
 * 「告警收敛与通知管理」下通过真实路由渲染，验证两页可加载、导航联动与默认空态。
 * 通过 mock api/alertmanager 模块隔离真实后端；覆盖默认/local 主链路的前端可走通断言。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { App } from 'antd'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { setupAntdTest } from '../../test/antdTestUtils'
import { AlertConfigPage } from './AlertConfigPage'
import { SilencesPage } from './SilencesPage'

const getCurrentMock = vi.fn()
const getVersionsMock = vi.fn()
const getSilencesMock = vi.fn()

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
  readValidateErrors: vi.fn(() => null),
}))

function renderM08(initialPath: string) {
  return render(
    <App>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          {/* 页面组件自带 MainLayout（与其他模块一致），路由层不再包裹，避免双布局 */}
          <Route path="/alert-config" element={<AlertConfigPage />} />
          <Route path="/silences" element={<SilencesPage />} />
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
    // 默认空态：无当前生效、无历史版本、无活跃静默
    getCurrentMock.mockResolvedValue({ status: 'success', data: null })
    getVersionsMock.mockResolvedValue({ status: 'success', data: { items: [], total: 0 } })
    getSilencesMock.mockResolvedValue({ status: 'success', data: { items: [], total: 0 } })
  })

  it('主链路前端可走通：/alert-config 加载告警配置页，顶级 tab + 两二级子项就位', async () => {
    renderM08('/alert-config')
    // Load 态结束后渲染当前生效空态 + 挂载入口
    expect(await screen.findByText('当前无生效配置，点击「挂载新配置」上传或粘贴 alertmanager.yml')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /挂载新配置/ })).toBeInTheDocument()
    // 顶级 tab 用 PRD 模块名（出现于顶部一级 tab 与二级菜单组）
    expect(screen.getAllByText('告警收敛与通知管理').length).toBeGreaterThan(0)
    // 二级导航展示「告警配置 / 静默管理」
    expect(screen.getAllByText('告警配置').length).toBeGreaterThan(0)
    expect(screen.getAllByText('静默管理').length).toBeGreaterThan(0)
  })

  it('静默管理链路前端可走通：/silences 加载静默页，空态 + 创建入口', async () => {
    renderM08('/silences')
    expect((await screen.findAllByText('静默管理')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /创建静默/ })).toBeInTheDocument()
    expect(screen.getAllByText('主动静默').length).toBeGreaterThan(0)
  })

  it('导航联动：从 /silences 点击「告警配置」二级菜单切回告警配置页', async () => {
    renderM08('/silences')
    expect((await screen.findAllByText('静默管理')).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('menuitem', { name: /告警配置/ }))
    expect(await screen.findByText('当前无生效配置，点击「挂载新配置」上传或粘贴 alertmanager.yml')).toBeInTheDocument()
  })

  it('接口错误可观测：加载失败展示错误 Alert 与重新加载入口', async () => {
    getCurrentMock.mockRejectedValue(new Error('backend unreachable'))
    getVersionsMock.mockRejectedValue(new Error('backend unreachable'))
    renderM08('/alert-config')
    expect(await screen.findByText('配置信息加载失败，请稍后重试')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重新加载/ })).toBeInTheDocument()
  })
})
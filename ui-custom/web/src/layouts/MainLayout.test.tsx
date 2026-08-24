import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { setupAntdTest } from '../test/antdTestUtils'
import { MainLayout } from './MainLayout'

describe('MainLayout', () => {
  setupAntdTest()

  it('shows 采集器管理 as a Sider sub-item under 采集策略 module (F-09)', () => {
    render(
      <MemoryRouter initialEntries={['/collectors']}>
        <Routes>
          <Route path="/collectors" element={<MainLayout>collector-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )
    // 顶部一级 tab 用 PRD 模块名「采集策略」
    expect(screen.getByText('采集策略')).toBeInTheDocument()
    // Sider 二级含「采集器管理」，且位于「采集 Job」之前（动线：先采集器、后 Job）
    const siderTexts = screen
      .getAllByRole('menuitem')
      .map((el) => el.textContent ?? '')
    expect(siderTexts.some((t) => t.includes('采集器管理'))).toBe(true)
    expect(siderTexts.some((t) => t.includes('采集 Job'))).toBe(true)
    const collectorsIdx = siderTexts.findIndex((t) => t.includes('采集器管理'))
    const jobsIdx = siderTexts.findIndex((t) => t.includes('采集 Job'))
    expect(collectorsIdx).toBeGreaterThan(-1)
    expect(collectorsIdx).toBeLessThan(jobsIdx)
    expect(screen.getByText('collector-content')).toBeInTheDocument()
  })

  it('navigates to /collectors when 采集器管理 sub-item clicked', () => {
    render(
      <MemoryRouter initialEntries={['/scrape-jobs']}>
        <Routes>
          <Route path="/scrape-jobs" element={<MainLayout>jobs-content</MainLayout>} />
          <Route path="/collectors" element={<MainLayout>collector-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('jobs-content')).toBeInTheDocument()
    fireEvent.click(screen.getByText('采集器管理'))
    // 真实路由导航：Content 由 jobs-content 切换为 collector-content
    expect(screen.getByText('collector-content')).toBeInTheDocument()
    expect(screen.queryByText('jobs-content')).toBeNull()
  })

  it('under 系统与平台管理 renders M06 网域管理 + M09 两个一级菜单组（N2-1）', () => {
    render(
      <MemoryRouter initialEntries={['/deployments']}>
        <Routes>
          <Route path="/deployments" element={<MainLayout>deployments-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('系统与平台管理')).toBeInTheDocument()
    // 既有 M06「网域管理」保留
    expect(screen.getByText('网域管理')).toBeInTheDocument()
    // 组「网域与节点管理」及其子项
    expect(screen.getByText('网域与节点管理')).toBeInTheDocument()
    expect(screen.getByText('网域纳管')).toBeInTheDocument()
    expect(screen.getByText('采集节点状态')).toBeInTheDocument()
    // 组「配置下发」及其子项
    expect(screen.getByText('配置下发')).toBeInTheDocument()
    expect(screen.getByText('配置变更确认')).toBeInTheDocument()
    expect(screen.getByText('下发记录')).toBeInTheDocument()
    expect(screen.getByText('deployments-content')).toBeInTheDocument()
  })

  it('highlights 下发记录 sub-item when route is /deployments (M09)', () => {
    render(
      <MemoryRouter initialEntries={['/deployments']}>
        <Routes>
          <Route path="/deployments" element={<MainLayout>deployments-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )
    const selected = screen
      .getAllByRole('menuitem')
      .find((el) => (el.textContent || '').includes('下发记录'))
    expect(selected).toBeDefined()
    expect(selected?.className ?? '').toContain('ant-menu-item-selected')
  })

  it('resolves /domain-onboarding、/node-status、/config-preview to 系统与平台管理 module tab', () => {
    render(
      <MemoryRouter initialEntries={['/config-preview']}>
        <Routes>
          <Route path="/config-preview" element={<MainLayout>preview-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )
    // 顶部一级 tab「系统与平台管理」处于 active
    const tab = screen
      .getAllByRole('button')
      .find((el) => (el.textContent || '').includes('系统与平台管理'))
    expect(tab?.className ?? '').toContain('active')
    expect(screen.getByText('preview-content')).toBeInTheDocument()
  })
})

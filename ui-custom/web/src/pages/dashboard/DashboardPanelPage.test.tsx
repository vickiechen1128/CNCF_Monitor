import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupAntdTest } from '../../test/antdTestUtils'
import { DashboardPanelPage } from './DashboardPanelPage'

const TEST_URL = 'http://1.15.11.216:3000/d/StarsL-TenSunS-node/e4b8bb-e69cba-e79b91-e68ea7?var-interval=5m&from=now-30m&to=now&timezone=browser&var-instance=localhost:9100&var-device=$__all&refresh=1m'
const { getPanelMock } = vi.hoisted(() => ({ getPanelMock: vi.fn() }))

vi.mock('../../api/dashboardPanels', () => ({
  dashboardPanelApi: { get: getPanelMock },
}))

vi.mock('../../layouts/MainLayout', () => ({
  MainLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('DashboardPanelPage', () => {
  setupAntdTest()

  beforeEach(() => {
    getPanelMock.mockReset()
  })

  it('embeds the complete Grafana URL in kiosk mode', async () => {
    getPanelMock.mockResolvedValue({
      status: 'success',
      data: { id: 7, name: '节点监控大屏', url: TEST_URL },
    })
    render(
      <MemoryRouter initialEntries={['/dashboard/panels/7']}>
        <Routes>
          <Route path="/dashboard/panels/:id" element={<DashboardPanelPage />} />
        </Routes>
      </MemoryRouter>,
    )

    const iframe = await screen.findByTitle('节点监控大屏')
    expect(screen.queryByRole('heading', { name: '节点监控大屏' })).not.toBeInTheDocument()
    expect(iframe).toHaveAttribute('src', `${TEST_URL}&kiosk&hideLogo=true`)
    expect(iframe).not.toHaveAttribute('scrolling')
    expect(getPanelMock).toHaveBeenCalledWith('7')
  })

  it('shows a retryable error when panel loading fails', async () => {
    getPanelMock.mockRejectedValue(new Error('面板不存在'))
    render(
      <MemoryRouter initialEntries={['/dashboard/panels/999']}>
        <Routes>
          <Route path="/dashboard/panels/:id" element={<DashboardPanelPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('面板不存在')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument()
  })
})

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { setupAntdTest } from '../../test/antdTestUtils'
import { DashboardFrame } from './DashboardFrame'

describe('DashboardFrame', () => {
  setupAntdTest()

  it('renders the kiosk URL and keeps the fragment at the end', async () => {
    render(
      <DashboardFrame
        url="http://grafana.example.com/d/abc/overview?x=1#panel-2"
        title="节点监控大屏"
      />,
    )

    const iframe = await screen.findByTitle('节点监控大屏')
    expect(iframe).toHaveAttribute(
      'src',
      'http://grafana.example.com/d/abc/overview?x=1&kiosk&hideLogo=true#panel-2',
    )
    expect(screen.getByTestId('dashboard-frame-loading')).toBeInTheDocument()
  })

  it('degrades to a readable message instead of crashing on an invalid URL', async () => {
    render(<DashboardFrame url="not-a-url" title="脏数据面板" />)

    expect(await screen.findByText('大屏地址不可用')).toBeInTheDocument()
    expect(screen.queryByTitle('脏数据面板')).not.toBeInTheDocument()
  })

  it('shows the fullscreen control only when requested', async () => {
    const { unmount } = render(
      <DashboardFrame url="http://grafana.example.com/d/abc/overview" title="大屏 A" />,
    )
    await screen.findByTitle('大屏 A')
    expect(screen.queryByRole('button', { name: '全屏' })).not.toBeInTheDocument()
    unmount()

    render(
      <DashboardFrame
        url="http://grafana.example.com/d/abc/overview"
        title="大屏 B"
        showFullscreen
      />,
    )
    await screen.findByTitle('大屏 B')
    expect(screen.getByRole('button', { name: '全屏' })).toBeInTheDocument()
  })
})

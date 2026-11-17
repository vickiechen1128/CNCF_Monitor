import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupAntdTest } from '../../test/antdTestUtils'
import { VisualizationPage } from './VisualizationPage'

const { listMock, getStoredUserMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  getStoredUserMock: vi.fn(),
}))

vi.mock('../../api/dashboardPanels', () => ({
  dashboardPanelApi: { list: listMock },
}))

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>()
  return { ...actual, getStoredUser: getStoredUserMock }
})

vi.mock('../../layouts/MainLayout', () => ({
  MainLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const PANELS = {
  status: 'success',
  data: {
    list: [
      { id: 1, name: '节点监控大屏', url: 'http://grafana.example.com/d/node/overview' },
      { id: 2, name: '业务监控大屏', url: 'http://grafana.example.com/d/biz/overview' },
    ],
    total: 2,
    page: 1,
    page_size: 100,
  },
}

/** Select 的选中项也带 title，不能直接用 screen.findByTitle 取 iframe。 */
async function findFrame(title: string): Promise<HTMLIFrameElement> {
  let frame: HTMLIFrameElement | null = null
  await waitFor(() => {
    frame = document.querySelector<HTMLIFrameElement>(`iframe[title="${title}"]`)
    expect(frame).not.toBeNull()
  })
  return frame as unknown as HTMLIFrameElement
}

describe('VisualizationPage', () => {
  setupAntdTest()

  beforeEach(() => {
    listMock.mockReset()
    getStoredUserMock.mockReturnValue({ id: 'admin', username: 'admin', role: 'admin' })
    listMock.mockResolvedValue(PANELS)
  })

  it('embeds the first panel with kiosk mode by default', async () => {
    render(
      <MemoryRouter initialEntries={['/visualization']}>
        <VisualizationPage />
      </MemoryRouter>,
    )

    const iframe = await findFrame('节点监控大屏')
    expect(iframe).toHaveAttribute(
      'src',
      'http://grafana.example.com/d/node/overview?kiosk&hideLogo=true',
    )
  })

  it('honours ?panel=<id> so a big screen URL can be shared', async () => {
    render(
      <MemoryRouter initialEntries={['/visualization?panel=2']}>
        <VisualizationPage />
      </MemoryRouter>,
    )

    expect(await findFrame('业务监控大屏')).toBeInTheDocument()
    expect(document.querySelector('iframe[title="节点监控大屏"]')).toBeNull()
  })

  it('guides administrators to panel mounting when nothing is mounted', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [], total: 0, page: 1, page_size: 100 },
    })
    render(
      <MemoryRouter initialEntries={['/visualization']}>
        <VisualizationPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('尚未挂载可视化大屏')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '面板挂载' })).toHaveAttribute(
      'href',
      '/admin/dashboard-panels',
    )
  })
})

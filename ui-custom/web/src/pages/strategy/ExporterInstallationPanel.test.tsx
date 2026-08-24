import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { setupAntdTest } from '../../test/antdTestUtils'
import { ExporterInstallationPanel } from './ExporterInstallationPanel'

const instancesMock = vi.fn()
const confirmMock = vi.fn()
const unconfirmMock = vi.fn()

vi.mock('../../api/scrapeJobs', () => ({
  scrapeJobApi: {
    instances: (...args: unknown[]) => instancesMock(...args),
    confirmInstance: (...args: unknown[]) => confirmMock(...args),
    unconfirmInstance: (...args: unknown[]) => unconfirmMock(...args),
  },
}))

beforeEach(() => {
  instancesMock.mockReset()
  confirmMock.mockReset()
  unconfirmMock.mockReset()
})

describe('ExporterInstallationPanel', () => {
  setupAntdTest()

  it('shows guidance alert when no jobId', () => {
    render(<ExporterInstallationPanel jobId={0} />)
    expect(screen.getByText('保存采集任务后可进行 Exporter 安装确认')).toBeInTheDocument()
  })

  it('renders instances with unconfirmed/confirmed status', async () => {
    instancesMock.mockResolvedValue({
      status: 'success',
      data: {
        items: [
          { resource_id: 'a', instance_name: 'inst-a', instance_ip: '10.0.0.1', status: 'unconfirmed' },
          { resource_id: 'b', instance_name: 'inst-b', instance_ip: '10.0.0.2', status: 'confirmed' },
        ],
        total: 2,
      },
    })

    render(<ExporterInstallationPanel jobId={1} />)

    expect(await screen.findByText('inst-a')).toBeInTheDocument()
    expect(screen.getByText('待确认')).toBeInTheDocument()
    expect(screen.getByText('已确认')).toBeInTheDocument()
  })

  it('confirm calls confirmInstance with confirmed_by=platform_admin', async () => {
    // 首次加载返回 unconfirmed（显示「确认安装」），确认后刷新返回 confirmed
    instancesMock
      .mockResolvedValueOnce({
        status: 'success',
        data: {
          items: [{ resource_id: 'a', instance_name: 'inst-a', instance_ip: '10.0.0.1', status: 'unconfirmed' }],
          total: 1,
        },
      })
      .mockResolvedValue({
        status: 'success',
        data: {
          items: [{ resource_id: 'a', instance_name: 'inst-a', instance_ip: '10.0.0.1', status: 'confirmed' }],
          total: 1,
        },
      })
    confirmMock.mockResolvedValue({ status: 'success', data: { resource_id: 'a', scrape_job_id: 1, status: 'confirmed' } })

    render(<ExporterInstallationPanel jobId={1} />)

    const btn = await screen.findByRole('button', { name: /确认安装/ })
    btn.click()

    await waitFor(() => expect(confirmMock).toHaveBeenCalledWith(1, 'a', { confirmed_by: 'platform_admin' }))
  })
})
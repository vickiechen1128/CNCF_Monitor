import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { setupAntdTest } from '../../test/antdTestUtils'
import { ExporterInstallationPanel } from './ExporterInstallationPanel'
import { DOWN_TOOLTIP } from './strategyConstants'
import type { PromVectorItem } from '../../types/query'

const instancesMock = vi.fn()
const confirmMock = vi.fn()
const unconfirmMock = vi.fn()
const queryMock = vi.fn()

function vector(result: PromVectorItem[]) {
  return { status: 'success', data: { resultType: 'vector' as const, result } }
}

vi.mock('../../api/scrapeJobs', () => ({
  scrapeJobApi: {
    instances: (...args: unknown[]) => instancesMock(...args),
    confirmInstance: (...args: unknown[]) => confirmMock(...args),
    unconfirmInstance: (...args: unknown[]) => unconfirmMock(...args),
  },
}))

// F-10：实例状态回显改由中心 up 指标（M02 /api/v1/query）推导
vi.mock('../../api/query', () => ({
  queryApi: { query: (...args: unknown[]) => queryMock(...args) },
}))

beforeEach(() => {
  instancesMock.mockReset()
  confirmMock.mockReset()
  unconfirmMock.mockReset()
  queryMock.mockReset()
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

  it('已确认下发时回显实例采集状态汇总（在线/待采集）+ down 行提示文案', async () => {
    instancesMock.mockResolvedValue({
      status: 'success',
      data: {
        items: [
          { resource_id: 'a', instance_name: 'inst-a', instance_ip: '10.0.0.1', status: 'confirmed' },
          { resource_id: 'b', instance_name: 'inst-b', instance_ip: '10.0.0.2', status: 'confirmed' },
        ],
        total: 2,
      },
    })
    queryMock.mockResolvedValue(
      vector([
        { metric: { __name__: 'up', job: 'j', instance: '10.0.0.1:9104', resource_id: 'a' }, value: [0, '1'] },
        { metric: { __name__: 'up', job: 'j', instance: '10.0.0.2:9104', resource_id: 'b' }, value: [0, '0'] },
      ]),
    )

    render(<ExporterInstallationPanel jobId={1} jobName="j" deployed />)

    expect(await screen.findByText('在线 1')).toBeInTheDocument()
    expect(screen.getByText(/实例总数 2/)).toBeInTheDocument()
    expect(screen.getByText(/待采集 0/)).toBeInTheDocument()
    expect(screen.getByText('采集中')).toBeInTheDocument()
    expect(screen.getByText('已下发未采到')).toBeInTheDocument()
    // antd Tooltip 内容挂载到 portal，需 hover 触发后断言引导文案
    fireEvent.mouseEnter(screen.getByText('已下发未采到'))
    expect(await screen.findByText(DOWN_TOOLTIP)).toBeInTheDocument()
    expect(queryMock).toHaveBeenCalledWith({ query: 'up{job="j"}' })
  })

  it('变更未确认下发时实例全部显待采集', async () => {
    instancesMock.mockResolvedValue({
      status: 'success',
      data: {
        items: [{ resource_id: 'a', instance_name: 'inst-a', instance_ip: '10.0.0.1', status: 'confirmed' }],
        total: 1,
      },
    })
    render(<ExporterInstallationPanel jobId={1} jobName="j" deployed={false} />)
    expect(await screen.findByText('待采集')).toBeInTheDocument()
    expect(queryMock).not.toHaveBeenCalled()
  })
})
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { message } from 'antd'
import { EdgePackageDownloadPanel } from './EdgePackageDownloadPanel'
import { triggerBlobDownload } from '../../../utils/triggerBlobDownload'
import { setupAntdTest } from '../../../test/antdTestUtils'
import type { EdgePackage } from '../../../types/config-center'

const listMock = vi.fn()
const downloadMock = vi.fn()

vi.mock('../../../api/edgePackages', () => ({
  edgePackageApi: {
    list: (...args: unknown[]) => listMock(...args),
    download: (...args: unknown[]) => downloadMock(...args),
  },
}))

vi.mock('../../../utils/triggerBlobDownload', () => ({
  triggerBlobDownload: vi.fn(),
}))

const pkg = (over: Partial<EdgePackage> = {}): EdgePackage => ({
  id: 'release-v1.2.0',
  version: 'v1.2.0',
  sha256: 'a'.repeat(64), // 长 sha256 触发省略展示
  size_bytes: 84212533,
  components: [
    { name: 'edge-sync-agent', version: 'v1.2.0' },
    { name: 'vmagent', version: 'v1.101.0' },
    { name: 'blackbox_exporter', version: 'v0.25.0' },
  ],
  download_url: '/api/v2/platform/edge-packages/v1.2.0/download',
  ...over,
})

function renderPanel(active?: boolean) {
  return render(<EdgePackageDownloadPanel active={active} />)
}

describe('EdgePackageDownloadPanel（T11-22 离线包下载区）', () => {
  setupAntdTest()

  beforeEach(() => {
    listMock.mockReset()
    downloadMock.mockReset()
    vi.mocked(triggerBlobDownload).mockReset()
    URL.createObjectURL = vi.fn(() => 'blob:mock')
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(message, 'success').mockImplementation(() => undefined)
    vi.spyOn(message, 'error').mockImplementation(() => undefined)
  })

  it('渲染版本清单：版本 / 大小 MB / sha256 省略 + 组件版本', async () => {
    listMock.mockResolvedValue({ status: 'success', data: [pkg()] })
    renderPanel()

    expect(await screen.findByText('离线安装包')).toBeInTheDocument()
    expect(screen.getByText('v1.2.0')).toBeInTheDocument()
    // 大小格式化为 MB（84212533 B ≈ 80.31 MB）
    expect(screen.getByText('80.31 MB')).toBeInTheDocument()
    // sha256 长串省略展示（前 16 位 + '…'）
    expect(screen.getByText('aaaaaaaaaaaaaaaa…')).toBeInTheDocument()
    // 组件版本标签
    expect(screen.getByText('edge-sync-agent v1.2.0')).toBeInTheDocument()
    expect(screen.getByText('vmagent v1.101.0')).toBeInTheDocument()
    expect(screen.getByText('blackbox_exporter v0.25.0')).toBeInTheDocument()
  })

  it('短 sha256 不省略，直接展示全量', async () => {
    listMock.mockResolvedValue({ status: 'success', data: [pkg({ sha256: 'abc123' })] })
    renderPanel()

    expect(await screen.findByText('abc123')).toBeInTheDocument()
  })

  it('空清单渲染空态占位', async () => {
    listMock.mockResolvedValue({ status: 'success', data: [] })
    renderPanel()

    expect(await screen.findByText('暂无可下载的离线安装包')).toBeInTheDocument()
  })

  it('懒加载：active=false 不发请求，转 true 后仅拉取一次', async () => {
    listMock.mockResolvedValue({ status: 'success', data: [pkg()] })
    const { rerender } = renderPanel(false)
    // 折叠态：不渲染清单也不发起请求
    expect(listMock).not.toHaveBeenCalled()
    expect(screen.queryByText('离线安装包')).toBeNull()

    // 展开后拉取一次
    rerender(<EdgePackageDownloadPanel active />)
    expect(await screen.findByText('离线安装包')).toBeInTheDocument()
    expect(listMock).toHaveBeenCalledTimes(1)
  })

  it('StrictMode（effect 双调用）下仍渲染清单，不停留在 spinner（回归：永久转圈）', async () => {
    listMock.mockResolvedValue({ status: 'success', data: [pkg()] })
    const { container } = render(
      <React.StrictMode>
        <EdgePackageDownloadPanel active />
      </React.StrictMode>,
    )

    // 修复前：第二次 effect 被 fetchedRef 短路且第一次请求回调被 cancelled 挡住，
    // loading 永远为 true，此处会超时失败（只剩 spinner）。
    expect(await screen.findByText('v1.2.0')).toBeInTheDocument()
    expect(screen.getByText('离线安装包')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /下载安装包/ })).toBeInTheDocument()
    expect(container.querySelector('.ant-spin')).toBeNull()
  })

  it('列表加载失败给出 error Alert', async () => {
    listMock.mockRejectedValue(new Error('网络异常'))
    renderPanel()

    expect(await screen.findByText('离线安装包清单加载失败，请稍后重试')).toBeInTheDocument()
    expect(screen.getByText('网络异常')).toBeInTheDocument()
  })

  it('点击「下载安装包」触发 blob 下载，缺 file 时回落 edge-sync-agent-<version>-linux-amd64.tar.gz', async () => {
    listMock.mockResolvedValue({ status: 'success', data: [pkg()] })
    downloadMock.mockResolvedValue(new Blob(['tarball'], { type: 'application/gzip' }))
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: /下载安装包/ }))
    await waitFor(() => expect(downloadMock).toHaveBeenCalledWith('v1.2.0'))
    expect(vi.mocked(triggerBlobDownload)).toHaveBeenCalledWith(
      expect.any(Blob),
      'edge-sync-agent-v1.2.0-linux-amd64.tar.gz',
    )
    expect(message.success).toHaveBeenCalledWith('安装包 v1.2.0 下载已开始')
  })

  it('后端返回 file 字段时，以真实 tar.gz 文件名下载', async () => {
    const file = 'edge-sync-agent-v0.2.0-linux-amd64-20260922-121018.tar.gz'
    listMock.mockResolvedValue({ status: 'success', data: [pkg({ file })] })
    downloadMock.mockResolvedValue(new Blob(['tarball'], { type: 'application/gzip' }))
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: /下载安装包/ }))
    await waitFor(() => expect(downloadMock).toHaveBeenCalledWith('v1.2.0'))
    expect(vi.mocked(triggerBlobDownload)).toHaveBeenCalledWith(expect.any(Blob), file)
  })

  it('下载失败给出 error 提示', async () => {
    listMock.mockResolvedValue({ status: 'success', data: [pkg()] })
    downloadMock.mockRejectedValue(new Error('下载失败'))
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: /下载安装包/ }))
    await waitFor(() => expect(message.error).toHaveBeenCalledWith('下载失败'))
  })
})
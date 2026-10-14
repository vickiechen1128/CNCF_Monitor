import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StorageLogPage } from './StorageLogPage'
import { setupAntdTest } from '../../../test/antdTestUtils'
import type { StorageLogOverview } from '../../../types/storage'

const overviewMock = vi.fn()
const updateMock = vi.fn()

vi.mock('../../../api/storage', () => ({
  storageLogApi: {
    overview: (...a: unknown[]) => overviewMock(...a),
    updateRetention: (...a: unknown[]) => updateMock(...a),
  },
}))

// vitest jsdom 的 window.localStorage 行为不可靠（MainLayout 会读写侧栏折叠偏好），
// 用内存 Map 替换，避免 clear / getItem 非函数导致用例间互相污染。
const storageMap = new Map<string, string>()
const localStorageMock: Storage = {
  get length() {
    return storageMap.size
  },
  clear: () => storageMap.clear(),
  getItem: (key) => storageMap.get(key) ?? null,
  key: (index) => Array.from(storageMap.keys())[index] ?? null,
  removeItem: (key) => storageMap.delete(key),
  setItem: (key, value) => storageMap.set(key, String(value)),
}
Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true })

/** 构造一份总览数据；over 可覆盖 retention 的任意字段。 */
function overview(over: Partial<StorageLogOverview['retention']> = {}): StorageLogOverview {
  return {
    retention: {
      desired: { time: '15d', size: '2GB' },
      runtime: { time: '15d', size: '2GiB' },
      source: 'env_file',
      env_file: '/data/config-output/prom-retention.env',
      env_file_exists: true,
      runtime_available: true,
      pending_restart: false,
      ...over,
    },
    disks: [
      {
        label: 'TSDB 数据目录',
        path: '/data/prometheus',
        total_bytes: 1024 * 1024 * 1024 * 100,
        used_bytes: 1024 * 1024 * 1024 * 40,
        free_bytes: 1024 * 1024 * 1024 * 60,
        usage_percent: 40,
      },
    ],
    log_rotation: {
      mechanism: 'logrotate',
      active: true,
      config_path: '/etc/logrotate.d/metric-center',
      content: '/opt/log/metric-center/*.log { daily; rotate 14 }',
      summary: '运行日志按 logrotate 策略轮转，修改配置后下一次轮转周期生效，无需重启任何进程。',
    },
  }
}

function result(data: StorageLogOverview) {
  return { status: 'success', data }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/storage-logs']}>
      <StorageLogPage />
    </MemoryRouter>,
  )
}

describe('StorageLogPage', () => {
  setupAntdTest()

  beforeEach(() => {
    storageMap.clear()
    overviewMock.mockReset()
    updateMock.mockReset()
  })

  it('渲染保留策略期望值 / 运行时值与来源，归一化同值展示「已生效」', async () => {
    overviewMock.mockResolvedValue(result(overview()))
    renderPage()

    expect(await screen.findByText('TSDB 保留策略')).toBeInTheDocument()
    // 期望值与运行时值并列展示（env 2GB vs 运行时 2GiB 属同值不同写法）
    expect(screen.getByText('15d / 2GB')).toBeInTheDocument()
    expect(screen.getByText('15d / 2GiB')).toBeInTheDocument()
    expect(screen.getByText('配置文件（页面保存）')).toBeInTheDocument()
    // 「已生效」同时出现在保留策略状态 Tag 与日志轮转 Badge
    expect(screen.getAllByText('已生效').length).toBeGreaterThanOrEqual(2)
    // 表单回填期望值
    expect(screen.getByDisplayValue('15d')).toBeInTheDocument()
    expect(screen.getByDisplayValue('2GB')).toBeInTheDocument()
    // 未达待重启条件时不出现重启指引
    expect(screen.queryByText('保留策略已保存，待重启 Prometheus 生效')).toBeNull()
  })

  it('pending_restart 时展示待重启 Alert（含运维指引与变更影响），且不提供越权重启按钮', async () => {
    overviewMock.mockResolvedValue(
      result(
        overview({
          desired: { time: '30d', size: '20GB' },
          pending_restart: true,
        }),
      ),
    )
    renderPage()

    expect(await screen.findByText('保留策略已保存，待重启 Prometheus 生效')).toBeInTheDocument()
    // 运维重启指引（决策 64：平台不代跑重启）
    expect(screen.getByText(/systemctl restart prometheus/)).toBeInTheDocument()
    // 变更影响说明（边缘补发不丢 / 查询短暂不可用 / 回传延迟短时变橙）
    expect(screen.getByText(/持久化队列补发/)).toBeInTheDocument()
    expect(screen.getByText('待重启生效')).toBeInTheDocument()
    // 无任何越权重启入口
    expect(screen.queryByRole('button', { name: /重启/ })).toBeNull()
  })

  it('Prometheus 不可用时降级展示运行时未知 + info 提示，不阻断页面', async () => {
    overviewMock.mockResolvedValue(
      result(
        overview({
          runtime: null,
          runtime_available: false,
          pending_restart: false,
        }),
      ),
    )
    renderPage()

    expect(await screen.findByText('当前无法读取 Prometheus 运行时参数')).toBeInTheDocument()
    expect(screen.getByText('运行时未知')).toBeInTheDocument()
    expect(screen.getByText('不可用')).toBeInTheDocument()
    expect(screen.getByText('TSDB 数据目录')).toBeInTheDocument()
  })

  it('展示磁盘占用与日志轮转策略（免重启说明）', async () => {
    overviewMock.mockResolvedValue(result(overview()))
    renderPage()

    expect(await screen.findByText('磁盘占用（只读）')).toBeInTheDocument()
    expect(screen.getByText('/data/prometheus')).toBeInTheDocument()
    expect(screen.getByText('40.0 GB')).toBeInTheDocument()

    expect(screen.getByText('运行日志轮转策略')).toBeInTheDocument()
    expect(screen.getByText('/etc/logrotate.d/metric-center')).toBeInTheDocument()
    expect(screen.getByText(/无需重启任何进程/)).toBeInTheDocument()
    expect(screen.getAllByText('已生效').length).toBeGreaterThanOrEqual(2)
  })

  it('保存成功：携带表单值调用 PUT，回传值刷新表单', async () => {
    overviewMock.mockResolvedValue(result(overview()))
    updateMock.mockResolvedValue(
      result(
        overview({
          desired: { time: '30d', size: '20GB' },
          pending_restart: true,
        }),
      ),
    )
    renderPage()
    await screen.findByText('TSDB 保留策略')

    fireEvent.change(screen.getByDisplayValue('15d'), { target: { value: '30d' } })
    fireEvent.change(screen.getByDisplayValue('2GB'), { target: { value: '20GB' } })
    fireEvent.click(screen.getByRole('button', { name: /保存/ }))

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith({ time: '30d', size: '20GB' })
    })
    // 保存后回传 pending 状态，重启指引出现
    expect(await screen.findByText('保留策略已保存，待重启 Prometheus 生效')).toBeInTheDocument()
  })

  it('保存失败展示后端错误信息（校验 400 透传）', async () => {
    overviewMock.mockResolvedValue(result(overview()))
    updateMock.mockRejectedValue(new Error('保留时长格式无效："15"'))
    renderPage()
    await screen.findByText('TSDB 保留策略')

    // 改成非法时长提交（前端仅做必填校验，格式由后端权威校验并透传）
    fireEvent.change(screen.getByDisplayValue('15d'), { target: { value: '15' } })
    fireEvent.click(screen.getByRole('button', { name: /保存/ }))

    expect(await screen.findByText('保留时长格式无效："15"')).toBeInTheDocument()
  })

  it('加载失败展示错误 Alert，点击「重新加载」重试', async () => {
    overviewMock.mockRejectedValueOnce(new Error('boom'))
    renderPage()

    expect(await screen.findByText('存储与日志信息加载失败，请稍后重试')).toBeInTheDocument()
    overviewMock.mockResolvedValue(result(overview()))
    fireEvent.click(screen.getByRole('button', { name: /重新加载/ }))
    expect(await screen.findByText('TSDB 保留策略')).toBeInTheDocument()
  })
})

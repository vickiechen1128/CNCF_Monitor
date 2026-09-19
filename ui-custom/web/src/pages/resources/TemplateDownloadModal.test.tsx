import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { message } from 'antd'
import { TemplateDownloadModal } from './TemplateDownloadModal'
import { triggerBlobDownload } from '../../utils/triggerBlobDownload'
import { setupAntdTest } from '../../test/antdTestUtils'
import type { ApplicationDict, BusinessDomain, ResourceCategory } from '../../types/resource'

const templateMock = vi.fn()

vi.mock('../../api/resources', () => ({
  resourceApi: {
    template: (...args: unknown[]) => templateMock(...args),
  },
}))

vi.mock('../../utils/triggerBlobDownload', () => ({
  triggerBlobDownload: vi.fn(),
}))

const cancelMock = vi.fn()

/** 与组件 todayStamp 同格式的期望日期戳（YYYYMMDD） */
function todayStamp() {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}${mm}${dd}`
}

function renderModal(
  over: Partial<{
    open: boolean
    category: ResourceCategory
    businessDomains?: BusinessDomain[]
    applicationDomains?: ApplicationDict[]
  }> = {},
) {
  const { open = true, category = 'host', businessDomains = [], applicationDomains = [] } = over
  return render(
    <TemplateDownloadModal
      open={open}
      category={category}
      onCancel={cancelMock}
      businessDomains={businessDomains}
      applicationDomains={applicationDomains}
    />,
  )
}

describe('TemplateDownloadModal', () => {
  setupAntdTest()

  beforeEach(() => {
    templateMock.mockReset()
    cancelMock.mockReset()
    vi.mocked(triggerBlobDownload).mockReset()
    URL.createObjectURL = vi.fn(() => 'blob:mock')
    URL.revokeObjectURL = vi.fn()
    // 静默 antd 静态 message，避免测试输出噪音与 act 告警
    vi.spyOn(message, 'success').mockImplementation(() => undefined)
    vi.spyOn(message, 'error').mockImplementation(() => undefined)
  })

  it('renders user-language three questions and no design black-speak (F-7-③)', () => {
    renderModal()
    // 三问：怎么填 / 每列能填什么值 / 为什么必须下最新（演进提示 Alert）
    expect(screen.getByText('这模板怎么填')).toBeInTheDocument()
    expect(screen.getByText('每列能填什么值')).toBeInTheDocument()
    expect(screen.getByText(/模板会随版本更新/)).toBeInTheDocument()
    // 黑话清理：决策 97 / 取值说明 sheet / 固定列模板 / 技术列名均不再出现
    expect(screen.queryByText('决策 97')).toBeNull()
    expect(screen.queryByText('取值说明')).toBeNull()
    expect(screen.queryByText('固定列模板')).toBeNull()
    expect(screen.queryByText('os_type')).toBeNull()
    expect(screen.queryByText('biz_code')).toBeNull()
    expect(screen.queryByText('instance_ip')).toBeNull()
  })

  it('renders filling tips in user vocabulary per category (F-7-③)', () => {
    renderModal()
    expect(screen.getByText('主机名 / IP 地址 / 操作系统')).toBeInTheDocument()
    expect(screen.getByText('运行状态填中文：运行中 / 已停止 / 维护中')).toBeInTheDocument()
  })

  it('shows enabled business and application dict entries as selectable values, hides disabled (F-7-②)', () => {
    renderModal({
      businessDomains: [
        { code: 'infra', name: '公共基础设施', enabled: true },
        { code: 'legacy', name: '已下线业务', enabled: false },
      ],
      applicationDomains: [
        { app_code: 'order', app_name: '订单服务', status: 'enabled' },
        { app_code: 'old-app', app_name: '已停用应用', status: 'disabled' },
      ],
    })
    // 启用条目以「编码 + 名称」直显
    expect(screen.getByText('infra')).toBeInTheDocument()
    expect(screen.getByText('公共基础设施')).toBeInTheDocument()
    expect(screen.getByText('order')).toBeInTheDocument()
    expect(screen.getByText('订单服务')).toBeInTheDocument()
    // 停用条目不展示
    expect(screen.queryByText('已下线业务')).toBeNull()
    expect(screen.queryByText('已停用应用')).toBeNull()
  })

  it('shows empty-dict placeholder and declaration sheet guidance in user language (F-7-②)', () => {
    renderModal()
    expect(screen.getByText(/暂无已登记业务，请先到「业务管理」页登记/)).toBeInTheDocument()
    expect(screen.getByText(/「业务声明」表，一次导入直接声明新业务/)).toBeInTheDocument()
    expect(screen.getByText(/暂无已登记应用，请先到「应用管理」页登记/)).toBeInTheDocument()
    expect(screen.getByText(/「应用声明」表，一次导入直接声明新应用/)).toBeInTheDocument()
  })

  it('defends against undefined dictionaries passed from page (F-7-② 防御)', () => {
    render(
      <TemplateDownloadModal open category="host" onCancel={cancelMock} businessDomains={undefined} applicationDomains={undefined} />,
    )
    // 组件内兜底空数组 → 渲染空态占位，不崩溃
    expect(screen.getByText(/暂无已登记业务/)).toBeInTheDocument()
    expect(screen.getByText(/暂无已登记应用/)).toBeInTheDocument()
  })

  it('downloads template with date-stamped filename YYYYMMDD (F-7-⑤)', async () => {
    templateMock.mockResolvedValue(
      new Blob(['xlsx'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    )
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: /下载模板/ }))
    await waitFor(() => expect(templateMock).toHaveBeenCalledWith('host'))
    expect(vi.mocked(triggerBlobDownload)).toHaveBeenCalledWith(expect.any(Blob), `host_template_${todayStamp()}.xlsx`)
  })

  it('downloads template linked to the active tab category (application)', async () => {
    templateMock.mockResolvedValue(new Blob(['xlsx']))
    renderModal({ category: 'application' })
    fireEvent.click(screen.getByRole('button', { name: /下载模板/ }))
    await waitFor(() => expect(templateMock).toHaveBeenCalledWith('application'))
    expect(vi.mocked(triggerBlobDownload)).toHaveBeenCalledWith(
      expect.any(Blob),
      `application_template_${todayStamp()}.xlsx`,
    )
  })
})

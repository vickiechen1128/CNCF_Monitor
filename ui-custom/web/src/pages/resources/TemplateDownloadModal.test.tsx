import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TemplateDownloadModal } from './TemplateDownloadModal'
import { triggerBlobDownload } from '../../utils/triggerBlobDownload'
import { setupAntdTest, mockAntdMessage } from '../../test/antdTestUtils'
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
    mockAntdMessage()
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
    // 原断言「主机名 / IP 地址 / 操作系统」已随 F-22 分化改写而移除：五类不再共用
    // 「主标识列 + 同一句必填说明」的写法，host 首条现为按必填口径组织的说明。
    expect(screen.getByText(/^必填：主机名（instance_name）、IP 地址（instance_ip，填 IPv4）、操作系统（os_type）$/)).toBeInTheDocument()
    expect(screen.getByText('运行状态填中文：运行中 / 已停止 / 维护中')).toBeInTheDocument()
  })

  it('differentiates required-field guidance per category (F-22)', () => {
    // host：业务与应用均可留空
    const host = renderModal({ category: 'host' })
    expect(host.getByText(/所属业务（biz_code，导入后再补）/)).toBeInTheDocument()
    expect(host.getByText(/所属应用（app_code）/)).toBeInTheDocument()
    expect(host.getByText(/可留空：主机别名（hostname，与主机名二选一填一个即可）、所属集群（cluster）、负责人（owner）/)).toBeInTheDocument()
    // 原泛化文案（五类共用）已移除
    expect(host.queryByText('所属业务（必填）、所属应用（可选）')).toBeNull()
    host.unmount()

    // database：应用与集群必填，业务可空
    const database = renderModal({ category: 'database' })
    expect(database.getByText('必填：所属应用（app_code）、所属集群（cluster）')).toBeInTheDocument()
    expect(database.getByText(/所属业务（biz_code，导入后再补）/)).toBeInTheDocument()
    database.unmount()

    // middleware：应用与集群必填，业务可空
    const middleware = renderModal({ category: 'middleware' })
    expect(middleware.getByText('必填：所属应用（app_code）、所属集群（cluster）')).toBeInTheDocument()
    expect(middleware.getByText(/所属业务（biz_code，导入后再补）/)).toBeInTheDocument()
    middleware.unmount()

    // application：业务与应用都必填
    const application = renderModal({ category: 'application' })
    expect(application.getByText('必填：所属业务（biz_code）、所属应用（app_code）、所属集群（cluster）')).toBeInTheDocument()
    expect(application.queryByText('所属业务（必填）、所属应用（可选）')).toBeNull()
    application.unmount()

    // generic_target：业务与应用二选一，至少填一个
    const genericTarget = renderModal({ category: 'generic_target' })
    expect(genericTarget.getByText(/^必填二选一：所属业务（biz_code）与所属应用（app_code）两个里至少填一个，两个都留空会导入失败$/)).toBeInTheDocument()
    genericTarget.unmount()
  })

  // 回归护栏：主机历史「可用区」列（zone_env）已由 chenrt 裁定废弃并从后端模板移除
  // （commit a260a39：TemplateColumns[host] 14→13 列），前端提示不得再介绍它——
  // 继续介绍会误导用户去找一个不存在的列。分区权威值是所属网域，由网域提示承担。
  it('不再出现已废弃的 zone_env / 可用区字样（F-22 清理护栏，五类逐一校验）', () => {
    const categories: ResourceCategory[] = ['host', 'database', 'middleware', 'application', 'generic_target']
    categories.forEach((category) => {
      const view = renderModal({ category })
      // antd Modal 渲染在 document.body 的 portal 中，故取 body 文本而非 view.container
      const text = document.body.textContent ?? ''
      expect(text).not.toMatch(/zone_env/)
      expect(text).not.toMatch(/可用区/)
      view.unmount()
    })
  })

  it('differentiates business/application column scope per category (F-22)', () => {
    // 原泛化文案「业务列必填，应用列按需填写」对 5 类中仅 application 成立，已按类分化
    const host = renderModal({ category: 'host' })
    expect(host.getByText(/^业务列和应用列都能留空/)).toBeInTheDocument()
    expect(host.queryByText(/业务列必填，应用列按需填写/)).toBeNull()
    host.unmount()

    const database = renderModal({ category: 'database' })
    expect(database.getByText(/^应用列必填，业务列能留空/)).toBeInTheDocument()
    database.unmount()

    const application = renderModal({ category: 'application' })
    expect(application.getByText(/^业务列和应用列都必填/)).toBeInTheDocument()
    application.unmount()

    const genericTarget = renderModal({ category: 'generic_target' })
    expect(genericTarget.getByText(/^业务列和应用列二选一，至少填一个/)).toBeInTheDocument()
    genericTarget.unmount()
  })

  it('warns that undeclared default network domain fails import (F-22)', () => {
    renderModal()
    // 三件事同时说清：表单必填 / 导入留空归入中心直连域 / 中心直连域未登记则导入失败
    expect(screen.getByText(/在页面上新增或编辑资源时网域是必填项/)).toBeInTheDocument()
    expect(screen.getByText(/留空会自动归入中心直连域/)).toBeInTheDocument()
    expect(
      screen.getByText(/中心直连域必须先到「系统设置 → 网域管理」登记（全平台唯一），否则留空导入会直接失败/),
    ).toBeInTheDocument()
    // 原「留空即安全」表述已移除
    expect(screen.queryByText('网域可留空——留空时平台自动归属默认网域')).toBeNull()
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

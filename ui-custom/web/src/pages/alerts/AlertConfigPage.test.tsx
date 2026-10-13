import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from 'antd'
import { setupAntdTest } from '../../test/antdTestUtils'
import { ApiError } from '../../api/client'
import { AlertConfigPage } from './AlertConfigPage'
import type { AlertmanagerConfigVersionListItem } from '../../types/alertmanager'

const useAlertConfigMock = vi.fn()
const getVersionMock = vi.fn()
const useRouteSettingMock = vi.fn()

vi.mock('./useAlertConfig', () => ({
  useAlertConfig: (...a: unknown[]) => useAlertConfigMock(...a),
}))

// 默认接收人（根兜底）Hook mock（T08-F8）：隔离 route-setting / notify-channels 真实请求
vi.mock('./useRouteSetting', () => ({
  useRouteSetting: (...a: unknown[]) => useRouteSettingMock(...a),
  NONE_RECEIVER_VALUE: -1,
}))

// 2026-10-02：派生预览（useDerivedReceivers）与通知模板（useNotifyTemplates）已随
// 「平台自动生成的接收人」迁往「通知渠道」页，本页不再消费这两个 Hook——此处**刻意不 mock**，
// 若误引回本页，测试会因穿透真实 API 而失败（起到守门作用）。

vi.mock('../../api/alertmanager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/alertmanager')>()
  return {
    ...actual,
    alertmanagerConfigApi: {
      getVersion: (...a: unknown[]) => getVersionMock(...a),
    },
  }
})

const reloadMock = vi.fn()
const submitMock = vi.fn()
const saveRouteSettingMock = vi.fn()
const reloadRouteSettingMock = vi.fn()

/**
 * 路由设定 Hook 返回（T08-SPLIT-01）：迁移后本页**只读 mode 一个字段**
 * （供「手写配置说明」按模式条件化，提案 §7.4 口径保留），不再承载任何策略控件。
 * 默认「未设定但有已启用渠道」的自动建议态。
 */
function routeSettingResult(over: Record<string, unknown> = {}) {
  return {
    setting: {
      enabled: false,
      default_receiver_channel_id: null,
      effective_receiver_name: 'auto-default-recv',
      effective_source: 'auto_first_enabled',
      mode: 'handwritten',
    },
    options: [
      { value: -1, label: '不接管（保留配置文件里已有的值）' },
      { value: 1, label: 'SRE 飞书群' },
    ],
    loading: false,
    error: null,
    saving: false,
    reload: reloadRouteSettingMock,
    save: saveRouteSettingMock,
    ...over,
  }
}

const versionRow = (over: Partial<AlertmanagerConfigVersionListItem> = {}): AlertmanagerConfigVersionListItem => ({
  id: 'acv-1',
  checksum: '7e1b4d9c2a6f8e0d3b9a1c5e7f2d4b8c',
  applied_at: '2026-08-31T10:00:00Z',
  applied_by: '张伟（运维）',
  status: 'applied',
  source_change_no: 'CHG-20260831-001',
  created_at: '2026-08-31T10:00:00Z',
  ...over,
})

function result(over: Record<string, unknown> = {}) {
  return {
    current: null,
    versions: [],
    total: 0,
    loading: false,
    error: null,
    permissionDenied: false,
    reload: reloadMock,
    submit: submitMock,
    // 与 UseAlertConfigResult 契约一致：分页受控值需回传（2026-10-09 修复后组件消费该字段）
    page: 1,
    pageSize: 20,
    ...over,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <App>
        <AlertConfigPage />
      </App>
    </MemoryRouter>,
  )
}

describe('AlertConfigPage（告警配置文件挂载）', () => {
  setupAntdTest()

  beforeEach(() => {
    useAlertConfigMock.mockReset()
    getVersionMock.mockReset()
    reloadMock.mockReset()
    submitMock.mockReset()
    submitMock.mockResolvedValue({ status: 'success', data: { id: 'acv-2', content: '', checksum: '', status: 'applied', source_change_no: 'CHG-2' } })
    // 默认接收人（根兜底）默认：未设定 + 有已启用渠道（自动建议态）
    useRouteSettingMock.mockReset()
    useRouteSettingMock.mockReturnValue(routeSettingResult())
    saveRouteSettingMock.mockReset()
    saveRouteSettingMock.mockResolvedValue(routeSettingResult().setting)
  })

  // 2026-10-13（T08-SPLIT-01）：「导入整份配置文件」由高级折叠区**提为常驻独立卡**（A11），
  // 高级区随之只剩「手写配置说明」一个折叠项，故**展平为单层**（原为两层嵌套）。
  // 因此依赖手写说明内容的用例只需展开一次 `advanced-collapse-label`。
  const expandAdvanced = () => {
    fireEvent.click(screen.getByTestId('advanced-collapse-label'))
  }

  // 2026-10-02 四页说明区统一（components/PageIntro.tsx）：页头「这个页面管什么」说明区
  // 默认收起，跨模块说明（告警规则在 M01「规则编辑」）也随之前进默认收起的说明区。
  const expandIntroGuide = () => {
    fireEvent.click(screen.getByTestId('alert-config-intro-guide-label'))
  }

  // 2026-09-29 排版优化：文档性内容收进折叠栏（遵循本模块「说明不占常驻首屏」约定），
  // 依赖这些文案的用例需先展开对应折叠层再断言。
  const expandGuidance = () => {
    expandAdvanced()
  }

  it('加载中提示', () => {
    useAlertConfigMock.mockReturnValue(result({ loading: true }))
    renderPage()
    expect(screen.getByText('告警配置')).toBeInTheDocument()
    expect(screen.getByText('加载中…')).toBeInTheDocument()
  })

  it('空态：无当前生效配置时引导去界面配置或导入整份配置文件', () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    // 现状卡空态：同时给出「界面配置」与「导入整份配置文件」两条路
    expect(screen.getByText(/当前无生效配置/)).toBeInTheDocument()
    expect(screen.getByText(/「通知渠道」「路由规则」/)).toBeInTheDocument()
    expect(screen.getByText(/可在下方「希望直接编辑整份 alertmanager.yml？」卡导入整份配置文件/)).toBeInTheDocument()
  })

  // 2026-10-02 用户意见（回归护栏）：「配置版本历史」是全局留痕能力，从高级折叠区提出为
  // 页面级常驻卡（现状卡之后、高级区之前）——**不得**再藏在高级区里。
  // 2026-10-13（T08-SPLIT-01）：新增「导入整份配置文件」常驻卡后，顺序为
  // 现状卡 → 版本历史卡 → 导入卡 → 高级区。
  it('配置版本历史：常驻可见（无需展开高级区），且位于现状卡之后、导入卡之前', () => {
    useAlertConfigMock.mockReturnValue(result({ versions: [versionRow()], total: 1 }))
    renderPage()
    const versionsCard = screen.getByTestId('alert-versions-card')
    expect(versionsCard).toBeInTheDocument()
    // 高级区未展开时，版本历史卡已在 DOM（证明它不依赖高级区展开）
    expect(screen.getByText('配置版本历史')).toBeInTheDocument()
    // DOM 顺序：现状卡 → 版本历史卡 → 导入卡 → 高级区
    const domOrder = Array.from(document.querySelectorAll('[data-testid]'))
      .map((el) => el.getAttribute('data-testid'))
    expect(domOrder.indexOf('alert-current-card')).toBeLessThan(domOrder.indexOf('alert-versions-card'))
    expect(domOrder.indexOf('alert-versions-card')).toBeLessThan(domOrder.indexOf('alert-import-card'))
    expect(domOrder.indexOf('alert-import-card')).toBeLessThan(domOrder.indexOf('alert-advanced-collapse'))
  })

  // PL-1（D-1 方案丙）：澄清本页边界，并提供「去写规则」跨模块入口。
  // 2026-10-02：跨模块说明随四页统一的「这个页面管什么」说明区收进折叠栏，需先展开。
  // 2026-10-13（T08-SPLIT-01）：说明随收敛重写——本页不再承载策略配置，
  // 跨模块说明改为点名「谁收到告警（通知渠道）/ 按什么条件分发（路由规则）都在各自页面维护」。
  it('PL-1：说明区含跨模块说明与指向 /rules 的引导链接', () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    expandIntroGuide()
    expect(screen.getByText(/告警规则（什么情况下算告警）在「规则编辑」维护/)).toBeInTheDocument()
    expect(screen.getByText(/谁收到告警（通知渠道）、按什么条件分发（路由规则）/)).toBeInTheDocument()
    expect(screen.getByText(/本页不再承载策略配置/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '去写规则 →' })).toHaveAttribute('href', '/rules')
  })

  // 2026-10-02 四页说明区统一（components/PageIntro.tsx）：
  // 页头 = 标题 + 一行副标（只做定位，不解释机制）；机制解释收进「这个页面管什么」折叠区（默认收起）。
  // 2026-10-13（T08-SPLIT-01）：副标由「设置『告警发给谁、按什么条件分』」改为
  // 「查看当前生效的告警配置与历史版本」——原副标描述的正是迁走的策略控件。
  it('PageIntro：页头副标一行定位，机制说明收进默认收起的说明区', () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    expect(screen.getByTestId('alert-config-intro')).toBeInTheDocument()
    // 副标常驻
    expect(screen.getByTestId('alert-config-intro-subtitle').textContent ?? '').toContain(
      '查看当前生效的告警配置与历史版本',
    )
    // 说明区默认收起：折叠标题在、要点不在 DOM
    expect(screen.getByTestId('alert-config-intro-guide-label')).toBeInTheDocument()
    expect(screen.queryByTestId('alert-config-intro-guide-points')).toBeNull()
    // 展开后要点可见（3~4 条）
    expandIntroGuide()
    const points = screen.getByTestId('alert-config-intro-guide-points')
    expect(points.querySelectorAll('li').length).toBeGreaterThanOrEqual(3)
  })

  // 排版回归：手写配置说明默认收起，文档内容不占常驻首屏；点击标题后展开。
  // 2026-10-13（T08-SPLIT-01）：导入入口提为常驻卡后高级区只剩一个折叠项，故由两层嵌套
  // **展平为单层**——文档内容仍默认收起，仍需点击才可见（`stopHeaderClick` 随之移除）。
  it('手写配置说明默认收起，点击标题后展开（高级区已展平为单层）', async () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    expect(screen.getByText('手写配置说明')).toBeInTheDocument()
    // 默认收起：文档内容不在 DOM
    expect(screen.queryByText(/你只需关注这三块/)).toBeNull()
    expect(screen.queryByText(/inhibit_rules:/)).toBeNull()
    // 展开后文档内容可见
    expandAdvanced()
    expect(await screen.findByText(/你只需关注这三块/)).toBeInTheDocument()
    expect(screen.getByTestId('handwritten-guide-content')).toBeInTheDocument()
  })

  // 2026-10-13（T08-SPLIT-01 / 验收 A11）：「导入整份配置文件」由高级折叠区**提为常驻卡**。
  // 决策 113 / §7.6 C3 要求手写逃生门任何模式下都可达——收进默认收起的折叠区等于降级隐藏。
  // 页头仍**不得**出现「挂载新配置」主按钮（三层模型第③ 层是降级，不是升格为主操作）。
  it('A11：导入整份配置文件提为常驻卡（无需展开高级区），页头仍无主操作按钮', () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    // 常驻可见：导入卡与按钮在首屏 DOM，无需任何展开
    const importCard = screen.getByTestId('alert-import-card')
    expect(importCard).toBeInTheDocument()
    expect(screen.getByText('希望直接编辑整份 alertmanager.yml？')).toBeInTheDocument()
    const btn = screen.getByTestId('import-config-button')
    expect(importCard).toContainElement(btn)
    // 逃生门不得被升格为 primary 主操作
    expect(btn.className).not.toContain('ant-btn-primary')
    expect(document.body.textContent ?? '').not.toContain('挂载新配置')
  })

  // 验收 A1（T08-SPLIT-01）：「路由与收敛策略」卡已**整块迁出**本页 →
  // 两个策略控件改挂「路由规则」页常驻「路由设置」卡。本页不得再残留该卡与相关文案。
  it('A1：策略卡已迁出本页（无 alert-policy-card 与两个策略控件）', () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    expect(screen.queryByTestId('alert-policy-card')).toBeNull()
    expect(screen.queryByRole('combobox', { name: '没匹配到具体规则的告警，发给哪个渠道' })).toBeNull()
    expect(screen.queryByRole('radio', { name: '我来编辑' })).toBeNull()
    expect(screen.queryByRole('radio', { name: '平台生成' })).toBeNull()
    // 旧术语不得残留在用户视图
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('路由与收敛策略')
    expect(text).not.toContain('默认兜底接收人')
    expect(text).not.toContain('路由规则作者模式')
  })

  // 验收 A2（T08-SPLIT-01）：动线卡（回答「我该去哪配」）已**整块迁出**本页。
  // 迁出后「去哪配」的职责由各页自身（通知渠道 / 路由规则）承担，PageIntro 只做跨模块点名。
  it('A2：动线卡已迁出本页（无 alert-guide-card 与其跳转入口）', () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    expect(screen.queryByTestId('alert-guide-card')).toBeNull()
    expect(screen.queryByTestId('guide-channels')).toBeNull()
    expect(screen.queryByTestId('guide-routes')).toBeNull()
    expect(screen.queryByTestId('guide-templates')).toBeNull()
    expect(screen.queryByTestId('guide-inhibit')).toBeNull()
    expect(screen.queryByText('我要做的事')).toBeNull()
  })

  // PL-2：高级区手写说明显式列出三块必写 + 两块豁免，给出最小可运行骨架；豁免项④ 引导静默管理，
  // 豁免项 ⑤（通知模板）在 PL-3 模板页就绪后回填入口（T08-F12，关闭 dev-feedback #14）。
  // 2026-10-02 术语去技术化：块名改用 Alertmanager 官方中文名（提案 §7.5）——
  // 「接收人 / 渠道」→「接收人」、「路由」→「路由规则」、「收敛（告警抑制）」→「告警抑制」，
  // 「静默（silences）」→「静默」、「通知模板内容（templates）」→「通知模板内容」。
  it('PL-2：手写说明列出三块必写 + 两块豁免，并展示最小骨架与静默入口', async () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    expandGuidance()
    expect(await screen.findByText(/你只需关注这三块/)).toBeInTheDocument()
    // 三块必写（作用域限定在手写说明面板内：块名「路由规则」与动线卡的同名入口重名）
    const guide = within(screen.getByTestId('handwritten-guide-content'))
    expect(guide.getByText('接收人')).toBeInTheDocument()
    expect(guide.getByText('路由规则')).toBeInTheDocument()
    expect(guide.getByText('告警抑制')).toBeInTheDocument()
    // 两块豁免
    expect(guide.getByText('这两块不用你写：')).toBeInTheDocument()
    expect(guide.getByText('静默')).toBeInTheDocument()
    expect(guide.getByText('通知模板内容')).toBeInTheDocument()
    // 豁免项 ④ 的平台内替代入口指向静默管理页
    expect(screen.getByRole('link', { name: '静默管理' })).toHaveAttribute('href', '/silences')
    // 豁免项 ⑤ 的平台内替代入口指向通知模板页（PL-3 落地后回填，不再是死链）
    expect(screen.getByRole('link', { name: '通知模板' })).toHaveAttribute('href', '/notify-templates')
    // 最小可运行骨架已渲染（含三块必写关键字）
    expect(screen.getByText(/inhibit_rules:/)).toBeInTheDocument()
    expect(screen.getByText(/resolve_timeout: 5m/)).toBeInTheDocument()
  })

  // 提案 §7.4：手写说明**按模式条件化**——managed 只讲抑制规则缺口，handwritten 才展开完整三块必写。
  it('提案 §7.4：托管模式下手写说明只讲抑制规则缺口，不展开完整三块必写', async () => {
    useAlertConfigMock.mockReturnValue(result())
    useRouteSettingMock.mockReturnValue(
      routeSettingResult({
        setting: {
          enabled: false,
          default_receiver_channel_id: null,
          effective_receiver_name: 'auto-default-recv',
          effective_source: 'auto_first_enabled',
          mode: 'managed',
        },
      }),
    )
    renderPage()
    // 2026-10-13（T08-SPLIT-01）：高级区已展平为单层，展开一次即可看到手写说明
    expandAdvanced()
    // managed：只讲抑制规则
    expect(await screen.findByText(/抑制规则/)).toBeInTheDocument()
    // 不展开完整必写清单
    expect(screen.queryByText(/你只需关注这三块/)).toBeNull()
    expect(screen.queryByText(/inhibit_rules:/)).toBeNull()
  })

  // B 路线（决策 74）：receivers 仍为必写块（自定义场景），但已启用渠道的接收人由平台自动写入，
  // 该块给出「通知渠道」页入口，并传达「自动物化 + 手写仅用于自定义」的心智。
  it('B 路线：接收人 / 渠道必写块说明自动物化心智，并给出「通知渠道」入口', async () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    expandGuidance()
    expect(await screen.findByText(/仅在需要自定义接收人时才手写/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '通知渠道' })).toHaveAttribute('href', '/notify-channels')
  })

  // 安全（H-1）防回归：骨架里 `channel=ch-default` 是误导性假 ID（真实渠道 ID 是数字串），
  // 桥令牌也**不得写进 URL query**（改走 http_config.authorization 请求头）。
  it('B 路线：骨架用醒目占位符 + Bearer 请求头，且 URL 不含 token=', async () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    expandGuidance()
    const pre = await screen.findByText(/inhibit_rules:/)
    const skeleton = pre.textContent ?? ''
    expect(skeleton).not.toContain('ch-default')
    expect(skeleton).not.toContain('ch-sre')
    expect(skeleton).not.toContain('token=')
    expect(skeleton).toContain('REPLACE_WITH_CHANNEL_ID')
    expect(skeleton).toContain('REPLACE_WITH_BRIDGE_TOKEN')
    expect(skeleton).toContain('authorization:')
    expect(skeleton).toContain('type: Bearer')
  })

  // 2026-10-02 用户意见（回归护栏）：「平台自动生成的接收人」已迁至「通知渠道」页表格的
  // 「平台接收人」列——它是渠道的产物，只在渠道上下文里有意义；留在本页既割裂，
  // 又与渠道页行内「接收人配置」抽屉形成「同源能力两份」。
  it('派生预览已迁出本页：高级区不再有「平台自动生成的接收人」折叠项', () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    expect(screen.queryByTestId('derived-collapse-label')).toBeNull()
    expandAdvanced()
    expect(screen.queryByTestId('derived-collapse-label')).toBeNull()
    expect(document.body.textContent ?? '').not.toContain('平台自动生成的接收人')
    // 迁移后本页仍保留前往渠道页的链接（手写说明的「接收人」块；高级区已展平为单层，
    // 上一步 expandAdvanced() 已展开，无需再点第二层标题）
    expect(screen.getAllByRole('link', { name: '通知渠道' }).length).toBeGreaterThan(0)
  })


  it('渲染当前生效状态摘要、完整配置（折叠）与版本列表', async () => {
    useAlertConfigMock.mockReturnValue(
      result({ current: { id: 'acv-1', content: 'global:\n  resolve_timeout: 30s', checksum: 'abc', status: 'applied' }, versions: [versionRow()], total: 1 }),
    )
    renderPage()
    // 现状卡瘦身：状态摘要常驻（版本 ID 在 Descriptions 中）
    expect((await screen.findAllByText('acv-1')).length).toBeGreaterThan(0)
    // 完整配置默认折叠（提案 §7.3：YAML 不再常驻展开）
    expect(screen.getByText('查看完整配置内容')).toBeInTheDocument()
    expect(screen.queryByText(/resolve_timeout/)).toBeNull()
    // 展开后可读到内容；版本历史为常驻卡，无需展开高级区
    fireEvent.click(screen.getByText('查看完整配置内容'))
    expect(await screen.findByText(/resolve_timeout/)).toBeInTheDocument()
    expect(screen.getByText('CHG-20260831-001')).toBeInTheDocument()
  })

  // dev-feedback §25 方案 A（前端侧）：状态展示改读 applied_at 派生（applied_at 是唯一真实生效信号，
  // 由 M09 确认下发写盘成功后回填；挂载那一刻 status 已 applied 但 AM 仍加载旧文件）。
  it('§25：applied_at 有值 → 展示「已生效」，不出现「待确认下发 / 已应用」', () => {
    useAlertConfigMock.mockReturnValue(
      result({
        current: { id: 'acv-1', content: 'route:\n  receiver: default', checksum: 'abc', status: 'applied', applied_at: '2026-08-31T10:00:00Z', applied_by: '张伟（运维）' },
        versions: [versionRow()],
        total: 1,
      }),
    )
    renderPage()
    expect(screen.getAllByText('已生效').length).toBeGreaterThanOrEqual(1)
    expect(document.body.textContent ?? '').not.toContain('已提交，待确认下发')
    expect(document.body.textContent ?? '').not.toContain('需确认下发后才会生效')
    expect(document.body.textContent ?? '').not.toContain('已应用')
  })

  it('§25：applied_at 为空（已提交收录未下发）→ 展示「已提交，待确认下发」+ 配置变更单深链，且无「已应用」', async () => {
    useAlertConfigMock.mockReturnValue(
      result({ current: null, versions: [versionRow({ applied_at: undefined, applied_by: undefined })], total: 1 }),
    )
    renderPage()
    // 状态列在常驻的版本历史表内（2026-10-02 起为页面级卡，无需展开高级区）
    expect(await screen.findAllByText('已提交，待确认下发')).not.toHaveLength(0)
    expect(screen.getAllByText(/需确认下发后才会生效/).length).toBeGreaterThanOrEqual(1)
    // 附M09 配置变更单跳转入口（有变更单号则深链到该单）
    const link = screen.getByRole('link', { name: '变更单 CHG-20260831-001' })
    expect(link).toHaveAttribute('href', '/config-preview?change_no=CHG-20260831-001')
    // 不得再出现会被读作「已生效」的旧口径
    expect(document.body.textContent ?? '').not.toContain('已应用')
    expect(screen.queryByText('已生效')).toBeNull()
  })

  it('§25：applied_at 为空且无变更单号 → 入口落到「配置变更确认」列表页（不造死链）', async () => {
    useAlertConfigMock.mockReturnValue(
      result({ current: null, versions: [versionRow({ applied_at: undefined, applied_by: undefined, source_change_no: undefined })], total: 1 }),
    )
    renderPage()
    expect(await screen.findAllByText('已提交，待确认下发')).not.toHaveLength(0)
    const link = screen.getByRole('link', { name: '「配置变更确认」' })
    expect(link).toHaveAttribute('href', '/config-preview')
  })

  // dev-feedback #44（2026-10-13 废弃联动）：status=discarded 的留痕（变更单被废弃 /
  // 被取代后由后端标记）展示「已废弃」终态 + 恢复指引；**不得**再显示「已提交，待确认
  // 下发」或「前往确认」入口——单子已废弃，无在途单可确认（修复前 id=18 形态：永久
  // 待确认，用户误判脏数据）。
  it('#44：status=discarded → 展示「已废弃」+ 恢复指引，且无待确认提示/确认入口', async () => {
    useAlertConfigMock.mockReturnValue(
      result({
        current: null,
        versions: [versionRow({ status: 'discarded', applied_at: undefined, applied_by: undefined, source_change_no: undefined })],
        total: 1,
      }),
    )
    renderPage()
    expect(await screen.findAllByText('已废弃')).not.toHaveLength(0)
    expect(screen.getAllByText(/如需生效请重新挂载/).length).toBeGreaterThanOrEqual(1)
    // 不得残留待确认口径与确认入口（无在途单可确认，不造死链）
    expect(document.body.textContent ?? '').not.toContain('已提交，待确认下发')
    expect(screen.queryByRole('link', { name: '「配置变更确认」' })).toBeNull()
    expect(screen.queryByRole('link', { name: /变更单 CHG-/ })).toBeNull()
  })

  it('权限不足：显示权限不足空态', () => {
    useAlertConfigMock.mockReturnValue(result({ permissionDenied: true }))
    renderPage()
    expect(screen.getByText('当前账号无此页面查看权限')).toBeInTheDocument()
  })

  // 决策 69-③（决策 60 补充块）：版本历史「M09 变更单」列由静态文本升级为跳转链接，
  // pending 期间用户可由页面内直达该变更单详情（此前仅有数秒即消失的 toast 引导）。
  it('决策 69-③：版本历史的 M09 变更单号渲染为跳转链接', async () => {
    useAlertConfigMock.mockReturnValue(result({ current: null, versions: [versionRow()], total: 1 }))
    renderPage()
    const link = await screen.findByRole('link', { name: 'CHG-20260831-001' })
    expect(link).toHaveAttribute('href', '/config-preview?change_no=CHG-20260831-001')
  })

  it('接口错误：Alert + 重新加载触发 reload', () => {
    const res = result({ error: 'boom' })
    useAlertConfigMock.mockReturnValue(res)
    renderPage()
    expect(screen.getByText('配置信息加载失败，请稍后重试')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重新加载/ }))
    expect(res.reload).toHaveBeenCalled()
  })

  it('挂载：前置校验通过后提交并给出「进入变更确认」引导', async () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    // 2026-10-13（T08-SPLIT-01 / A11）：导入入口已提为常驻卡，无需展开高级区
    fireEvent.click(screen.getByTestId('import-config-button'))
    const textarea = screen.getByPlaceholderText(/# 在此粘贴 alertmanager\.yml 完整内容/)
    fireEvent.change(textarea, { target: { value: 'route:' } })
    fireEvent.click(screen.getByRole('button', { name: /本地大小检查/ }))
    fireEvent.click(screen.getByRole('button', { name: /提交并进入变更确认/ }))
    await waitFor(() => expect(submitMock).toHaveBeenCalledWith(expect.any(String), expect.any(String)))
  })

  it('挂载：提交时校验失败展示行级分组错误，未落库', async () => {
    const badRequest = new ApiError(
      '校验失败',
      400,
      'bad_request',
      {
        status: 'error',
        data: {
          items: [
            { file: 'alertmanager.yml', line: 14, message: 'unknown receiver "sre-critical" referenced by route' },
            { file: 'alertmanager.yml', line: 3, message: 'cannot unmarshal yaml' },
          ],
          note: '校验失败未保存、未生效；修改后请重新挂载',
        },
        error: '校验失败',
        errorType: 'bad_request',
      },
    )
    submitMock.mockRejectedValue(badRequest)
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    // 2026-10-13（T08-SPLIT-01 / A11）：导入入口已提为常驻卡，无需展开高级区
    fireEvent.click(screen.getByTestId('import-config-button'))
    const textarea = screen.getByPlaceholderText(/# 在此粘贴 alertmanager\.yml 完整内容/)
    fireEvent.change(textarea, { target: { value: 'route: x' } })
    fireEvent.click(screen.getByRole('button', { name: /本地大小检查/ }))
    fireEvent.click(screen.getByRole('button', { name: /提交并进入变更确认/ }))
    await waitFor(() => expect(submitMock).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('引用闭合错误')).toBeInTheDocument())
    expect(screen.getByText('配置语法错误')).toBeInTheDocument()
  })

  // 2026-10-02 用户意见（回归护栏）：「重新挂载此版本」入口已删除——重新提交历史配置
  // 改走「查看版本内容 → 改 → 导入整份配置文件」，与首屏导入同一条路径。
  // 注意与「通知模板」页的「重新挂载」（模板版本回滚，语义不同、仍在用）严格区分。
  it('版本历史：不再提供「重新挂载此版本」，操作列只剩只读查看', async () => {
    useAlertConfigMock.mockReturnValue(result({ versions: [versionRow()], total: 1 }))
    renderPage()
    expect(await screen.findByTestId('alert-versions-card')).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toContain('重新挂载')
    expect(screen.queryByRole('button', { name: /重新挂载此版本/ })).toBeNull()
    // 「查看」入口保留（只读留痕）
    expect(screen.getByRole('button', { name: /查看/ })).toBeInTheDocument()
  })

  // =====================================================================
  // T08-SPLIT-01（2026-10-13）：「路由与收敛策略」卡整块迁出本页。
  //
  // 原先挂在本页的 **两个策略控件** 及其全部行为用例已**整体迁至**
  // `RoutesPage.test.tsx`（覆盖点一一对应，无删减）：
  //   · T08-F8「没匹配到具体规则的告警，发给哪个渠道」下拉框
  //     （未设定建议值口径 / 选定渠道二次确认 / 选「不接管」以 null 关闭接管 /
  //       保存 400 错误文案 / 已接管结论 Tag 不复述渠道名 / 未接管不得写「发往」）
  //     → RoutesPage.test.tsx「路由设置」卡系列用例
  //   · T08-F12「路由规则由谁维护」Segmented
  //     （二选一 + 二次确认透传 mode / 切手写自动置「不接管」[决策二+三] /
  //       切回「平台生成」不自动接管 [决策四] / 模式后果说明随 mode 切换 /
  //       二次确认明说页面可编辑性）
  //     → RoutesPage.test.tsx 同名系列用例
  //
  // 本页保留两条**反向**护栏：见上方「A1：策略卡已迁出本页」「A2：动线卡已迁出本页」——
  // 断言本页 DOM 中不再存在 `alert-policy-card` / 两个策略控件 / 动线卡。
  //
  // 「手写配置说明仍按 mode 条件化」是本页**唯一**保留 `useRouteSetting` 的理由
  // （提案 §7.4），对应上方「提案 §7.4：托管模式下手写说明只讲抑制规则缺口」用例。
  // =====================================================================
})

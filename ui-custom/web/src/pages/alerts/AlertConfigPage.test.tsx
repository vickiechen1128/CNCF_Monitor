import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from 'antd'
import { setupAntdTest, mockAntdModal } from '../../test/antdTestUtils'
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

/** 默认接收人（根兜底）Hook 返回（T08-F8）：默认「未设定但有已启用渠道」的自动建议态 */
function routeSettingResult(over: Record<string, unknown> = {}) {
  return {
    setting: {
      enabled: false,
      default_receiver_channel_id: null,
      effective_receiver_name: 'auto-default-recv',
      effective_source: 'auto_first_enabled',
    },
    options: [
      { value: -1, label: '不接管（保留配置文件里已有的值）' },
      { value: 1, label: 'SRE 飞书群（接收人 sre-feishu-qun）', receiverName: 'sre-feishu-qun' },
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

/**
 * 判断元素是否被 CSS 视觉隐藏（screen-reader only）。
 *
 * 2026-10-08：策略卡的「两个开关关系」结论改为视觉隐藏后，仍**留在卡内 DOM** 里
 * （读屏与自动化测试需要它）。于是「卡内文本不含 X」这类断言不能再对
 * `card.textContent` 成立——必须先排除视觉隐藏节点，否则会把"移入隐藏句"误判为"仍在可见区"。
 *
 * ⚠ 判据只用 **inline style**，不用 `getBoundingClientRect()`：jsdom 下所有元素的
 * rect 恒为 0×0，用 rect 判定会把**每一个**叶子节点都误判为隐藏（visibleText 变空串）。
 * 组件的隐藏实现是 inline style（`clip` + `overflow:hidden` + 1px 尺寸），据此判定可靠。
 */
function isVisuallyHidden(el: HTMLElement): boolean {
  const s = el.style
  if (!s.overflow || s.overflow !== 'hidden') return false
  return s.position === 'absolute' && (s.width === '1px' || s.clip !== 'auto')
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

  // 2026-10-02 IA 重构（设计提案 alert-config-three-layer-model.md §7.3 方案 A）：
  // 页面改为「策略卡 / 动线卡 / 瘦身现状卡 / 高级区」四段，**页头不再挂主按钮**——
  // 「导入整份配置文件」（三层模型第③ 层、永久逃生舱）降级进默认收起的「高级」区。
  // 因此依赖高级区内容的用例需先展开高级区（再按需展开手写说明）再断言。
  const expandAdvanced = () => {
    fireEvent.click(screen.getByTestId('advanced-collapse-label'))
  }
  const expandHandwrittenGuide = () => {
    fireEvent.click(screen.getByTestId('guide-collapse-label'))
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
    expandHandwrittenGuide()
  }

  it('加载中提示', () => {
    useAlertConfigMock.mockReturnValue(result({ loading: true }))
    renderPage()
    expect(screen.getByText('告警配置')).toBeInTheDocument()
    expect(screen.getByText('加载中…')).toBeInTheDocument()
  })

  it('空态：无当前生效配置时引导去界面配置或高级区导入', () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    // 现状卡空态：同时给出「界面配置」与「高级区导入」两条路
    expect(screen.getByText(/当前无生效配置/)).toBeInTheDocument()
    expect(screen.getByText(/「通知渠道」「路由规则」/)).toBeInTheDocument()
  })

  // 2026-10-02 用户意见（回归护栏）：「配置版本历史」是全局留痕能力，从高级折叠区提出为
  // 页面级常驻卡（现状卡之后、高级区之前）——**不得**再藏在高级区里。
  it('配置版本历史：常驻可见（无需展开高级区），且位于现状卡之后', () => {
    useAlertConfigMock.mockReturnValue(result({ versions: [versionRow()], total: 1 }))
    renderPage()
    const versionsCard = screen.getByTestId('alert-versions-card')
    expect(versionsCard).toBeInTheDocument()
    // 高级区未展开时，版本历史卡已在 DOM（证明它不依赖高级区展开）
    expect(screen.getByText('配置版本历史')).toBeInTheDocument()
    // DOM 顺序：现状卡 → 版本历史卡 → 高级区
    const domOrder = Array.from(document.querySelectorAll('[data-testid]'))
      .map((el) => el.getAttribute('data-testid'))
    expect(domOrder.indexOf('alert-current-card')).toBeLessThan(domOrder.indexOf('alert-versions-card'))
    expect(domOrder.indexOf('alert-versions-card')).toBeLessThan(domOrder.indexOf('alert-advanced-collapse'))
  })

  // PL-1（D-1 方案丙）：澄清本页边界（只管发给谁/怎么收敛），并提供「去写规则」跨模块入口。
  // 2026-10-02：跨模块说明随四页统一的「这个页面管什么」说明区收进折叠栏，需先展开。
  it('PL-1：说明区含跨模块说明与指向 /rules 的引导链接', () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    expandIntroGuide()
    expect(screen.getByText(/告警规则（什么情况下算告警）在「规则编辑」维护/)).toBeInTheDocument()
    expect(screen.getByText(/本页只管「告警发给谁、怎么收敛」/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '去写规则 →' })).toHaveAttribute('href', '/rules')
  })

  // 2026-10-02 四页说明区统一（components/PageIntro.tsx）：
  // 页头 = 标题 + 一行副标（只做定位，不解释机制）；机制解释收进「这个页面管什么」折叠区（默认收起）。
  it('PageIntro：页头副标一行定位，机制说明收进默认收起的说明区', () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    expect(screen.getByTestId('alert-config-intro')).toBeInTheDocument()
    // 副标常驻
    expect(screen.getByTestId('alert-config-intro-subtitle').textContent ?? '').toContain(
      '设置「告警发给谁、按什么条件分」',
    )
    // 说明区默认收起：折叠标题在、要点不在 DOM
    expect(screen.getByTestId('alert-config-intro-guide-label')).toBeInTheDocument()
    expect(screen.queryByTestId('alert-config-intro-guide-points')).toBeNull()
    // 展开后要点可见（3~4 条）
    expandIntroGuide()
    const points = screen.getByTestId('alert-config-intro-guide-points')
    expect(points.querySelectorAll('li').length).toBeGreaterThanOrEqual(3)
  })

  // 排版回归：高级区与其内的手写说明默认收起，文档内容不占常驻首屏；逐层展开后可见。
  // 同时是嵌套 Collapse 的冒泡回归护栏：点内层标题不得把外层高级区收起（stopHeaderClick）。
  it('高级区与手写说明默认收起，逐层点击标题后展开', async () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    expect(screen.getByText('高级：导入整份配置文件')).toBeInTheDocument()
    // 默认收起：高级区内的手写说明标题与文档内容都不在 DOM
    expect(screen.queryByTestId('guide-collapse-label')).toBeNull()
    expect(screen.queryByText(/你只需关注这三块/)).toBeNull()
    expect(screen.queryByText(/inhibit_rules:/)).toBeNull()
    // 展开高级区 → 手写说明标题可见
    expandAdvanced()
    expect(await screen.findByTestId('guide-collapse-label')).toBeInTheDocument()
    // 再展开手写说明 → 文档内容可见（且高级区仍保持展开）
    expandHandwrittenGuide()
    expect(await screen.findByText(/你只需关注这三块/)).toBeInTheDocument()
    expect(screen.getByTestId('advanced-collapse-label')).toBeInTheDocument()
  })

  // 2026-10-02 IA 重构核心回归：页头**不得**再出现「挂载新配置」主按钮（三层模型第③ 层已降级进高级区）。
  it('IA 重构：页头无主操作按钮，「导入整份配置文件」在默认收起的高级区内', () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    // 高级区未展开时，导入按钮不在 DOM
    expect(screen.queryByTestId('import-config-button')).toBeNull()
    expect(document.body.textContent ?? '').not.toContain('挂载新配置')
    // 展开高级区后出现，且不再是 type="primary"（普通按钮）
    expandAdvanced()
    const btn = screen.getByTestId('import-config-button')
    expect(btn.className).not.toContain('ant-btn-primary')
  })

  // 策略卡（提案 §7.3①）：提级为首屏第一卡，两个治理控件在此，不再埋在「当前生效配置」卡内。
  it('IA 重构：策略卡提级为首屏第一卡，含两个控件与一行状态句', () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    const card = screen.getByTestId('alert-policy-card')
    expect(card).toBeInTheDocument()
    expect(screen.getByText('路由与收敛策略')).toBeInTheDocument()
    // 控件一（去技术化：不再叫「默认兜底接收人」）
    expect(screen.getByText('没匹配到具体规则的告警，发给哪个渠道')).toBeInTheDocument()
    // 控件二（去技术化：不再叫「路由规则作者模式」）
    expect(screen.getByText('路由规则由谁维护')).toBeInTheDocument()
    // 状态句：一次说清「谁维护路由」+「未匹配告警发给谁」
    // 2026-10-08 瘦身：状态句改为**视觉隐藏**（两个开关的「关系」属读卡要懂的关系，
    //   不是「当前状态」，同屏常驻会与控件各自结论争抢注意力——用户实测判为信息量过大）。
    //   读屏与测试仍可拿到；当前状态的结论改由控件行的 fallback-conclusion Tag 承载。
    expect(screen.getByTestId('policy-summary').textContent ?? '').toContain('路由规则由你来编辑')
    expect(screen.getByTestId('fallback-conclusion')).toBeInTheDocument()
    // 旧术语不得残留在用户视图
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('默认兜底接收人')
    expect(text).not.toContain('路由规则作者模式')
  })

  // 动线卡（提案 §7.3②）：回答「我该去哪配」；抑制规则缺口显式标注不静默消失（#37）。
  it('IA 重构：动线卡给出三条跳转，抑制规则显式标注「即将支持」', () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    expect(screen.getByTestId('alert-guide-card')).toBeInTheDocument()
    expect(screen.getByText('我要做的事')).toBeInTheDocument()
    expect(screen.getByTestId('guide-channels')).toHaveAttribute('href', '/notify-channels')
    expect(screen.getByTestId('guide-routes')).toHaveAttribute('href', '/routes')
    expect(screen.getByTestId('guide-templates')).toHaveAttribute('href', '/notify-templates')
    // dev-feedback #37：抑制规则无 UI，本期只标注
    expect(screen.getByTestId('guide-inhibit')).toBeInTheDocument()
    expect(screen.getByText('即将支持')).toBeInTheDocument()
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
    expandAdvanced()
    fireEvent.click(await screen.findByTestId('guide-collapse-label'))
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
    // 迁移后本页仍保留前往渠道页的链接（手写说明的「接收人」块，默认收起需展开）
    expandHandwrittenGuide()
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
    expandAdvanced()
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
    expandAdvanced()
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
  // T08-F8（决策 113 口径 C）：骨架布缆开关「没匹配到具体规则的告警，发给哪个渠道」（原「默认接收人（根兜底）」）。
  // 2026-10-02 IA 重构：控件由「当前生效配置」卡内提级到首屏「策略卡」，术语去技术化
  // （提案 §7.5）；Q3：与「路由规则由谁维护」（T08-F12 模式控件）是两个独立控件——
  // 后者是 mode 字段，前者是 enabled + default_receiver_channel_id，二者互不门禁（提案 §6.3）。
  // =====================================================================
  const openReceiverSelect = () =>
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '没匹配到具体规则的告警，发给哪个渠道' }))
  const pickReceiverOption = async (text: string | RegExp) => {
    const opts = await screen.findAllByText(text)
    // 下拉项挂在 body 末尾的 portal 中；已选中值也在选择器内展示，故取最后一个（下拉项）
    fireEvent.click(opts[opts.length - 1])
  }

  it('没匹配到具体规则的告警，发给哪个渠道：未设定时展示自动建议来源，下拉首项为「不接管」，并给出只替换单值的诚实口径', () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    // 控件已提级到策略卡，标签去技术化（不再是「默认兜底接收人」）
    expect(screen.getByTestId('alert-policy-card')).toContainElement(
      screen.getByRole('combobox', { name: '没匹配到具体规则的告警，发给哪个渠道' }),
    )
    // 首项「不接管（保留配置文件里已有的值）」= NONE_RECEIVER_VALUE(-1) 且为当前选中值
    expect(screen.getByText('不接管（保留配置文件里已有的值）')).toBeInTheDocument()
    // 2026-10-08 契约修复：未设定时（effective_source=auto_first_enabled）平台**不接管**，
    //   effective_receiver_name 仅为 UI 预填建议（契约 §11.9：仅作建议、产物字节不变）。
    //   旧实现把它渲染成「发往 X」，与下拉框显示的「不接管」自相矛盾——用户实测判为界面不可信。
    const conclusion = screen.getByTestId('fallback-conclusion').textContent ?? ''
    expect(conclusion).toContain('未接管')
    expect(conclusion).toContain('建议值')
    expect(conclusion).not.toContain('发往')
    // 2026-10-08：不再展示平台内部 receiver 名（`auto-default-recv`）——
    //   它对"我选了哪个渠道"无帮助。改为说明建议值来自哪一类渠道。
    expect(conclusion).not.toContain('auto-default-recv')
    expect(conclusion).toContain('已启用渠道')
    // 诚实口径（只替换兜底接收人单值、不改分组/节奏、不写具体分流规则）2026-10-08
    //   已从策略卡正文移入 PageIntro.points（默认收起）：同一事实说 4 遍是「信息量过大」主因。
    const cardText = screen.getByTestId('alert-policy-card').textContent ?? ''
    expect(cardText).not.toContain('平台不会改动你的分组')
    fireEvent.click(screen.getByTestId('alert-config-intro-guide-label'))
    expect(screen.getByTestId('alert-config-intro-guide-points').textContent ?? '').toContain('平台不会改动你的分组')
  })

  it('没匹配到具体规则的告警，发给哪个渠道：选定渠道触发二次确认（护栏①），文案不含实现字段名，确认后写入该渠道', async () => {
    useAlertConfigMock.mockReturnValue(result())
    const modal = mockAntdModal()
    renderPage()
    openReceiverSelect()
    await pickReceiverOption(/SRE 飞书群（接收人 sre-feishu-qun）/)
    expect(modal.confirm).toHaveBeenCalled()
    const cfg = modal.confirm.mock.calls[0][0]
    // 2026-10-08：标题去「接收人」术语（去技术化，提案 §7.5），改说「接管这类告警」
    expect(String(cfg.title)).toContain('确认由平台接管这类告警')
    // 术语去技术化护栏：确认弹窗不得暴露 route 段字段名
    expect(String(cfg.content)).not.toContain('route.receiver')
    expect(String(cfg.content)).not.toContain('route.routes[]')
    // 仍需明示「只替换一个值」这一关键语义
    expect(String(cfg.content)).toContain('不受影响')
    expect(String(cfg.content)).toContain('不触碰 group_by')
    // 未确认前不写入
    expect(saveRouteSettingMock).not.toHaveBeenCalled()
    await (cfg.onOk as () => Promise<void>)()
    expect(saveRouteSettingMock).toHaveBeenCalledWith(1)
  })

  it('没匹配到具体规则的告警，发给哪个渠道：选「不接管」以 null 关闭接管，并提示已停止替换、最后写入值保留（护栏③）', async () => {
    useAlertConfigMock.mockReturnValue(result())
    useRouteSettingMock.mockReturnValue(
      routeSettingResult({
        setting: {
          enabled: true,
          default_receiver_channel_id: 1,
          effective_receiver_name: 'sre-feishu-qun',
          effective_source: 'explicit',
        },
      }),
    )
    renderPage()
    openReceiverSelect()
    await pickReceiverOption('不接管（保留配置文件里已有的值）')
    await waitFor(() => expect(saveRouteSettingMock).toHaveBeenCalledWith(null))
    expect(await screen.findByText(/已停止由平台指定默认接收人/)).toBeInTheDocument()
    expect(await screen.findByText(/最后写入的值保留在配置文件中/)).toBeInTheDocument()
  })

  it('没匹配到具体规则的告警，发给哪个渠道：保存返回 400（渠道不存在 / 未启用）时提示后端错误文案', async () => {
    useAlertConfigMock.mockReturnValue(result())
    saveRouteSettingMock.mockRejectedValue(new ApiError('指定的通知渠道不存在或未启用', 400, 'bad_request'))
    const modal = mockAntdModal()
    renderPage()
    openReceiverSelect()
    await pickReceiverOption(/SRE 飞书群（接收人 sre-feishu-qun）/)
    await (modal.confirm.mock.calls[0][0].onOk as () => Promise<void>)()
    expect(await screen.findByText('指定的通知渠道不存在或未启用')).toBeInTheDocument()
  })

  it('没匹配到具体规则的告警，发给哪个渠道：已生效时展示「平台接管中」与「你指定的」来源', () => {
    useAlertConfigMock.mockReturnValue(result())
    useRouteSettingMock.mockReturnValue(
      routeSettingResult({
        setting: {
          enabled: true,
          default_receiver_channel_id: 1,
          effective_receiver_name: 'sre-feishu-qun',
          effective_source: 'explicit',
        },
      }),
    )
    renderPage()
    // 2026-10-08：Tag 改为携带结论（已接管 + 发往哪个），不再只是「平台接管中」四字
    const conclusion = screen.getByTestId('fallback-conclusion').textContent ?? ''
    expect(conclusion).toContain('已接管')
    // 2026-10-08：结论 Tag **不再复述渠道名 / 接收人名**，只用「你选中的渠道」回指控件——
    //   结论与下拉框是并列元素，复述会让用户做一道连线题（实测「不知道怎么知道这就是兜底」）。
    expect(conclusion).toContain('你选中的渠道')
    expect(conclusion).not.toContain('sre-feishu-qun')
    // 来源标签（「你指定的」/「已启用渠道的第一个」）属"派生态"、随模式而变，故**不常驻可见区**，
    //   改由 screen-reader 隐藏的关系句承载（每个事实只在一处说）。
    //   注意：隐藏句仍在卡内 DOM 中，故不能对整卡 textContent 断言"不含"，
    //   要断言的是「可见文本里不出现来源标签」——用计算样式排除隐藏元素。
    const visibleText = Array.from(
      screen.getByTestId('alert-policy-card').querySelectorAll<HTMLElement>('*'),
    )
      .filter((e) => e.children.length === 0 && !isVisuallyHidden(e))
      .map((e) => e.textContent ?? '')
      .join('')
    expect(visibleText).not.toContain('你指定的')
    expect(visibleText).toContain('已接管')
    // 状态句同时点明「谁维护路由」与「未匹配告警发给谁」（提案 §6.3；2026-10-08 起视觉隐藏）
    const summary = screen.getByTestId('policy-summary').textContent ?? ''
    expect(summary).toContain('平台已接管')
    expect(summary).toContain('你指定的')
  })

  // =====================================================================
  // T08-F12（「路由规则由谁维护」）：handwritten（我来编辑）/ managed（平台生成）。
  // 2026-10-08：用户可见词由「我手写 / 平台管理」改为「我来编辑 / 平台生成」——
  //   旧词「我手写」被实测判为歧义：它天然承诺由我在页面里手写，而实际含义是
  //   「平台别生成路由段、我自己去高级区手写 YAML」，该层含义只写在二次确认弹窗里。
  //   用户选「我手写」后发现路由规则页变只读，判为功能故障。底层枚举值不变。
  // 与「没匹配到具体规则的告警，发给哪个渠道」是两个独立控件（见 Q3 注释）——根兜底接管不判 mode
  // （提案 §6.3 代码级依据：notify_route_skeleton.go::MaterializeRootRouteReceiver 门禁
  //   只判 enabled + default_receiver_channel_id，不判 mode），故状态句必须显式点明这层关系。
  // 2026-10-02：控件由 Switch 改 Segmented，表达「二选一模式」而非「开/关」（用户拍板）。
  // 切换即二次确认，并按护栏 §11.6 明示差异，保存时把 mode 一并写入 route-setting。
  // =====================================================================
  const modeSegment = (label: '我来编辑' | '平台生成') =>
    screen.getByRole('radio', { name: label })
  const clickModeSegment = (label: '我来编辑' | '平台生成') => {
    fireEvent.click(modeSegment(label))
  }

  it('T08-F12：「路由规则由谁维护」以 Segmented 二选一呈现，我来编辑→平台生成 触发二次确认并透传 mode=managed', async () => {
    useAlertConfigMock.mockReturnValue(result())
    // 初始为「我来编辑」（mode=handwritten）
    useRouteSettingMock.mockReturnValue(
      routeSettingResult({
        setting: {
          enabled: false,
          default_receiver_channel_id: null,
          effective_receiver_name: 'auto-default-recv',
          effective_source: 'auto_first_enabled',
          mode: 'handwritten',
        },
      }),
    )
    const modal = mockAntdModal()
    renderPage()
    // 二选一语义：两个 radio 而非一个开关
    expect(screen.getByLabelText('路由规则由谁维护')).toBeInTheDocument()
    expect(modeSegment('我来编辑')).toBeChecked()
    expect(modeSegment('平台生成')).not.toBeChecked()
    // 初始态状态句点明「由你来编辑」
    expect(screen.getByTestId('policy-summary').textContent ?? '').toContain('路由规则由你来编辑')
    // 切到「平台管理」(managed) → 二次确认
    clickModeSegment('平台生成')
    expect(modal.confirm).toHaveBeenCalled()
    const cfg = modal.confirm.mock.calls[0][0]
    expect(String(cfg.title)).toContain('切换为「平台生成」')
    // 术语去技术化护栏：确认弹窗不得暴露「route 段」这类实现术语
    expect(String(cfg.title)).not.toContain('route 段')
    expect(String(cfg.content)).not.toContain('route 段')
    // 未确认前不写入
    expect(saveRouteSettingMock).not.toHaveBeenCalled()
    await (cfg.onOk as () => Promise<void>)()
    // 当前未选定兜底接收人 → channelId=null，连同 mode='managed' 一并写入
    expect(saveRouteSettingMock).toHaveBeenCalledWith(null, 'managed')
  })

  it('T08-F12：平台生成→我来编辑 同样二次确认并透传 mode=handwritten（保留当前兜底接收人 channelId）', async () => {
    useAlertConfigMock.mockReturnValue(result())
    useRouteSettingMock.mockReturnValue(
      routeSettingResult({
        setting: {
          enabled: false,
          default_receiver_channel_id: 3,
          effective_receiver_name: 'sre-qun',
          effective_source: 'explicit',
          mode: 'managed',
        },
      }),
    )
    const modal = mockAntdModal()
    renderPage()
    // 初始态：平台生成（mode=managed）
    expect(modeSegment('平台生成')).toBeChecked()
    expect(screen.getByTestId('policy-summary').textContent ?? '').toContain('路由规则由平台生成')
    clickModeSegment('我来编辑')
    expect(modal.confirm).toHaveBeenCalled()
    const cfg = modal.confirm.mock.calls[0][0]
    expect(String(cfg.title)).toContain('切换为「我来编辑」')
    // 护栏§11.6：切到「我来编辑」明示「不删除已生成的路由内容」
    expect(String(cfg.content)).toContain('已生成')
    await (cfg.onOk as () => Promise<void>)()
    // channelId 保留当前选定值(3)，连同 mode='handwritten' 写入
    expect(saveRouteSettingMock).toHaveBeenCalledWith(3, 'handwritten')
  })

  // 提案 §6.3 的非直觉事实必须有回归护栏：「我来编辑」模式下平台**仍**接管根兜底接收人单键。
  // 若未来有人给 MaterializeRootRouteReceiver 补上 mode 门禁，本用例会失败并提示同步更新状态句口径。
  it('提案 §6.3：「我来编辑」模式下平台仍接管兜底接收人，状态句不得谎报「平台不接管」', () => {
    useAlertConfigMock.mockReturnValue(result())
    useRouteSettingMock.mockReturnValue(
      routeSettingResult({
        setting: {
          enabled: true,
          default_receiver_channel_id: 1,
          effective_receiver_name: 'sre-feishu-qun',
          effective_source: 'explicit',
          mode: 'handwritten',
        },
      }),
    )
    renderPage()
    const summary = screen.getByTestId('policy-summary').textContent ?? ''
    expect(summary).toContain('路由规则由你来编辑')
    expect(summary).toContain('未匹配任何规则的告警发往 sre-feishu-qun')
    expect(summary).toContain('平台已接管')
  })

  // 2026-10-08：Segmented 只有两个短词，承载不了「选了之后路由规则页会怎样」——
  // 而这正是实测中被误解的点（选「我手写」→ 页面变只读 → 判为故障）。故控件下方
  // 必须常驻一行后果说明，且**随 mode 切换**（按 PageIntro 契约第三条：随状态变化的信息
  // 才允许常驻，不能收进默认收起的说明区）。
  it('2026-10-08：模式控件下方常驻一行后果说明，且随 mode 切换措辞', () => {
    useAlertConfigMock.mockReturnValue(result())
    useRouteSettingMock.mockReturnValue(
      routeSettingResult({
        setting: {
          enabled: true,
          default_receiver_channel_id: 1,
          effective_receiver_name: 'sre-feishu-qun',
          effective_source: 'explicit',
          mode: 'handwritten',
        },
      }),
    )
    const { unmount } = renderPage()
    // 「我来编辑」→ 明确说页面可编辑
    expect(screen.getByTestId('policy-mode-tip').textContent ?? '').toContain('直接增删改路由')
    unmount()

    // 切到「平台生成」→ 明确说页面只读，且指向高级区手写入口
    useRouteSettingMock.mockReturnValue(
      routeSettingResult({
        setting: {
          enabled: true,
          default_receiver_channel_id: 1,
          effective_receiver_name: 'sre-feishu-qun',
          effective_source: 'explicit',
          mode: 'managed',
        },
      }),
    )
    renderPage()
    expect(screen.getByTestId('policy-mode-tip').textContent ?? '').toContain('只读视图')
  })

  // 2026-10-08：二次确认弹窗必须**明说页面可编辑性**，而不只讲产物归属——旧文案只说"平台停止生成 /
  // 平台接管"，用户无法据此判断路由页还能不能编辑。
  it('2026-10-08：模式切换二次确认明说页面可编辑性后果', () => {
    useAlertConfigMock.mockReturnValue(result())
    useRouteSettingMock.mockReturnValue(
      routeSettingResult({
        setting: {
          enabled: false,
          default_receiver_channel_id: null,
          effective_receiver_name: 'auto-default-recv',
          effective_source: 'auto_first_enabled',
          mode: 'handwritten',
        },
      }),
    )
    const modal = mockAntdModal()
    const { unmount } = renderPage()

    // 切到「平台生成」→ 弹窗须说「只读」
    clickModeSegment('平台生成')
    const cfgManaged = modal.confirm.mock.calls[0][0]
    expect(String(cfgManaged.content)).toContain('只读')
    unmount()

    // 切到「我来编辑」→ 弹窗须说页面可编辑 + 保留已生成内容
    // （unmount 后重新 render，避免两次 render 叠加导致 getByRole 命中多个同名 radio）
    useRouteSettingMock.mockReturnValue(
      routeSettingResult({
        setting: {
          enabled: false,
          default_receiver_channel_id: 3,
          effective_receiver_name: 'sre-qun',
          effective_source: 'explicit',
          mode: 'managed',
        },
      }),
    )
    renderPage()
    clickModeSegment('我来编辑')
    const cfgHandwritten = modal.confirm.mock.calls[1][0]
    expect(String(cfgHandwritten.content)).toContain('路由规则页')
    expect(String(cfgHandwritten.content)).toContain('已生成')
  })

  /**
   * 2026-10-08 策略卡瘦身后的护栏（用户实测"界面不清晰"的核心是**自相矛盾**）：
   * `auto_first_enabled` 按契约 §11.9 只是「UI 预填建议、平台不接管、产物字节不变」，
   * 但旧实现把 effective_receiver_name 一律渲染成「发往 X」——用户看到下拉框是「不接管」、
   * 状态句却说「发往 notify-1」，当场判为界面不可信。
   *
   * 本用例锁死「未接管时不得出现『发往』」，且建议值必须被标为建议。
   * 若将来有人把结论 Tag 改回无条件显示"发往"，本用例会失败。
   */
  it('2026-10-08：未接管时不得把建议值渲染成生效值（不得出现「发往」）', () => {
    useAlertConfigMock.mockReturnValue(result())
    useRouteSettingMock.mockReturnValue(
      routeSettingResult({
        setting: {
          enabled: false, // 未接管
          default_receiver_channel_id: null,
          effective_receiver_name: 'notify-1', // 仅为建议值
          effective_source: 'auto_first_enabled',
          mode: 'handwritten',
        },
      }),
    )
    renderPage()
    // 控件行结论：说「未接管」+ 标出建议值
    const conclusion = screen.getByTestId('fallback-conclusion').textContent ?? ''
    expect(conclusion).toContain('未接管')
    expect(conclusion).toContain('建议值')
    expect(conclusion).not.toContain('发往')
    // 视觉隐藏的关系句同样不得把建议说成生效
    const summary = screen.getByTestId('policy-summary').textContent ?? ''
    expect(summary).toContain('未指定')
    expect(summary).not.toContain('发往')
  })

  it('2026-10-08：已接管（explicit + enabled）时才可说「发往」', () => {
    useAlertConfigMock.mockReturnValue(result())
    useRouteSettingMock.mockReturnValue(
      routeSettingResult({
        setting: {
          enabled: true,
          default_receiver_channel_id: 1,
          effective_receiver_name: 'sre-feishu-qun',
          effective_source: 'explicit',
          mode: 'handwritten',
        },
      }),
    )
    renderPage()
    const conclusion = screen.getByTestId('fallback-conclusion').textContent ?? ''
    expect(conclusion).toContain('已接管')
    expect(conclusion).toContain('发往')
  })

  // 瘦身护栏：策略卡内**不得**再出现「同一个事实说 4 遍」的三处冗余载体。
  it('2026-10-08：策略卡瘦身——不再有独立状态行与蓝线长段常驻', () => {
    useAlertConfigMock.mockReturnValue(result())
    useRouteSettingMock.mockReturnValue(
      routeSettingResult({
        setting: {
          enabled: true,
          default_receiver_channel_id: 1,
          effective_receiver_name: 'sre-feishu-qun',
          effective_source: 'explicit',
          mode: 'handwritten',
        },
      }),
    )
    renderPage()
    const card = screen.getByTestId('alert-policy-card')
    const text = card.textContent ?? ''
    // 「当前为…（来源：…）」这一独立状态行已并入 Tag，卡内不应再有
    expect(text).not.toContain('当前为')
    // 诚实口径长段已移入 PageIntro.points（默认收起），卡内不应常驻
    expect(text).not.toContain('平台不会改动你的分组')
    // 保留：两个控件 + 各自结论
    expect(text).toContain('没匹配到具体规则的告警，发给哪个渠道')
    expect(text).toContain('路由规则由谁维护')
  })

  /**
   * 2026-10-08 认知断层护栏（用户实测原话：「用户角度，如何知道腾讯云边缘域就是平台兜底的策略」）。
   *
   * 结论 Tag 与下拉框是**并列的两个独立元素**。若结论里再写一遍渠道名/接收人名，
   * 界面上没有任何一处明说"二者是同一个"，用户只能靠猜；更糟的是渠道名可能像
   * 「腾讯云边缘域-飞书」那样带无关字样（与网域系统毫无关系，纯属起名误导），
   * 于是"这个渠道"看着像一个网域、而非一张飞书卡片。
   *
   * 本用例锁死：**结论只说状态、用「你选中的渠道」回指控件**，不复述任何具体名称。
   * 若将来有人"为了更明确"把渠道名/接收人名加回结论 Tag，本用例会失败。
   */
  it('2026-10-08：结论 Tag 只说状态、不复述渠道名（消除左右对应关系歧义）', () => {
    useAlertConfigMock.mockReturnValue(result())
    useRouteSettingMock.mockReturnValue(
      routeSettingResult({
        setting: {
          enabled: true,
          default_receiver_channel_id: 1,
          effective_receiver_name: 'notify-1',
          effective_source: 'explicit',
          mode: 'handwritten',
        },
      }),
    )
    renderPage()
    const conclusion = screen.getByTestId('fallback-conclusion').textContent ?? ''
    expect(conclusion).toContain('已接管')
    // 用「你选中的渠道」回指控件，明确左右是同一个
    expect(conclusion).toContain('你选中的渠道')
    // 不得复述平台内部接收人标识
    expect(conclusion).not.toContain('notify-1')
  })
})
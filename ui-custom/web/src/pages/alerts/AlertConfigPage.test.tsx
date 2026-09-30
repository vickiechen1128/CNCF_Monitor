import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from 'antd'
import { setupAntdTest, mockAntdModal } from '../../test/antdTestUtils'
import { ApiError } from '../../api/client'
import { AlertConfigPage } from './AlertConfigPage'
import type { AlertmanagerConfigVersionListItem } from '../../types/alertmanager'

const useAlertConfigMock = vi.fn()
const getVersionMock = vi.fn()
const useDerivedReceiversMock = vi.fn()

vi.mock('./useAlertConfig', () => ({
  useAlertConfig: (...a: unknown[]) => useAlertConfigMock(...a),
}))

// 派生预览数据 Hook 单独 mock：避免页面渲染时穿透到真实 API（与页面既有 Hook mock 模式一致）
vi.mock('./useDerivedReceivers', () => ({
  useDerivedReceivers: (...a: unknown[]) => useDerivedReceiversMock(...a),
}))

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
const remountMock = vi.fn()

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
    remount: remountMock,
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
    remountMock.mockReset()
    remountMock.mockResolvedValue({ status: 'success', data: { id: 'acv-9', content: '', checksum: '', status: 'applied' } })
    // 派生预览默认空态（无已启用渠道）；具体断言在各自用例内覆盖返回值
    useDerivedReceiversMock.mockReset()
    useDerivedReceiversMock.mockReturnValue({
      rows: [],
      loading: false,
      error: null,
      permissionDenied: false,
      reload: vi.fn(),
    })
  })

  // 2026-09-29 排版优化：文档性内容收进默认收起的「写配置前必读」折叠栏
  // （遵循本模块「说明不占常驻首屏」约定，与 AlertStatusPage 的折叠栏一致），
  // 因此依赖这些文案的用例需先点击标题展开再断言。
  const expandGuidance = () => {
    fireEvent.click(screen.getByText(/写配置前必读：三块必写 \+ 两块豁免/))
  }

  it('加载中提示', () => {
    useAlertConfigMock.mockReturnValue(result({ loading: true }))
    renderPage()
    expect(screen.getByText('告警配置')).toBeInTheDocument()
    expect(screen.getByText('加载中…')).toBeInTheDocument()
  })

  it('空态：无当前生效配置时展示挂载引导', () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    expect(screen.getByText('配置版本历史')).toBeInTheDocument()
    // 当前生效配置区空态引导
    expect(screen.getByText(/当前无生效配置/)).toBeInTheDocument()
  })

  // PL-1（D-1 方案丙）：说明卡澄清本页边界（只管发给谁/怎么收敛），并提供「去写规则」跨模块入口。
  it('PL-1：配置说明卡含跨模块说明与指向 /rules 的引导链接', () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    expect(screen.getByText(/告警规则（什么情况下告警）在「规则编辑」维护/)).toBeInTheDocument()
    expect(screen.getByText(/本页只管「告警发给谁、怎么收敛」/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '去写规则 →' })).toHaveAttribute('href', '/rules')
  })

  // 排版优化回归：折叠栏默认收起，文档内容不占常驻首屏；点击标题后展开可见。
  it('写配置前必读折叠栏默认收起，点击标题后展开', async () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    expect(screen.getByText(/写配置前必读：三块必写 \+ 两块豁免/)).toBeInTheDocument()
    // 默认收起：折叠栏内的文档内容不在 DOM
    expect(screen.queryByText('本页你需要写这三块：')).toBeNull()
    expect(screen.queryByText(/inhibit_rules:/)).toBeNull()
    // 展开后文档内容可见
    expandGuidance()
    expect(await screen.findByText('本页你需要写这三块：')).toBeInTheDocument()
  })

  // PL-2：说明卡显式列出三块必写 + 两块豁免，给出最小可运行骨架；豁免项 ④ 引导静默管理，
  // 豁免项 ⑤（通知模板）在 PL-3 模板页就绪后回填入口（T08-F12，关闭 dev-feedback #14）。
  it('PL-2：配置说明卡列出三块必写 + 两块豁免，并展示最小骨架与静默入口', async () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    expandGuidance()
    expect(await screen.findByText('本页你需要写这三块：')).toBeInTheDocument()
    // 三块必写
    expect(screen.getByText('接收人 / 渠道')).toBeInTheDocument()
    expect(screen.getByText('路由')).toBeInTheDocument()
    expect(screen.getByText('收敛（告警抑制）')).toBeInTheDocument()
    // 两块豁免
    expect(screen.getByText('这两块不用你写（已豁免）：')).toBeInTheDocument()
    expect(screen.getByText('静默（silences）')).toBeInTheDocument()
    expect(screen.getByText('通知模板内容（templates）')).toBeInTheDocument()
    // 豁免项 ④ 的平台内替代入口指向静默管理页
    expect(screen.getByRole('link', { name: '静默管理' })).toHaveAttribute('href', '/silences')
    // 豁免项 ⑤ 的平台内替代入口指向通知模板页（PL-3 落地后回填，不再是死链）
    expect(screen.getByRole('link', { name: '通知模板' })).toHaveAttribute('href', '/notify-templates')
    // 最小可运行骨架已渲染（含三块必写关键字）
    expect(screen.getByText(/inhibit_rules:/)).toBeInTheDocument()
    expect(screen.getByText(/resolve_timeout: 5m/)).toBeInTheDocument()
  })

  // B 路线（决策 74）：receivers 仍为必写块（自定义场景），但已启用渠道的接收人由平台自动写入，
  // 该块给出「通知渠道」页入口，并传达「自动物化 + 手写仅用于自定义」的心智。
  it('B 路线：接收人 / 渠道必写块说明自动物化心智，并给出「通知渠道」入口', async () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    expandGuidance()
    expect(await screen.findByText(/一般无需手写；仅在需要自定义接收人时才手写/)).toBeInTheDocument()
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

  // B 路线（决策 74 第 3 条）：只读「派生预览」展示平台 UI 控制的已启用渠道将被写进 alertmanager.yml 的 receivers。
  it('派生预览：只读展示已启用渠道派生的接收人名与 YAML 片段', () => {
    useAlertConfigMock.mockReturnValue(result())
    useDerivedReceiversMock.mockReturnValue({
      rows: [
        {
          channelId: '1',
          channelName: 'SRE 飞书群',
          receiverName: 'sre-feishu-qun',
          snippet:
            "  - name: sre-feishu-qun\n    webhook_configs:\n      - url: 'http://127.0.0.1:8080/api/v1/webhooks/notify?channel=1'\n",
          tokenConfigured: true,
        },
      ],
      loading: false,
      error: null,
      permissionDenied: false,
      reload: vi.fn(),
    })
    renderPage()
    expect(screen.getByText('派生预览：平台将写入的接收人')).toBeInTheDocument()
    expect(screen.getByText('SRE 飞书群')).toBeInTheDocument()
    expect(screen.getByText('sre-feishu-qun')).toBeInTheDocument()
    // 范围声明：手写/上传内容原样透传、不在此预览内
    expect(screen.getByText(/不在此预览内，平台不解析其语义/)).toBeInTheDocument()
    // 重名提醒
    expect(screen.getByText(/请勿手写与上表同名/)).toBeInTheDocument()
    // 桥令牌未走 URL：展示的派生片段里不得出现 token=
    expect(document.body.textContent ?? '').not.toContain('token=')
  })

  it('派生预览：无已启用渠道时展示空态引导并指向「通知渠道」页', () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    expect(screen.getByText(/暂无已启用的通知渠道/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '「通知渠道」' })).toHaveAttribute('href', '/notify-channels')
  })

  it('派生预览：接收人片段无权限（403）时优雅降级为提示，不崩页', () => {
    useAlertConfigMock.mockReturnValue(result())
    useDerivedReceiversMock.mockReturnValue({
      rows: [],
      loading: false,
      error: null,
      permissionDenied: true,
      reload: vi.fn(),
    })
    renderPage()
    expect(screen.getByText('无权限查看派生接收人')).toBeInTheDocument()
    expect(screen.getByText(/渠道接收人仍由平台自动写入，不影响生效/)).toBeInTheDocument()
    // 权限不足时不误报空态
    expect(screen.queryByText(/暂无已启用的通知渠道/)).toBeNull()
  })

  it('渲染当前生效配置只读视图与版本列表', async () => {
    useAlertConfigMock.mockReturnValue(
      result({ current: { id: 'acv-1', content: 'global:\n  resolve_timeout: 30s', checksum: 'abc', status: 'applied' }, versions: [versionRow()], total: 1 }),
    )
    renderPage()
    // 「当前生效配置」结构化 Descriptions 与「配置版本历史」表格行均展示版本 ID acv-1
    expect((await screen.findAllByText('acv-1')).length).toBeGreaterThan(0)
    // 当前生效配置的只读 pre 与说明卡的最小骨架均含 resolve_timeout，故用 getAllByText
    expect(screen.getAllByText(/resolve_timeout/).length).toBeGreaterThan(0)
    expect(screen.getByText('CHG-20260831-001')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重新挂载此版本/ })).toBeInTheDocument()
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
    expect(await screen.findAllByText('已提交，待确认下发')).not.toHaveLength(0)
    expect(screen.getAllByText(/需确认下发后才会生效/).length).toBeGreaterThanOrEqual(1)
    // 附 M09 配置变更单跳转入口（有变更单号则深链到该单）
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
    fireEvent.click(screen.getByRole('button', { name: /挂载新配置/ }))
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
    fireEvent.click(screen.getByRole('button', { name: /挂载新配置/ }))
    const textarea = screen.getByPlaceholderText(/# 在此粘贴 alertmanager\.yml 完整内容/)
    fireEvent.change(textarea, { target: { value: 'route: x' } })
    fireEvent.click(screen.getByRole('button', { name: /本地大小检查/ }))
    fireEvent.click(screen.getByRole('button', { name: /提交并进入变更确认/ }))
    await waitFor(() => expect(submitMock).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('引用闭合错误')).toBeInTheDocument())
    expect(screen.getByText('配置语法错误')).toBeInTheDocument()
  })

  it('重新挂载历史版本：Modal 二次确认后调用 remount', async () => {
    useAlertConfigMock.mockReturnValue(result({ versions: [versionRow()], total: 1 }))
    const modal = mockAntdModal()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /重新挂载此版本/ }))
    expect(modal.confirm).toHaveBeenCalled()
    const onOk = modal.confirm.mock.calls[0][0].onOk as () => Promise<void>
    await onOk()
    expect(remountMock).toHaveBeenCalledWith('acv-1', expect.any(String))
  })
})
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from 'antd'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { setupAntdTest, mockAntdModal } from '../../test/antdTestUtils'
import { ServiceManagementPage, ServiceDictDrawer } from './ServiceManagementPage'
import { DICT_LIFECYCLE_NOTICE } from './DictLifecycleNotice'
import type { ApplicationDict, ServiceDict } from '../../types/resource'

const listMock = vi.fn()
const createMock = vi.fn()
const updateMock = vi.fn()
const appListMock = vi.fn()

vi.mock('../../api/resources', () => ({
  serviceDictApi: {
    list: (...args: unknown[]) => listMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
  },
  applicationDictApi: {
    list: (...args: unknown[]) => appListMock(...args),
  },
}))

const services: ServiceDict[] = [
  { service_code: 'order-api', service_name: '订单接口服务', description: '交易主链路', app_code: 'order-service', enabled: true },
  { service_code: 'pay-callback', service_name: '支付回调服务', description: '支付域', app_code: 'pay-service', enabled: true },
  { service_code: 'legacy-api', service_name: '已下线服务', description: '停用中', app_code: null, enabled: false },
]

/** F-19：应用字典夹具——含启用项、停用项，以及一条服务已挂但字典中不存在的孤儿引用 */
const applications: ApplicationDict[] = [
  { app_code: 'order-service', app_name: '订单服务', status: 'enabled' },
  { app_code: 'pay-service', app_name: '支付服务', status: 'enabled' },
  { app_code: 'legacy-service', app_name: '下线服务', status: 'disabled' },
]

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/service-dict']}>
      <Routes>
        <Route path="/service-dict" element={<ServiceManagementPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** 关闭 → 打开切换的回显回归夹具（forceRender 常驻Form） */
function ToggleHarness() {
  const [record, setRecord] = useState<ServiceDict | null>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        onClick={() => {
          setRecord(services[0])
          setOpen(true)
        }}
      >
        打开编辑
      </Button>
      <Button
        onClick={() => {
          setRecord(null)
          setOpen(false)
        }}
      >
        关闭
      </Button>
      <ServiceDictDrawer
        open={open}
        record={record}
        applications={applications}
        onCancel={() => {}}
        onSuccess={() => {}}
      />
    </>
  )
}

describe('ServiceManagementPage', () => {
  setupAntdTest()

  beforeEach(() => {
    listMock.mockReset()
    createMock.mockReset()
    updateMock.mockReset()
    appListMock.mockReset()
    listMock.mockResolvedValue({ status: 'success', data: { list: services, total: services.length } })
    appListMock.mockResolvedValue({ status: 'success', data: { list: applications, total: applications.length } })
    createMock.mockResolvedValue({
      status: 'success',
      data: { service_code: 'checkout-api', service_name: '结算接口服务', enabled: true },
    })
    updateMock.mockResolvedValue({
      status: 'success',
      data: { service_code: 'order-api', service_name: '订单接口服务', enabled: false },
    })
  })

  it('加载并渲染服务字典列表，停用条目以「服务名（已停用）」标识', async () => {
    renderPage()
    expect(await screen.findByText('order-api')).toBeInTheDocument()
    expect(screen.getByText('支付回调服务')).toBeInTheDocument()
    // 停用条目按「服务名（已停用）」展示（§5.22 / 契约快照 §5D）
    expect(screen.getByText('已下线服务（已停用）')).toBeInTheDocument()
    expect(listMock).toHaveBeenCalledTimes(1)
  })

  it('点击「登记服务」打开登记抽屉，编码字段可填且展示不可改提示', async () => {
    renderPage()
    await screen.findByText('order-api')

    await userEvent.click(screen.getByRole('button', { name: /登记服务/ }))
    expect(await screen.findByText('服务编码创建后不可修改')).toBeInTheDocument()
    expect(await screen.findByLabelText('服务编码')).toBeEnabled()
    expect(createMock).not.toHaveBeenCalled()
  })

  // F7 / 决策 112：字典 ≠ 可删除对象——顶部定位说明 + 无删除入口（停用不删除红线）
  it('渲染「字典 ≠ 可删除对象」定位说明，且不提供删除入口', async () => {
    renderPage()
    await screen.findByText('order-api')

    expect(screen.getByText(DICT_LIFECYCLE_NOTICE)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /删除/ })).toBeNull()
    const row = screen.getByText('order-api').closest('tr')!
    expect(within(row).getByRole('button', { name: /编\s*辑/ })).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /删除/ })).toBeNull()
  })

  it('「更多」菜单停用经确认弹层提交 enabled=false（停用不删除）', async () => {
    const modal = mockAntdModal()
    renderPage()
    await screen.findByText('order-api')

    const row = screen.getByText('order-api').closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: /更多/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: '停用' }))

    await waitFor(() => expect(modal.confirm).toHaveBeenCalledTimes(1))
    const onOk = modal.confirm.mock.calls[0][0].onOk
    await onOk?.()

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('order-api', { enabled: false }))
  })

  // F-19：列表「所属应用」列——展示 app_name，缺条目回退 app_code，未挂应用显示 '-'
  it('F-19：列表「所属应用」列展示应用名，未挂应用显示 "-"', async () => {
    renderPage()
    expect(await screen.findByText('order-api')).toBeInTheDocument()

    const orderRow = screen.getByText('order-api').closest('tr')!
    expect(within(orderRow).getByText('订单服务')).toBeInTheDocument()
    const legacyRow = screen.getByText('legacy-api').closest('tr')!
    expect(within(legacyRow).queryByText('订单服务')).toBeNull()
    // 无所属应用（app_code=null）→ '-'
    expect(within(legacyRow).getAllByText('-').length).toBeGreaterThanOrEqual(1)
  })

  // F-19：应用字典缺条目时回退展示 app_code；应用已停用加「（已停用）」
  it('F-19：所属应用缺字典条目回退 app_code，应用停用加「（已停用）」', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { service_code: 'orphan-api', service_name: '孤儿服务', app_code: 'not-in-dict', enabled: true },
          { service_code: 'legacy-bind', service_name: '挂停用应用', app_code: 'legacy-service', enabled: true },
        ],
        total: 2,
      },
    })
    renderPage()
    expect(await screen.findByText('orphan-api')).toBeInTheDocument()

    // 字典中无 not-in-dict → 回退展示编码本身
    expect(within(screen.getByText('orphan-api').closest('tr')!).getByText('not-in-dict')).toBeInTheDocument()
    // 已停用应用 → 「应用名（已停用）」
    expect(screen.getByText('下线服务（已停用）')).toBeInTheDocument()
  })

  // F-19：应用字典加载失败时降级——服务列表仍可用，所属应用按 app_code 回退
  it('F-19：应用字典加载失败不影响服务列表，所属应用回退 app_code', async () => {
    appListMock.mockRejectedValue(new Error('应用字典加载失败'))
    renderPage()
    expect(await screen.findByText('order-api')).toBeInTheDocument()

    // 字典为空 → 回退展示 app_code，不报错、不空表
    expect(within(screen.getByText('order-api').closest('tr')!).getByText('order-service')).toBeInTheDocument()
    expect(screen.queryByText('服务字典加载失败，请稍后重试')).toBeNull()
  })

  // F-19：PM 裁定「主业务」（biz_code）本轮不做——前端不暴露任何入口
  it('F-19：前端不暴露「主业务」入口（PM 裁定 biz_code 本轮不做）', async () => {
    renderPage()
    await screen.findByText('order-api')

    // 列表无「主业务」列
    expect(screen.queryByRole('columnheader', { name: /主业务/ })).toBeNull()
    // 抽屉表单无「主业务」字段
    await userEvent.click(screen.getByRole('button', { name: /登记服务/ }))
    expect(await screen.findByLabelText('服务编码')).toBeInTheDocument()
    expect(screen.queryByLabelText(/主业务/)).toBeNull()
  })
})

describe('ServiceDictDrawer', () => {
  setupAntdTest()

  beforeEach(() => {
    listMock.mockReset()
    createMock.mockReset()
    updateMock.mockReset()
    appListMock.mockReset()
    createMock.mockResolvedValue({
      status: 'success',
      data: { service_code: 'checkout-api', service_name: '结算接口服务', enabled: true },
    })
    updateMock.mockResolvedValue({
      status: 'success',
      data: { service_code: 'pay-callback', service_name: '支付回调服务', enabled: true },
    })
  })

  it('登记校验失败：编码不规范时字段下方提示，且不调用 create', async () => {
    render(<ServiceDictDrawer open record={null} onCancel={() => {}} onSuccess={() => {}} />)

    await userEvent.type(screen.getByLabelText('服务编码'), 'Bad_Service')
    await userEvent.type(screen.getByLabelText('服务名'), '结算接口服务')
    await userEvent.click(screen.getByRole('button', { name: /登\s*记/ }))

    expect(await screen.findByText('编码仅允许小写字母、数字、连字符（≤ 64 字符）')).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('登记合法编码调用 create 提交 {service_code,service_name,description}', async () => {
    render(<ServiceDictDrawer open record={null} applications={applications} onCancel={() => {}} onSuccess={() => {}} />)

    await userEvent.type(screen.getByLabelText('服务编码'), 'checkout-api')
    await userEvent.type(screen.getByLabelText('服务名'), '结算接口服务')
    await userEvent.click(screen.getByRole('button', { name: /登\s*记/ }))

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        service_code: 'checkout-api',
        service_name: '结算接口服务',
        description: undefined,
        // F-19：未选所属应用 → undefined（由 api 层省略该键，不回传空串）
        app_code: undefined,
      }),
    )
  })

  // F-19：登记时选中「所属应用」→ create 携带 app_code
  it('F-19：登记时选择所属应用，create 提交 app_code', async () => {
    render(<ServiceDictDrawer open record={null} applications={applications} onCancel={() => {}} onSuccess={() => {}} />)

    await userEvent.type(screen.getByLabelText('服务编码'), 'checkout-api')
    await userEvent.type(screen.getByLabelText('服务名'), '结算接口服务')
    // 打开「所属应用」下拉并选中启用项
    await userEvent.click(screen.getByLabelText('所属应用'))
    await userEvent.click(await screen.findByText('订单服务（order-service）'))
    await userEvent.click(screen.getByRole('button', { name: /登\s*记/ }))

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        service_code: 'checkout-api',
        service_name: '结算接口服务',
        description: undefined,
        app_code: 'order-service',
      }),
    )
  })

  // F-19：下拉仅列启用应用；已停用应用不被新选（编辑态历史归属仍回显）
  it('F-19：「所属应用」下拉仅列启用应用，停用应用不出现在登记态选项中', async () => {
    render(<ServiceDictDrawer open record={null} applications={applications} onCancel={() => {}} onSuccess={() => {}} />)

    await userEvent.click(screen.getByLabelText('所属应用'))
    expect(await screen.findByText('订单服务（order-service）')).toBeInTheDocument()
    expect(screen.getByText('支付服务（pay-service）')).toBeInTheDocument()
    // 停用应用不在新建选项中
    expect(screen.queryByText(/下线服务/)).toBeNull()
  })

  // F-19：编辑态回显已停用应用的归属（不清空、不静默丢失）
  it('F-19：编辑态回显已停用应用的归属并标「（已停用）」，提交原值不丢失', async () => {
    const record: ServiceDict = {
      service_code: 'legacy-bind',
      service_name: '挂停用应用',
      description: '',
      app_code: 'legacy-service',
      enabled: true,
    }
    render(<ServiceDictDrawer open record={record} applications={applications} onCancel={() => {}} onSuccess={() => {}} />)

    // 历史归属作为回显项可见
    expect(await screen.findByText('下线服务（已停用）')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    const body = (updateMock.mock.calls[0] as [string, Record<string, unknown>])[1]
    expect(body.app_code).toBe('legacy-service')
  })

  // F-19：清空「所属应用」→ 提交 null 表达「摘除」（契约 null=摘除 / undefined=不改）
  it('F-19：清空所属应用提交 app_code=null 表达摘除', async () => {
    render(
      <ServiceDictDrawer
        open
        record={services[0]}
        applications={applications}
        onCancel={() => {}}
        onSuccess={() => {}}
      />,
    )

    // 编辑态回显原归属 order-service
    expect(await screen.findByText('订单服务（order-service）')).toBeInTheDocument()
    // antd clear 图标由 CSS 控制显隐，jsdom 下用 fireEvent 直接触发（与 ApplicationDictPage 同口径）
    // 注意：表单内有两个 Select（「所属应用」+ 编辑态的「状态」），必须按 label 精确定位到
    // 「所属应用」那一项，否则全局 querySelector 会命中「状态」的「启用」项导致误判。
    const appSelect = screen.getByLabelText('所属应用').closest('.ant-select') as HTMLElement
    const clear = appSelect.querySelector('.ant-select-clear') as HTMLElement
    expect(clear).toBeTruthy()
    fireEvent.mouseDown(clear)
    fireEvent.click(clear)
    await waitFor(() =>
      expect(appSelect.querySelector('.ant-select-selection-item')).toBeNull(),
    )
    // 摘除后应回到未选态（placeholder 可见），且不影响下方「状态」项
    expect(screen.getByText('选填，选择所属应用')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    const body = (updateMock.mock.calls[0] as [string, Record<string, unknown>])[1]
    expect(body.app_code).toBeNull()
  })

  it('受限编辑：编码禁用，仅提交 service_name/description/enabled（不携带 service_code）', async () => {
    render(
      <ServiceDictDrawer open record={services[1]} applications={applications} onCancel={() => {}} onSuccess={() => {}} />,
    )

    const codeInput = await screen.findByLabelText('服务编码')
    expect(codeInput).toBeDisabled()
    expect(codeInput).toHaveValue('pay-callback')

    const nameInput = screen.getByLabelText('服务名')
    expect(nameInput).toHaveValue('支付回调服务')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, '支付回调服务(新)')

    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith('pay-callback', {
        service_name: '支付回调服务(新)',
        description: '支付域',
        enabled: true,
        // F-19：未改动所属应用时原样提交 pay-service
        app_code: 'pay-service',
      }),
    )
    const [codeArg, bodyArg] = updateMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(codeArg).toBe('pay-callback')
    expect(bodyArg).not.toHaveProperty('service_code')
  })

  it('关闭后重新打开仍正确回显（forceRender 常驻 Form 回归）', async () => {
    render(<ToggleHarness />)

    await userEvent.click(screen.getByRole('button', { name: '打开编辑' }))
    expect(await screen.findByLabelText('服务名')).toHaveValue('订单接口服务')

    // antd Button 对 2 字中文自动加空格渲染为「关 闭」，用正则去空白匹配
    await userEvent.click(screen.getByRole('button', { name: /关\s*闭/ }))
    await waitFor(() => expect(document.querySelector('.ant-drawer')).not.toHaveClass('ant-drawer-open'))

    // 重新打开：Form 常驻（forceRender），回显不丢失
    await userEvent.click(screen.getByRole('button', { name: '打开编辑' }))
    await waitFor(() => expect(screen.getByLabelText('服务名')).toHaveValue('订单接口服务'))
    expect(screen.getByLabelText('服务编码')).toHaveValue('order-api')
  })
})

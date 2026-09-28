import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from 'antd'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { setupAntdTest, mockAntdModal } from '../../test/antdTestUtils'
import { ServiceManagementPage, ServiceDictDrawer } from './ServiceManagementPage'
import type { ServiceDict } from '../../types/resource'

const listMock = vi.fn()
const createMock = vi.fn()
const updateMock = vi.fn()

vi.mock('../../api/resources', () => ({
  serviceDictApi: {
    list: (...args: unknown[]) => listMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
  },
}))

const services: ServiceDict[] = [
  { service_code: 'order-api', service_name: '订单接口服务', description: '交易主链路', enabled: true },
  { service_code: 'pay-callback', service_name: '支付回调服务', description: '支付域', enabled: true },
  { service_code: 'legacy-api', service_name: '已下线服务', description: '停用中', enabled: false },
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

/** 关闭 → 打开切换的回显回归夹具（forceRender 常驻 Form） */
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
      <ServiceDictDrawer open={open} record={record} onCancel={() => {}} onSuccess={() => {}} />
    </>
  )
}

describe('ServiceManagementPage', () => {
  setupAntdTest()

  beforeEach(() => {
    listMock.mockReset()
    createMock.mockReset()
    updateMock.mockReset()
    listMock.mockResolvedValue({ status: 'success', data: { list: services, total: services.length } })
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
})

describe('ServiceDictDrawer', () => {
  setupAntdTest()

  beforeEach(() => {
    listMock.mockReset()
    createMock.mockReset()
    updateMock.mockReset()
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
    render(<ServiceDictDrawer open record={null} onCancel={() => {}} onSuccess={() => {}} />)

    await userEvent.type(screen.getByLabelText('服务编码'), 'checkout-api')
    await userEvent.type(screen.getByLabelText('服务名'), '结算接口服务')
    await userEvent.click(screen.getByRole('button', { name: /登\s*记/ }))

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        service_code: 'checkout-api',
        service_name: '结算接口服务',
        description: undefined,
      }),
    )
  })

  it('受限编辑：编码禁用，仅提交 service_name/description/enabled（不携带 service_code）', async () => {
    render(<ServiceDictDrawer open record={services[1]} onCancel={() => {}} onSuccess={() => {}} />)

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

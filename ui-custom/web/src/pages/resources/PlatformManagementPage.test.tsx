import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from 'antd'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { setupAntdTest, mockAntdModal } from '../../test/antdTestUtils'
import { PlatformManagementPage, PlatformDictDrawer } from './PlatformManagementPage'
import type { PlatformDict } from '../../types/resource'

const listMock = vi.fn()
const createMock = vi.fn()
const updateMock = vi.fn()

vi.mock('../../api/resources', () => ({
  platformDictApi: {
    list: (...args: unknown[]) => listMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
  },
}))

const platforms: PlatformDict[] = [
  { platform_code: 'ecommerce', platform_name: '电商中台', description: '交易主链路', enabled: true },
  { platform_code: 'public-data-auth', platform_name: '公共数据授权运营平台', description: '数据授权', enabled: true },
  { platform_code: 'legacy-pf', platform_name: '已下线平台', description: '停用中', enabled: false },
]

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/platform-dict']}>
      <Routes>
        <Route path="/platform-dict" element={<PlatformManagementPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** 关闭 → 打开切换的回显回归夹具（forceRender 常驻 Form） */
function ToggleHarness() {
  const [record, setRecord] = useState<PlatformDict | null>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        onClick={() => {
          setRecord(platforms[0])
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
      <PlatformDictDrawer open={open} record={record} onCancel={() => {}} onSuccess={() => {}} />
    </>
  )
}

describe('PlatformManagementPage', () => {
  setupAntdTest()

  beforeEach(() => {
    listMock.mockReset()
    createMock.mockReset()
    updateMock.mockReset()
    listMock.mockResolvedValue({ status: 'success', data: { list: platforms, total: platforms.length } })
    createMock.mockResolvedValue({
      status: 'success',
      data: { platform_code: 'risk-pf', platform_name: '风控平台', enabled: true },
    })
    updateMock.mockResolvedValue({
      status: 'success',
      data: { platform_code: 'ecommerce', platform_name: '电商中台', enabled: false },
    })
  })

  it('加载并渲染平台字典列表，停用条目以「平台名（已停用）」标识', async () => {
    renderPage()
    expect(await screen.findByText('ecommerce')).toBeInTheDocument()
    expect(screen.getByText('公共数据授权运营平台')).toBeInTheDocument()
    // 停用条目按「平台名（已停用）」展示（§5.21 / 契约快照 §5C）
    expect(screen.getByText('已下线平台（已停用）')).toBeInTheDocument()
    expect(listMock).toHaveBeenCalledTimes(1)
  })

  it('点击「登记平台」打开登记抽屉，编码字段可填且展示不可改提示', async () => {
    renderPage()
    await screen.findByText('ecommerce')

    await userEvent.click(screen.getByRole('button', { name: /登记平台/ }))
    expect(await screen.findByText('平台编码创建后不可修改')).toBeInTheDocument()
    expect(await screen.findByLabelText('平台编码')).toBeEnabled()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('「更多」菜单停用经确认弹层提交 enabled=false（停用不删除）', async () => {
    const modal = mockAntdModal()
    renderPage()
    await screen.findByText('ecommerce')

    const row = screen.getByText('ecommerce').closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: /更多/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: '停用' }))

    await waitFor(() => expect(modal.confirm).toHaveBeenCalledTimes(1))
    const onOk = modal.confirm.mock.calls[0][0].onOk
    await onOk?.()

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('ecommerce', { enabled: false }))
  })
})

describe('PlatformDictDrawer', () => {
  setupAntdTest()

  beforeEach(() => {
    listMock.mockReset()
    createMock.mockReset()
    updateMock.mockReset()
    createMock.mockResolvedValue({
      status: 'success',
      data: { platform_code: 'risk-pf', platform_name: '风控平台', enabled: true },
    })
    updateMock.mockResolvedValue({
      status: 'success',
      data: { platform_code: 'public-data-auth', platform_name: '公共数据授权运营平台', enabled: true },
    })
  })

  it('登记校验失败：编码不规范时字段下方提示，且不调用 create', async () => {
    render(<PlatformDictDrawer open record={null} onCancel={() => {}} onSuccess={() => {}} />)

    await userEvent.type(screen.getByLabelText('平台编码'), 'Bad_Platform')
    await userEvent.type(screen.getByLabelText('平台名'), '风控平台')
    await userEvent.click(screen.getByRole('button', { name: /登\s*记/ }))

    expect(await screen.findByText('编码仅允许小写字母、数字、连字符（≤ 64 字符）')).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('登记合法编码调用 create 提交 {platform_code,platform_name,description}', async () => {
    render(<PlatformDictDrawer open record={null} onCancel={() => {}} onSuccess={() => {}} />)

    await userEvent.type(screen.getByLabelText('平台编码'), 'risk-pf')
    await userEvent.type(screen.getByLabelText('平台名'), '风控平台')
    await userEvent.click(screen.getByRole('button', { name: /登\s*记/ }))

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        platform_code: 'risk-pf',
        platform_name: '风控平台',
        description: undefined,
      }),
    )
  })

  it('受限编辑：编码禁用，仅提交 platform_name/description/enabled（不携带 platform_code）', async () => {
    render(<PlatformDictDrawer open record={platforms[1]} onCancel={() => {}} onSuccess={() => {}} />)

    const codeInput = await screen.findByLabelText('平台编码')
    expect(codeInput).toBeDisabled()
    expect(codeInput).toHaveValue('public-data-auth')

    const nameInput = screen.getByLabelText('平台名')
    expect(nameInput).toHaveValue('公共数据授权运营平台')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, '公共数据授权运营平台(新)')

    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith('public-data-auth', {
        platform_name: '公共数据授权运营平台(新)',
        description: '数据授权',
        enabled: true,
      }),
    )
    const [codeArg, bodyArg] = updateMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(codeArg).toBe('public-data-auth')
    expect(bodyArg).not.toHaveProperty('platform_code')
  })

  it('关闭后重新打开仍正确回显（forceRender 常驻 Form 回归）', async () => {
    render(<ToggleHarness />)

    await userEvent.click(screen.getByRole('button', { name: '打开编辑' }))
    expect(await screen.findByLabelText('平台名')).toHaveValue('电商中台')

    // antd Button 对 2 字中文自动加空格渲染为「关 闭」，用正则去空白匹配
    await userEvent.click(screen.getByRole('button', { name: /关\s*闭/ }))
    await waitFor(() => expect(document.querySelector('.ant-drawer')).not.toHaveClass('ant-drawer-open'))

    // 重新打开：Form 常驻（forceRender），回显不丢失
    await userEvent.click(screen.getByRole('button', { name: '打开编辑' }))
    await waitFor(() => expect(screen.getByLabelText('平台名')).toHaveValue('电商中台'))
    expect(screen.getByLabelText('平台编码')).toHaveValue('ecommerce')
  })
})

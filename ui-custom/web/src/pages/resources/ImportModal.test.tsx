import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { mockAntdMessage, type MockedMessage } from '../../test/antdTestUtils'
import { ImportModal } from './ImportModal'
import type { ImportError, ImportResult, ResourceCategory } from '../../types/resource'

const templateMock = vi.fn()
const importExcelMock = vi.fn()

vi.mock('../../api/resources', () => ({
  resourceApi: {
    template: (...args: unknown[]) => templateMock(...args),
    importExcel: (...args: unknown[]) => importExcelMock(...args),
  },
}))

const cancelMock = vi.fn()
const successMock = vi.fn()

function renderModal(over: Partial<{ open: boolean; category: ResourceCategory }> = {}) {
  const open = over.open ?? true
  const category = over.category ?? 'host'
  return render(<ImportModal open={open} category={category} onCancel={cancelMock} onSuccess={successMock} />)
}

/** 通过隐藏 file input 选择文件（antd Upload beforeUpload=false 将文件加入 fileList） */
function selectFile() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(['name,ip\nweb,10.0.1.1'], 'hosts.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  // jsdom 下直接以 defineProperty 写入 files，再触发 change（rc-upload 读取 e.target.files）
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
}

function importResult(over: Partial<ImportResult> = {}): ImportResult {
  return {
    total: 10,
    success: 7,
    updated: 2,
    failed: 1,
    errors: [
      { row: 3, resource_category: 'host', field: 'instance_ip', value: '999.1.1.1', reason: 'IP 非法' },
      { row: 5, resource_category: 'host', field: 'biz_code', value: 'unk', reason: '未登记业务，请前往维护业务字典' },
    ],
    ...over,
  }
}

describe('ImportModal', () => {
  let msg: MockedMessage

  beforeEach(() => {
    templateMock.mockReset()
    importExcelMock.mockReset()
    cancelMock.mockReset()
    successMock.mockReset()
    // jsdom 未实现 createObjectURL / revokeObjectURL，桩掉以完成浏览器下载触发
    URL.createObjectURL = vi.fn(() => 'blob:mock')
    URL.revokeObjectURL = vi.fn()
    // 静默 antd 静态 message，避免测试输出噪音与 act 告警
    msg = mockAntdMessage()
  })

  it('F-8-a：次级文字链接直触发下载当前资源类型模板', async () => {
    templateMock.mockResolvedValue(new Blob(['xlsx'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: /没有模板？下载当前资源类型模板/ }))
    await waitFor(() => expect(templateMock).toHaveBeenCalledWith('host'))
    expect(URL.createObjectURL).toHaveBeenCalled()
  })

  it('F-8-a：删除下载模板块后无黑话残留，仅保留次级下载链接', () => {
    renderModal()
    // 次级文字链接存在；原「下载模板」主按钮已删除
    expect(screen.getByRole('button', { name: /没有模板？下载当前资源类型模板/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '下载模板' })).toBeNull()
    // 黑话 / 冗余说明零残留（F-8-a）
    expect(screen.queryByText(/取值说明/)).toBeNull()
    expect(screen.queryByText(/合法值清单/)).toBeNull()
    expect(screen.queryByText(/决策 97/)).toBeNull()
    expect(screen.queryByText(/请先下载对应资源类型的模板/)).toBeNull()
    expect(screen.queryByText(/状态列支持中文取值/)).toBeNull()
  })

  it('F-8-a：次级下载链接联动当前 Tab 类别（database）', async () => {
    templateMock.mockResolvedValue(new Blob(['xlsx']))
    renderModal({ category: 'database' })
    fireEvent.click(screen.getByRole('button', { name: /没有模板？下载当前资源类型模板/ }))
    await waitFor(() => expect(templateMock).toHaveBeenCalledWith('database'))
  })

  it('renders mode options with create_only selected by default', () => {
    renderModal()
    expect(screen.getByRole('radio', { name: /仅新增/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /新增或更新/ })).not.toBeChecked()
  })

  it('F-9：导入模式为场景化人话文案，无「判重键」黑话', () => {
    renderModal()
    // 点题句：说明唯一标识识别，而非「判重键」
    expect(
      screen.getByText(/文件里已有的资源（按 IP \/ 服务名等唯一标识识别）怎么处理/),
    ).toBeInTheDocument()
    // hint：场景化描述（首次建档 / 整体刷新），黑话零残留
    expect(screen.getByText(/已存在的行会报错跳过，不会改动现有数据（适合首次批量建档）/)).toBeInTheDocument()
    expect(screen.getByText(/已存在的行会用文件内容覆盖更新（适合整体刷新）/)).toBeInTheDocument()
    expect(screen.queryByText(/判重键/)).not.toBeInTheDocument()
  })

  it('warns and skips submit when no file selected', async () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: /开始导入/ }))
    await waitFor(() => expect(msg.warning).toHaveBeenCalledWith('请先选择要导入的 Excel 文件'))
    expect(importExcelMock).not.toHaveBeenCalled()
  })

  it('submits file with create_only mode via FormData API', async () => {
    importExcelMock.mockResolvedValue({ status: 'success', data: importResult() })
    renderModal()
    selectFile()
    // rc-upload 异步处理 beforeUpload，等待文件出现在列表中再提交
    await screen.findByText('hosts.xlsx')
    fireEvent.click(screen.getByRole('button', { name: /开始导入/ }))
    await waitFor(() =>
      expect(importExcelMock).toHaveBeenCalledWith('host', expect.any(File), 'create_only'),
    )
    expect(successMock).toHaveBeenCalled()
  })

  it('submits with upsert mode after switching mode radio', async () => {
    importExcelMock.mockResolvedValue({ status: 'success', data: importResult({ updated: 2 }) })
    renderModal()
    selectFile()
    await screen.findByText('hosts.xlsx')
    fireEvent.click(screen.getByRole('radio', { name: /新增或更新/ }))
    fireEvent.click(screen.getByRole('button', { name: /开始导入/ }))
    await waitFor(() =>
      expect(importExcelMock).toHaveBeenCalledWith('host', expect.any(File), 'upsert'),
    )
  })

  it('renders import result stats and error rows table', async () => {
    importExcelMock.mockResolvedValue({ status: 'success', data: importResult() })
    renderModal()
    selectFile()
    await screen.findByText('hosts.xlsx')
    fireEvent.click(screen.getByRole('button', { name: /开始导入/ }))
    // 统计：总数 / 成功 / 更新 / 失败（§5.16.3）
    expect(await screen.findByText('导入完成')).toBeInTheDocument()
    expect(screen.getByText('总数')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    // 错误行表：行号/字段/值/原因（§5.16.3；scroll.x 会额外渲染测宽表头，用 getAllByText 断言存在）
    expect(screen.getAllByText('行号').length).toBeGreaterThan(0)
    expect(screen.getAllByText('字段').length).toBeGreaterThan(0)
    expect(screen.getAllByText('原因').length).toBeGreaterThan(0)
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('instance_ip')).toBeInTheDocument()
    expect(screen.getByText('999.1.1.1')).toBeInTheDocument()
    expect(screen.getByText('IP 非法')).toBeInTheDocument()
    // 后端引导文案透传（未登记业务→维护业务字典，§5.16.1）
    expect(screen.getByText('未登记业务，请前往维护业务字典')).toBeInTheDocument()
  })

  it('renders actionable guidance for pending-registration errors (待登记清单，决策 97)', async () => {
    importExcelMock.mockResolvedValue({
      status: 'success',
      data: importResult({
        failed: 2,
        errors: [
          {
            row: 3,
            resource_category: 'host',
            field: 'biz_code',
            value: 'unk',
            reason: '业务 unk 未登记，请到「业务管理」页登记或在本文件「业务声明」sheet 补充后重新导入',
          },
          {
            row: 4,
            resource_category: 'application',
            field: 'app_code',
            value: 'unkapp',
            reason: '应用 unkapp 未登记，请到「应用管理」页登记或在本文件「应用声明」sheet 补充后重新导入',
          },
        ],
      }),
    })
    renderModal()
    selectFile()
    await screen.findByText('hosts.xlsx')
    fireEvent.click(screen.getByRole('button', { name: /开始导入/ }))
    // 待登记清单 reason 透传（前后端文案一致）+ 命中渲染 warning 高亮图标（可执行指引）
    expect(
      await screen.findByText(/业务 unk 未登记，请到「业务管理」页登记或在本文件「业务声明」sheet 补充后重新导入/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/应用 unkapp 未登记，请到「应用管理」页登记或在本文件「应用声明」sheet 补充后重新导入/),
    ).toBeInTheDocument()
    // @ant-design/icons 渲染 role=img aria-label=warning；两行均命中待登记清单
    expect(screen.getAllByRole('img', { name: 'warning' }).length).toBeGreaterThanOrEqual(2)
  })

  // 待登记清单四维度覆盖（业务/应用/平台/网域）与排除项护栏。
  // 判定依据是错误字段 field + reason 语义（不再靠 reason 里是否含「业务/应用」二字），
  // 因此平台/网域两类未登记同样命中 warning 高亮与可执行指引。
  const PENDING_HIT_CASES: { name: string; error: ImportError }[] = [
    {
      name: '业务未登记',
      error: {
        row: 2,
        resource_category: 'host',
        field: 'biz_code',
        value: 'legacy',
        reason: '业务 legacy 未登记且未在声明 sheet 声明，请在『业务管理』页登记，或在本文件『业务声明』sheet 补充后重新导入',
      },
    },
    {
      name: '应用未登记',
      error: {
        row: 3,
        resource_category: 'application',
        field: 'app_code',
        value: 'ghost-app',
        reason: '应用 ghost-app 未登记且未在声明 sheet 声明，请在『应用管理』页登记，或在本文件『应用声明』sheet 补充后重新导入',
      },
    },
    {
      name: '平台未登记',
      error: {
        row: 5,
        resource_category: 'application',
        field: 'platform_code',
        value: 'no-such-platform',
        reason: '平台 no-such-platform 未登记且未在声明 sheet 声明，请在『平台管理』页登记，或在本文件『平台声明』sheet 补充后重新导入',
      },
    },
    {
      name: '网域未登记',
      error: {
        row: 6,
        resource_category: 'host',
        field: 'network_domain_id',
        value: 'ghost',
        reason: '网域 ghost 未登记，请先到『系统设置 → 网域管理』登记后重新导入',
      },
    },
  ]

  const PENDING_MISS_CASES: { name: string; error: ImportError }[] = [
    {
      name: '应用已停用（引导启用，非待登记）',
      error: {
        row: 7,
        resource_category: 'application',
        field: 'app_code',
        value: 'old-app',
        reason: '应用 old-app 已停用，请在『应用管理』页启用后重新导入',
      },
    },
    {
      name: '平台已停用（引导启用，非待登记）',
      error: {
        row: 8,
        resource_category: 'application',
        field: 'platform_code',
        value: 'old-platform',
        reason: '平台 old-platform 已停用，请在『平台管理』页启用后重新导入',
      },
    },
    {
      name: '平台自洽校验失败（非待登记）',
      error: {
        row: 10,
        resource_category: 'application',
        field: 'platform_code',
        value: 'platform-b',
        reason: '平台 platform-b 不属于应用 app-a 的关联平台',
      },
    },
    {
      name: '普通字段错误（非待登记）',
      error: {
        row: 11,
        resource_category: 'host',
        field: 'instance_ip',
        value: '999.1.1.1',
        reason: 'IP 非法',
      },
    },
  ]

  /** 提交一次导入并返回结果态 DOM，errors 为本次导入的错误行 */
  async function submitWithErrors(errors: ImportError[]) {
    importExcelMock.mockResolvedValue({
      status: 'success',
      data: importResult({ total: errors.length, success: 0, updated: 0, failed: errors.length, errors }),
    })
    renderModal()
    selectFile()
    await screen.findByText('hosts.xlsx')
    fireEvent.click(screen.getByRole('button', { name: /开始导入/ }))
    await screen.findByText('导入完成')
  }

  it.each(PENDING_HIT_CASES)('待登记清单高亮：$name', async ({ error }) => {
    await submitWithErrors([error])
    expect(screen.getByText(error.reason)).toBeInTheDocument()
    // 命中待登记清单：warning 图标 + warning 高亮（可执行指引）
    expect(screen.getAllByRole('img', { name: 'warning' }).length).toBe(1)
  })

  it.each(PENDING_MISS_CASES)('非待登记（普通错误行）：$name', async ({ error }) => {
    await submitWithErrors([error])
    expect(screen.getByText(error.reason)).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'warning' })).toBeNull()
  })

  it('field 缺失/为空时回退 reason 语义兜底判定', async () => {
    // field 为空串（后端整批拒绝类错误可能无字段）→ 仍需按 reason 语义命中
    await submitWithErrors([
      {
        row: 2,
        resource_category: 'host',
        field: '',
        value: 'legacy',
        reason: '业务 legacy 未登记且未在声明 sheet 声明，请在『业务管理』页登记，或在本文件『业务声明』sheet 补充后重新导入',
      },
    ])
    expect(screen.getAllByRole('img', { name: 'warning' }).length).toBe(1)
  })

  it('field 缺失且 reason 为已停用 / 平台自洽文案时不命中（兜底路径同样守排除项）', async () => {
    await submitWithErrors([
      {
        row: 2,
        resource_category: 'application',
        field: '',
        value: 'old-app',
        reason: '应用 old-app 已停用，请在『应用管理』页启用后重新导入',
      },
      {
        row: 3,
        resource_category: 'application',
        field: '',
        value: 'platform-b',
        reason: '平台 platform-b 不属于应用 app-a 的关联平台',
      },
    ])
    expect(screen.queryByRole('img', { name: 'warning' })).toBeNull()
  })

  it('shows submit error Alert with backend guidance text', async () => {
    importExcelMock.mockRejectedValue(new Error('网域未登记，请先前往网域管理入口登记'))
    renderModal()
    selectFile()
    await screen.findByText('hosts.xlsx')
    fireEvent.click(screen.getByRole('button', { name: /开始导入/ }))
    expect(await screen.findByText('导入失败')).toBeInTheDocument()
    expect(screen.getByText('网域未登记，请先前往网域管理入口登记')).toBeInTheDocument()
    expect(successMock).not.toHaveBeenCalled()
  })

  it('resets to form state when clicking again-import', async () => {
    importExcelMock.mockResolvedValue({ status: 'success', data: importResult() })
    renderModal()
    selectFile()
    await screen.findByText('hosts.xlsx')
    fireEvent.click(screen.getByRole('button', { name: /开始导入/ }))
    await screen.findByText('导入完成')
    fireEvent.click(screen.getByRole('button', { name: /再次导入/ }))
    expect(screen.queryByText('导入完成')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /开始导入/ })).toBeInTheDocument()
  })
})

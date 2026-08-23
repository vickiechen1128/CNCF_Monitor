import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { message } from 'antd'
import { ImportModal } from './ImportModal'
import type { ImportResult, ResourceCategory } from '../../types/resource'

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
  beforeEach(() => {
    templateMock.mockReset()
    importExcelMock.mockReset()
    cancelMock.mockReset()
    successMock.mockReset()
    // jsdom 未实现 createObjectURL / revokeObjectURL，桩掉以完成浏览器下载触发
    URL.createObjectURL = vi.fn(() => 'blob:mock')
    URL.revokeObjectURL = vi.fn()
    // 静默 antd 静态 message，避免测试输出噪音与 act 告警
    vi.spyOn(message, 'success').mockImplementation(() => undefined)
    vi.spyOn(message, 'warning').mockImplementation(() => undefined)
    vi.spyOn(message, 'error').mockImplementation(() => undefined)
  })

  it('downloads xlsx template for the current resource type', async () => {
    templateMock.mockResolvedValue(new Blob(['xlsx'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: /下载模板/ }))
    await waitFor(() => expect(templateMock).toHaveBeenCalledWith('host'))
    expect(URL.createObjectURL).toHaveBeenCalled()
  })

  it('downloads template linked to the active tab category (database)', async () => {
    templateMock.mockResolvedValue(new Blob(['xlsx']))
    renderModal({ category: 'database' })
    fireEvent.click(screen.getByRole('button', { name: /下载模板/ }))
    await waitFor(() => expect(templateMock).toHaveBeenCalledWith('database'))
  })

  it('renders mode options with create_only selected by default', () => {
    renderModal()
    expect(screen.getByRole('radio', { name: /仅新增/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /新增或更新/ })).not.toBeChecked()
  })

  it('warns and skips submit when no file selected', async () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: /开始导入/ }))
    await waitFor(() => expect(message.warning).toHaveBeenCalledWith('请先选择要导入的 Excel 文件'))
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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ImportRecordsPanel } from './ImportRecordsPanel'
import type { ImportRecord } from '../../types/resource'

const listMock = vi.fn()
const getMock = vi.fn()

vi.mock('../../api/resources', () => ({
  importApi: {
    list: (...args: unknown[]) => listMock(...args),
    get: (...args: unknown[]) => getMock(...args),
  },
}))

const downloadMock = vi.fn()
const uploadMock = vi.fn()

function recordItem(id: number, over: Partial<ImportRecord> = {}): ImportRecord {
  return {
    id,
    import_no: `IMP2026082100${id}`,
    resource_category: 'host',
    mode: 'create_only',
    total: 10,
    success: 9,
    updated: 0,
    failed: 1,
    status: 'partial',
    errors: [{ row: 3, resource_category: 'host', field: 'instance_ip', value: '999.1.1.1', reason: 'IP 非法' }],
    operator: 'chenrt',
    created_at: '2026-08-21T10:00:00Z',
    ...over,
  }
}

function listPage(records: ImportRecord[], total?: number, page = 1, page_size = 20) {
  return {
    status: 'success',
    data: { list: records, total: total ?? records.length, page, page_size },
  }
}

function renderPanel() {
  return render(<ImportRecordsPanel onDownloadTemplate={downloadMock} onUploadExcel={uploadMock} />)
}

describe('ImportRecordsPanel', () => {
  beforeEach(() => {
    listMock.mockReset()
    getMock.mockReset()
    downloadMock.mockReset()
    uploadMock.mockReset()
    listMock.mockResolvedValue(listPage([]))
  })

  it('loads records on mount with default page/page_size', async () => {
    renderPanel()
    await waitFor(() => expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ page: 1, page_size: 20 })))
  })

  it('renders record rows with category / mode / stats / status', async () => {
    listMock.mockResolvedValue(listPage([recordItem(1)]))
    renderPanel()
    // 主列表不含导入编号列，以导入时间作为行锚点
    expect(await screen.findByText('2026-08-21T10:00:00Z')).toBeInTheDocument()
    expect(screen.getByText('主机')).toBeInTheDocument()
    expect(screen.getByText('仅新增')).toBeInTheDocument()
    expect(screen.getByText('部分成功')).toBeInTheDocument()
    // 成功 / 失败列（在行内定位，避免与分页数字冲突）
    const row = screen.getByText('2026-08-21T10:00:00Z').closest('tr')!
    expect(within(row).getByText('9')).toBeInTheDocument()
    expect(within(row).getByText('1')).toBeInTheDocument()
  })

  it('filters list by resource_category', async () => {
    renderPanel()
    await screen.findByText('暂无导入记录')
    fireEvent.mouseDown(screen.getAllByRole('combobox')[0])
    fireEvent.click(await screen.findByText('数据库'))
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ resource_category: 'database' })),
    )
  })

  it('filters list by status', async () => {
    renderPanel()
    await screen.findByText('暂无导入记录')
    fireEvent.mouseDown(screen.getAllByRole('combobox')[1])
    fireEvent.click(await screen.findByText('部分成功'))
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'partial' })))
  })

  it('paginates to the next page', async () => {
    listMock.mockResolvedValue(listPage([recordItem(1)], 25))
    renderPanel()
    await screen.findByText('2026-08-21T10:00:00Z')
    fireEvent.click(document.querySelector('.ant-pagination-item-2') as HTMLElement)
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })))
  })

  it('shows empty state with download template / upload excel guidance', async () => {
    renderPanel()
    expect(await screen.findByText('暂无导入记录')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /下载模板/ }))
    expect(downloadMock).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /上传 Excel/ }))
    expect(uploadMock).toHaveBeenCalled()
  })

  it('shows error Alert and reload retries the list', async () => {
    listMock.mockRejectedValue(new Error('boom'))
    renderPanel()
    expect(await screen.findByText('导入记录加载失败，请稍后重试')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重新加载/ }))
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
  })

  it('opens detail via importApi.get and renders errors table', async () => {
    listMock.mockResolvedValue(listPage([recordItem(1)]))
    getMock.mockResolvedValue({
      status: 'success',
      data: recordItem(1, {
        errors: [
          { row: 3, resource_category: 'host', field: 'instance_ip', value: '999.1.1.1', reason: 'IP 非法' },
          { row: 5, resource_category: 'host', field: 'biz_code', value: 'unk', reason: '未登记业务，请前往维护业务字典' },
        ],
      }),
    })
    renderPanel()
    await screen.findByText('2026-08-21T10:00:00Z')
    fireEvent.click(screen.getByRole('button', { name: /查看/ }))
    await waitFor(() => expect(getMock).toHaveBeenCalledWith(1))
    expect(await screen.findByText('导入详情 - IMP20260821001')).toBeInTheDocument()
    expect(screen.getByText('IP 非法')).toBeInTheDocument()
    expect(screen.getByText('未登记业务，请前往维护业务字典')).toBeInTheDocument()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LabelTemplatesPage } from './LabelTemplatesPage'
import type { LabelTemplateListItem } from '../../types/label'

const listMock = vi.fn()
const createMock = vi.fn()
const cloneMock = vi.fn()
const removeMock = vi.fn()

vi.mock('../../api/labelTemplates', () => ({
  labelTemplateApi: {
    list: (...args: unknown[]) => listMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    clone: (...args: unknown[]) => cloneMock(...args),
    remove: (...args: unknown[]) => removeMock(...args),
  },
}))

/** 模板列表 item 构造器（对齐 LabelTemplateListItem） */
function templateItem(id: number, name: string, extra: Partial<LabelTemplateListItem> = {}): LabelTemplateListItem {
  return {
    id,
    name,
    resource_category: 'host',
    is_default: false,
    mappings: [],
    instance_count: 0,
    created_at: '2026-08-21T00:00:00Z',
    updated_at: '2026-08-21T00:00:00Z',
    ...extra,
  }
}

function emptyPage() {
  return { status: 'success', data: { list: [] as LabelTemplateListItem[], total: 0, page: 1, page_size: 50 } }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <LabelTemplatesPage />
    </MemoryRouter>,
  )
}

describe('LabelTemplatesPage', () => {
  beforeEach(() => {
    listMock.mockReset()
    createMock.mockReset()
    cloneMock.mockReset()
    removeMock.mockReset()
    listMock.mockResolvedValue(emptyPage())
    createMock.mockResolvedValue({ status: 'success', data: templateItem(10, '新模板') })
    cloneMock.mockResolvedValue({ status: 'success', data: templateItem(11, '克隆') })
    removeMock.mockResolvedValue({ status: 'success', data: null })
  })

  it('shows loading skeleton while fetching', () => {
    let resolve!: (v: unknown) => void
    listMock.mockReturnValue(new Promise((r) => (resolve = r)))
    const { container } = renderPage()
    expect(container.querySelector('.ant-skeleton')).toBeTruthy()
    resolve(emptyPage())
  })

  it('loads host list with default page and page size 50', async () => {
    renderPage()
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({ resource_category: 'host', page: 1, page_size: 50 }),
      ),
    )
  })

  it('renders template cards with tag / mapping count / instance badge', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          templateItem(1, '主机默认模板', { is_default: true, mappings: [] as never, instance_count: 3 }),
          templateItem(2, '支付自定义模板', {
            mappings: [
              { source_field: 'app_name', source_type: 'resource_field', target_label: 'app', enabled: true },
              { source_field: 'env', source_type: 'resource_field', target_label: 'env', enabled: true },
            ] as LabelTemplateListItem['mappings'],
            instance_count: 5,
          }),
        ],
        total: 2,
        page: 1,
        page_size: 50,
      },
    })
    renderPage()
    expect(await screen.findByText('主机默认模板')).toBeInTheDocument()
    expect(screen.getByText('支付自定义模板')).toBeInTheDocument()
    // 默认模板显示「默认」Tag，自定义模板显示「自定义」Tag
    expect(screen.getByText('默认')).toBeInTheDocument()
    expect(screen.getAllByText('自定义').length).toBeGreaterThanOrEqual(1)
    // 映射数与关联实例数 badge 文本
    expect(screen.getByText('2 条映射')).toBeInTheDocument()
    expect(screen.getByText('关联实例 3')).toBeInTheDocument()
    expect(screen.getByText('关联实例 5')).toBeInTheDocument()
  })

  it('renders empty state with 暂无标签模板 and 新建模板 guidance', async () => {
    renderPage()
    expect(await screen.findByText('暂无标签模板')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /新建模板/ })).toBeInTheDocument()
  })

  it('renders error Alert and reload button triggers reload', async () => {
    listMock.mockRejectedValue(new Error('boom'))
    renderPage()
    expect(await screen.findByText('模板列表加载失败，请稍后重试')).toBeInTheDocument()
    const reloadBtn = await screen.findByRole('button', { name: /重新加载/ })
    fireEvent.click(reloadBtn)
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
  })

  it('switches tab and calls list with new resource_category', async () => {
    renderPage()
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ resource_category: 'host' })),
    )
    fireEvent.click(screen.getByText('数据库'))
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ resource_category: 'database' })),
    )
  })

  it('sends keyword to list on search', async () => {
    renderPage()
    await screen.findByText('暂无标签模板')
    const search = screen.getByPlaceholderText('搜索模板名称')
    fireEvent.change(search, { target: { value: 'web' } })
    fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: 'web' })))
  })

  it('filters default templates with is_default=true', async () => {
    renderPage()
    await screen.findByText('暂无标签模板')
    fireEvent.mouseDown(screen.getByText('全部模板'))
    fireEvent.click(await screen.findByText('默认模板'))
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ is_default: true })))
  })

  it('creates template via drawer and reloads list', async () => {
    renderPage()
    await screen.findByText('暂无标签模板')
    fireEvent.click(screen.getByRole('button', { name: /新增模板/ }))
    const nameInput = await screen.findByPlaceholderText('如 主机默认模板')
    fireEvent.change(nameInput, { target: { value: '新模板' } })
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
    await waitFor(() => expect(createMock).toHaveBeenCalledWith({ name: '新模板', resource_category: 'host' }))
    // 创建成功后触发列表重新加载
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
  })

  it('clones a template via clone API', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [templateItem(1, '主机默认模板')], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByText('主机默认模板')
    fireEvent.click(screen.getByRole('button', { name: /克隆/ }))
    const dialog = await screen.findByRole('dialog')
    const nameInput = within(dialog).getByPlaceholderText('请输入模板名称')
    fireEvent.change(nameInput, { target: { value: '主机自用模板' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /克\s*隆/ }))
    await waitFor(() => expect(cloneMock).toHaveBeenCalledWith(1, { name: '主机自用模板' }))
  })

  it('deletes custom template after modal confirm', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [templateItem(2, '支付自定义模板')], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByText('支付自定义模板')
    fireEvent.click(screen.getByRole('button', { name: /删\s*除/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/确认删除模板「支付自定义模板」/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: /删\s*除/ }))
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith(2))
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
  })

  it('disables delete for default template with tooltip hint', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [templateItem(1, '主机默认模板', { is_default: true })], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByText('主机默认模板')
    const deleteBtn = screen.getByRole('button', { name: /删\s*除/ })
    expect(deleteBtn).toBeDisabled()
    // 悬浮展示「默认模板禁止删除」提示（React 合成 onMouseEnter 由 mouseover 模拟）
    fireEvent.mouseOver(deleteBtn)
    expect(await screen.findByText('默认模板禁止删除')).toBeInTheDocument()
    expect(removeMock).not.toHaveBeenCalled()
  })
})

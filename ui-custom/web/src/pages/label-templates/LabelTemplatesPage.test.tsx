import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LabelTemplatesPage } from './LabelTemplatesPage'
import type { LabelTemplateListItem } from '../../types/label'

const listMock = vi.fn()
const createMock = vi.fn()
const cloneMock = vi.fn()
const removeMock = vi.fn()
const setDefaultMock = vi.fn()

vi.mock('../../api/labelTemplates', () => ({
  labelTemplateApi: {
    list: (...args: unknown[]) => listMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    clone: (...args: unknown[]) => cloneMock(...args),
    remove: (...args: unknown[]) => removeMock(...args),
    setDefault: (...args: unknown[]) => setDefaultMock(...args),
  },
}))

/** 模板列表 item 构造器（对齐 v3 LabelTemplate：id 为 string，无 instance_count） */
function templateItem(id: string, name: string, extra: Partial<LabelTemplateListItem> = {}): LabelTemplateListItem {
  return {
    id,
    name,
    resource_category: 'host',
    is_default: false,
    mappings: [],
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
    setDefaultMock.mockReset()
    listMock.mockResolvedValue(emptyPage())
    createMock.mockResolvedValue({ status: 'success', data: templateItem('lt-10', '新模板') })
    cloneMock.mockResolvedValue({ status: 'success', data: templateItem('lt-11', '克隆') })
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

  it('renders template cards with tag / mapping count (v3 has no instance count)', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          templateItem('lt-1', '主机默认模板', {
            is_default: true,
            mappings: [] as never,
            resource_category: 'application',
          }),
          templateItem('lt-2', '支付自定义模板', {
            mappings: [
              { source_field: 'app_code', source_type: 'resource_field', target_label: 'app', enabled: true },
              { source_field: 'env', source_type: 'resource_field', target_label: 'env', enabled: true },
            ] as LabelTemplateListItem['mappings'],
            resource_category: 'application',
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
    // 映射数 badge 文本
    expect(screen.getByText('2 条映射')).toBeInTheDocument()
    // v3 模板不绑定资源实例：不再展示「关联实例」badge / 文案
    expect(screen.queryByText(/关联实例/)).not.toBeInTheDocument()
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

  it('clears selected template and leftover list when switching resource tab (F-35)', async () => {
    listMock.mockResolvedValueOnce({
      status: 'success',
      data: { list: [templateItem('lt-1', '主机默认模板')], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    // 点击主机模板 → 右栏展示该模板详情（映射明细 Tab）
    fireEvent.click(await screen.findByText('主机默认模板'))
    expect(await screen.findByRole('tab', { name: /映射明细/ })).toBeInTheDocument()

    // 切到中间件 tab → 右栏清空选中回到占位，不残留上一类别模板
    fireEvent.click(screen.getByText('中间件'))
    expect(await screen.findByText('请选择左侧模板查看详情')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /映射明细/ })).not.toBeInTheDocument()
    // 中间件 tab 下按新类别重新加载列表
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ resource_category: 'middleware' })),
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
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({ name: '新模板', resource_category: 'host', is_default: false }),
    )
    // 创建成功后触发列表重新加载
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
  })

  it('creates a template as the category default when the switch is on (v2.56)', async () => {
    renderPage()
    await screen.findByText('暂无标签模板')
    fireEvent.click(screen.getByRole('button', { name: /新增模板/ }))
    const nameInput = await screen.findByPlaceholderText('如 主机默认模板')
    fireEvent.change(nameInput, { target: { value: '主机默认模板' } })
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        name: '主机默认模板',
        resource_category: 'host',
        is_default: true,
      }),
    )
  })

  it('sets a custom template as default from the detail pane and refreshes the list (v2.56)', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [templateItem('lt-2', '支付自定义模板')], total: 1, page: 1, page_size: 50 },
    })
    setDefaultMock.mockResolvedValue({
      status: 'success',
      data: templateItem('lt-2', '支付自定义模板', { is_default: true }),
    })
    renderPage()
    fireEvent.click(await screen.findByText('支付自定义模板'))
    fireEvent.click(await screen.findByRole('button', { name: /设为默认/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /设为默认/ }))
    await waitFor(() => expect(setDefaultMock).toHaveBeenCalledWith('lt-2'))
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
  })

  it('clones a template via clone API', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [templateItem('lt-1', '主机默认模板')], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByText('主机默认模板')
    fireEvent.click(screen.getByRole('button', { name: /克隆/ }))
    const dialog = await screen.findByRole('dialog')
    const nameInput = within(dialog).getByPlaceholderText('请输入模板名称')
    fireEvent.change(nameInput, { target: { value: '主机自用模板' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /克\s*隆/ }))
    await waitFor(() => expect(cloneMock).toHaveBeenCalledWith('lt-1', { name: '主机自用模板' }))
  })

  it('deletes custom template after modal confirm', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [templateItem('lt-2', '支付自定义模板')], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByText('支付自定义模板')
    fireEvent.click(screen.getByRole('button', { name: /删\s*除/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/确认删除模板「支付自定义模板」/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: /删\s*除/ }))
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('lt-2'))
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
  })

  it('shows readable error when delete is blocked by M01 references (v3 409)', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [templateItem('lt-2', '支付自定义模板')], total: 1, page: 1, page_size: 50 },
    })
    // v3：模板被 M01 映射 / Job 引用时后端返回 409 conflict，页面需透出可读文案而不是静默失败
    removeMock.mockRejectedValue(new Error('label template "lt-2" is referenced by 2 M01 record(s)'))
    renderPage()
    await screen.findByText('支付自定义模板')
    fireEvent.click(screen.getByRole('button', { name: /删\s*除/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /删\s*除/ }))
    expect(await screen.findByText(/referenced by 2 M01 record/)).toBeInTheDocument()
    // 删除失败不刷新列表
    expect(listMock).toHaveBeenCalledTimes(1)
  })

  it('disables delete for default template with tooltip hint', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [templateItem('lt-1', '主机默认模板', { is_default: true })], total: 1, page: 1, page_size: 50 },
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

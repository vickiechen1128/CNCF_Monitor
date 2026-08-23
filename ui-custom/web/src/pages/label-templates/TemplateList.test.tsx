import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import TemplateList from './TemplateList'
import type { LabelTemplateListItem } from '../../types/label'

const listMock = vi.fn()
const cloneMock = vi.fn()
const removeMock = vi.fn()

vi.mock('../../api/labelTemplates', () => ({
  labelTemplateApi: {
    list: (...args: unknown[]) => listMock(...args),
    clone: (...args: unknown[]) => cloneMock(...args),
    remove: (...args: unknown[]) => removeMock(...args),
  },
}))

function item(id: number, name: string, extra: Partial<LabelTemplateListItem> = {}): LabelTemplateListItem {
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

function page(items: LabelTemplateListItem[]) {
  return { status: 'success', data: { list: items, total: items.length, page: 1, page_size: 50 } }
}

function renderList(over: { selectedId?: number } = {}) {
  const onSelect = vi.fn()
  render(
    <TemplateList
      activeType="host"
      reloadKey={0}
      onCreate={vi.fn()}
      selectedId={over.selectedId}
      onSelect={onSelect}
    />,
  )
  return { onSelect }
}

describe('TemplateList selection (T07-F8)', () => {
  beforeEach(() => {
    listMock.mockReset()
    cloneMock.mockReset()
    removeMock.mockReset()
    listMock.mockResolvedValue(page([]))
  })

  it('calls onSelect with the template when a card is clicked', async () => {
    listMock.mockResolvedValue(page([item(1, '主机模板'), item(2, '支付模板')]))
    const { onSelect } = renderList()
    fireEvent.click(await screen.findByText('主机模板'))
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 1, name: '主机模板' })))
  })

  it('highlights the selected template card by selectedId', async () => {
    listMock.mockResolvedValue(page([item(1, '主机模板'), item(2, '支付模板')]))
    renderList({ selectedId: 1 })
    const selected = (await screen.findByText('主机模板')).closest('.ant-list-item')!
    expect(selected).toHaveStyle({ background: '#E6FAFD' })
    const other = screen.getByText('支付模板').closest('.ant-list-item')!
    expect(other).not.toHaveStyle({ background: '#E6FAFD' })
  })

  it('does not trigger onSelect when clicking 克隆 button', async () => {
    listMock.mockResolvedValue(page([item(1, '主机模板')]))
    cloneMock.mockResolvedValue({ status: 'success', data: item(11, '克隆') })
    const { onSelect } = renderList()
    fireEvent.click(await screen.findByRole('button', { name: /克隆/ }))
    await waitFor(() => expect(cloneMock).toHaveBeenCalledWith(1))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('does not trigger onSelect when opening delete confirm', async () => {
    listMock.mockResolvedValue(page([item(2, '支付模板')]))
    const { onSelect } = renderList()
    fireEvent.click(await screen.findByRole('button', { name: /删\s*除/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/确认删除模板「支付模板」/)).toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
  })
})

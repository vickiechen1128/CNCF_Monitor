import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ResizableHeaderCell } from './ResizableHeaderCell'

/**
 * `react-resizable` 的拖拽链路在 jsdom 里的最小验证：
 * mousedown 手柄 → document mousemove → mouseup，断言宽度回调与边界夹紧。
 */
function renderCell(width: number) {
  const onColumnResize = vi.fn()
  render(
    <table>
      <thead>
        <tr>
          <ResizableHeaderCell width={width} onColumnResize={onColumnResize}>
            实例名
          </ResizableHeaderCell>
        </tr>
      </thead>
      <tbody />
    </table>,
  )
  const th = screen.getByRole('columnheader')
  const handle = within(th).getByTestId('column-resize-handle')
  return { onColumnResize, th, handle }
}

describe('ResizableHeaderCell', () => {
  it('向右拖动 60px：列宽从 180 变为 240，并在 mouseup 后落定最终值', async () => {
    const { onColumnResize, handle } = renderCell(180)
    fireEvent.mouseDown(handle, { clientX: 100, clientY: 10, button: 0 })
    fireEvent.mouseMove(document, { clientX: 160, clientY: 10 })

    await waitFor(() => expect(onColumnResize).toHaveBeenCalled())
    await waitFor(() => expect(onColumnResize).toHaveBeenLastCalledWith(240))

    fireEvent.mouseUp(document, { clientX: 160, clientY: 10 })
    expect(onColumnResize).toHaveBeenLastCalledWith(240)
  })

  it('向左拖过下限时夹紧到 60px', async () => {
    const { onColumnResize, handle } = renderCell(180)
    fireEvent.mouseDown(handle, { clientX: 100, clientY: 10, button: 0 })
    fireEvent.mouseMove(document, { clientX: -500, clientY: 10 })

    await waitFor(() => expect(onColumnResize).toHaveBeenLastCalledWith(60))
    fireEvent.mouseUp(document, { clientX: -500, clientY: 10 })
  })

  it('开始拖拽时清掉已有文字选区（避免浏览器把表头文字当成原生拖放）', () => {
    const { handle } = renderCell(180)
    const selection = document.createElement('span')
    selection.textContent = '表头文字'
    document.body.appendChild(selection)
    const range = document.createRange()
    range.selectNodeContents(selection)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)

    fireEvent.mouseDown(handle, { clientX: 100, clientY: 10, button: 0 })

    expect(window.getSelection()?.rangeCount).toBe(0)
    document.body.removeChild(selection)
    fireEvent.mouseUp(document)
  })
})

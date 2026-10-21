import { useEffect, useRef, useState } from 'react'
import type { HTMLAttributes, SyntheticEvent } from 'react'
import { theme } from 'antd'
import { Resizable } from 'react-resizable'
import type { ResizeCallbackData } from 'react-resizable'
import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from './tablePresets'

export interface ResizableHeaderCellProps extends HTMLAttributes<HTMLTableCellElement> {
  /** 当前列宽（px），由列定义的 `onHeaderCell` 注入 */
  width?: number
  /** 拖动过程中实时回调（宽度只存页面内存态，不落库） */
  onColumnResize?: (width: number) => void
}

/**
 * 可拖动列宽的表头单元格。
 *
 * 采用 AntD 官方 resizable-column demo 的 `react-resizable` 方案：
 * - 库负责鼠标/触摸拖拽、边界约束、拖拽期间的用户选择抑制；
 * - 本组件只负责把 `<th>` 包进 `<Resizable>`，并把宽度回调给页面；
 * - 手柄用自绘细线（不引入库的默认样式文件），视觉效果与表头一体。
 *
 * 与 antd 固定列的兼容：`fixed` 列的 th 由 rc-table 注入 `position: sticky`，
 * 这里**保留原 position**，否则固定列会失去吸顶效果。
 * `react-resizable` 4.x 用 `nodeRef` 挂拖拽事件，不依赖已废弃的 `findDOMNode`。
 */
export function ResizableHeaderCell({
  width,
  onColumnResize,
  children,
  style,
  ...rest
}: ResizableHeaderCellProps) {
  const { token } = theme.useToken()
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)
  // mousemove 会以远高于 60Hz 的频率触发；用 rAF 合并成每帧一次，
  // 避免整张表在每次 mousemove 都重渲染（用户反馈「拖起来卡」）。
  const rafRef = useRef<number | null>(null)
  const pendingWidthRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (rafRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafRef.current)
      }
    },
    [],
  )

  // 无宽度的列（如未来的分组表头）不启用拖拽，原样渲染
  if (typeof width !== 'number') {
    return (
      <th {...rest} style={style}>
        {children}
      </th>
    )
  }

  const flushWidth = () => {
    rafRef.current = null
    const next = pendingWidthRef.current
    pendingWidthRef.current = null
    if (next !== null) onColumnResize?.(next)
  }

  const handleResize = (_event: SyntheticEvent, { size }: ResizeCallbackData) => {
    pendingWidthRef.current = Math.round(size.width)
    if (typeof requestAnimationFrame !== 'function') {
      flushWidth()
      return
    }
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(flushWidth)
  }

  const handleResizeStop = (_event: SyntheticEvent, { size }: ResizeCallbackData) => {
    setDragging(false)
    if (rafRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    pendingWidthRef.current = null
    // 最后一帧的宽度必须落定：rAF 可能还没执行就被 mouseup 取消
    onColumnResize?.(Math.round(size.width))
  }

  const clearTextSelection = () => {
    // 关键：拖拽前清掉已有的文字选区。否则浏览器会把「拖动选中的表头文字」
    // 当成原生拖放，出现禁止光标，且 mouseup 被原生拖放吞掉 → 松手不停。
    window.getSelection()?.removeAllRanges()
  }

  const active = dragging || hovered
  // fixed 列由 rc-table 注入 position: sticky，不能被 relative 覆盖
  const position = style?.position && style.position !== 'static' ? style.position : 'relative'

  return (
    <Resizable
      width={width}
      height={0}
      axis="x"
      resizeHandles={['e']}
      minConstraints={[MIN_COLUMN_WIDTH, 0]}
      maxConstraints={[MAX_COLUMN_WIDTH, 0]}
      draggableOpts={{ enableUserSelectHack: true }}
      onResize={handleResize}
      onResizeStart={() => {
        clearTextSelection()
        setDragging(true)
      }}
      onResizeStop={handleResizeStop}
      handle={
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整列宽"
          title="拖动调整列宽"
          data-testid="column-resize-handle"
          onMouseDownCapture={clearTextSelection}
          onDragStart={(event) => event.preventDefault()}
          onClick={(event) => event.stopPropagation()}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            position: 'absolute',
            top: 0,
            right: -4,
            bottom: 0,
            width: 8,
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'col-resize',
            touchAction: 'none',
          }}
        >
          <span
            aria-hidden
            style={{
              width: 1,
              height: '60%',
              borderRadius: 1,
              background: dragging ? token.colorPrimary : hovered ? token.colorPrimaryBorder : token.colorSplit,
              opacity: active ? 1 : 0.5,
              transition: 'background-color 0.15s, opacity 0.15s',
            }}
          />
        </span>
      }
    >
      <th
        {...rest}
        style={{ ...style, width, position, userSelect: 'none' }}
        // 表头文字禁止原生拖放：否则会触发浏览器 DnD 的禁止光标并吞掉 mouseup
        onDragStart={(event) => event.preventDefault()}
      >
        {children}
      </th>
    </Resizable>
  )
}

import { useEffect, useRef, useState } from 'react'
import type { HTMLAttributes, RefObject } from 'react'
import type { ColumnsType } from 'antd/es/table'
import type { ResourceCategory } from '../../types/resource'
import type { ResourceListItem } from './useResources'
import {
  RESOURCE_COLUMN_META,
  defaultColumnWidth,
  loadVisibleColumnKeys,
  orderColumnKeys,
  resetVisibleColumnKeys,
  saveVisibleColumnKeys,
} from './resourceColumnPrefs'
import type { ResourceColumnWidths } from './resourceColumnPrefs'
import { RESOURCE_TYPES } from './resourceMeta'

export interface UseResourceColumnPrefsResult {
  /** 当前 Tab 的已选列 key（供「列设置」Checkbox.Group 受控值） */
  visibleColumnKeys: string[]
  /** 按可见 key 过滤后的列定义（尚未注入列宽 / 拖动表头） */
  visibleColumns: ColumnsType<ResourceListItem>
  /** 注入确定宽度与可拖动表头后的最终列定义（传 Table.columns） */
  resizableColumns: ColumnsType<ResourceListItem>
  /** Table.scroll.x = max(可见列宽之和, 容器实测宽, 600) */
  tableScrollX: number
  /** 表格容器引用（供外层 div 挂载，ResizeObserver 实测容器宽度） */
  tableContainerRef: RefObject<HTMLDivElement>
  /** 「列设置」浮层受控展开状态（连续勾选多列期间保持展开，H-1） */
  columnSettingsOpen: boolean
  setColumnSettingsOpen: (open: boolean) => void
  /** 「列设置」入口按钮文案：当前 Tab 已选列数 / 全量列数 */
  columnSettingsLabel: string
  /** 勾选变更 → 归一化（并入固定列）→ 更新状态 + 按 Tab 分区落库 */
  handleVisibleColumnKeysChange: (next: string[]) => void
  /** 恢复当前 Tab 的默认列集（落库路径与勾选变更一致） */
  handleResetColumnKeys: () => void
}

/**
 * 资源列表列偏好 / 列宽 Hook（F-17 + 列宽拖动）。
 *
 * 从 `ResourcesPage.tsx` 原样迁出（T07-R4，行为等价），收敛以下纯前端视图态：
 * 1. **列显隐偏好**：按 `resource_category` 分区存 localStorage，初值一次性读出；
 *    切 Tab 只换读取对象、不重新读盘，实现「切换 Tab 各自恢复」；
 * 2. **列宽**：纯前端会话态（按 Tab 分区保存在内存），不落 localStorage、刷新恢复默认；
 * 3. **容器宽度**：ResizeObserver 实测；缺失时回落 `window.resize` 监听；
 * 4. **可拖动表头**：为每列注入确定宽度 + `onHeaderCell`（固定布局下避免列漂移）；
 * 5. **「列设置」浮层**：受控展开状态 + 一键恢复默认列集。
 *
 * 列定义由调用方每次渲染传入（`buildResourceColumns` 捕获字典 / coverage / 皮肤 token
 * 等异步数据，不能在 Hook 内记忆化），本 Hook 只负责按可见 key 过滤与注入宽度。
 */
export function useResourceColumnPrefs(
  category: ResourceCategory,
  columns: ColumnsType<ResourceListItem>,
): UseResourceColumnPrefsResult {
  /**
   * F-17「列设置」：按 `resource_category` 分区的可见列偏好（纯前端视图态，不上传后端）。
   *
   * 五类 Tab 各自一份，初值一次性从 localStorage 读出（`loadVisibleColumnKeys` 内部对
   * 不可用 / 脏数据静默回退默认列集）；切 Tab 只换读取对象，不重新读盘。
   */
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<Record<ResourceCategory, string[]>>(() => {
    const init = {} as Record<ResourceCategory, string[]>
    for (const t of RESOURCE_TYPES) init[t] = loadVisibleColumnKeys(t)
    return init
  })

  /**
   * 列宽（拖动表头调整）：**纯前端会话态**，按 `resource_category` 分区保存在内存中。
   * 不落 localStorage、不上传后端，刷新页面即恢复默认；未拖过的列不在对象里，
   * 渲染时回落 `buildResourceColumns` 的 width 或 `defaultColumnWidth`。
   */
  const [columnWidths, setColumnWidths] = useState<Record<ResourceCategory, ResourceColumnWidths>>(() => {
    const init = {} as Record<ResourceCategory, ResourceColumnWidths>
    for (const t of RESOURCE_TYPES) init[t] = {}
    return init
  })

  /**
   * 表格容器实测宽度：列宽改为固定布局后，`scroll.x` 取「所有可见列宽之和」与
   * 「容器宽度」的较大值——列少时表格仍铺满容器，列多时出现横向滚动条。
   * jsdom 无 ResizeObserver / getBoundingClientRect 返回 0 时回落为列宽之和。
   */
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const [tableContainerWidth, setTableContainerWidth] = useState(0)
  useEffect(() => {
    const el = tableContainerRef.current
    if (!el) return
    const update = () => setTableContainerWidth(el.getBoundingClientRect().width)
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  /**
   * F-17：「列设置」浮层展开状态（**受控**，H-1）。
   *
   * 不受控时依赖 `rc-dropdown` 内部对 `popupRender` 路径的短路才恰好不关闭，
   * 属赌 antd 内部实现；显式受控后行为确定，连勾多列不会被迫反复展开。
   */
  const [columnSettingsOpen, setColumnSettingsOpen] = useState(false)

  /**
   * F-17：当前 Tab 实际渲染的列 = 传入列定义按可见 key 过滤。
   *
   * 固定列（主标识 `fixed:'left'` / 操作 `fixed:'right'`）由 `orderColumnKeys` 强制并入，
   * 即便偏好数据异常也不会把固定列挤出表头——sticky 结论不依赖用户偏好。
   *
   * 不做 `useMemo`：列工厂捕获字典 / coverage / skin token 等异步数据，
   * 记忆化会把这些依赖冻在首帧（采集状态、云 / 应用名等渲染不更新）。
   * 代价仅是每次渲染重建十几列定义，与改前 `columns={buildColumns(category)}` 的开销同量级。
   *
   * 但 Set 本身在渲染体内构建一次复用（frontend-reviewer M-3）——它无副作用、不捕获异步数据，
   * 与「不要给列工厂加 useMemo」是两回事。
   */
  const visibleColumnKeySet = new Set(visibleColumnKeys[category])
  const visibleColumns = columns.filter((c) => visibleColumnKeySet.has(String(c.key)))

  /** 列宽解析：用户拖过的宽度 → `buildResourceColumns` 的列级 width → 默认宽度表 */
  const columnWidthOf = (key: string, columnWidth?: number | string): number => {
    const persisted = columnWidths[category][key]
    if (typeof persisted === 'number') return persisted
    if (typeof columnWidth === 'number') return columnWidth
    return defaultColumnWidth(key)
  }

  /** 拖动列宽：只更新当前 Tab 的内存态（不落库，刷新即恢复默认） */
  const handleColumnResize = (key: string, width: number) => {
    setColumnWidths((prev) => ({
      ...prev,
      [category]: { ...prev[category], [key]: width },
    }))
  }

  /**
   * 注入可拖动表头。每列都必须有确定的 width：固定布局（`scroll.x` 为数字）下
   * 无 width 的列会被浏览器按内容重新分配，拖动其他列时该列会跟着漂移。
   */
  const resizableColumns = visibleColumns.map((column) => {
    const key = String(column.key)
    const width = columnWidthOf(key, column.width)
    return {
      ...column,
      width,
      onHeaderCell: () =>
        ({
          width,
          'data-column-key': key,
          onColumnResize: (next: number) => handleColumnResize(key, next),
        }) as unknown as HTMLAttributes<HTMLTableCellElement>,
    }
  })

  /**
   * 表格总宽 = 可见列宽之和与容器宽度取大：
   * - 列少 → 铺满容器（固定布局会把富余宽度按比例分给各列）；
   * - 列多 → 出现横向滚动条，固定列 sticky 照常生效。
   */
  const totalColumnWidth = resizableColumns.reduce(
    (sum, column) => sum + (typeof column.width === 'number' ? column.width : 0),
    0,
  )
  const tableScrollX = Math.max(totalColumnWidth, Math.round(tableContainerWidth), 600)

  /** F-17：列设置勾选变更 → 归一化（并入固定列）→ 更新状态 + 按 Tab 分区落库 */
  const handleVisibleColumnKeysChange = (next: string[]) => {
    const normalized = orderColumnKeys(category, next)
    setVisibleColumnKeys((prev) => ({ ...prev, [category]: normalized }))
    saveVisibleColumnKeys(category, normalized)
  }

  /**
   * F-17 附加：恢复当前 Tab 的默认列集。
   *
   * 用户把列取消到极简后，若无此入口只能手动逐个勾回 P0 高频列（host / generic_target
   * 各需勾 5 次）。落库路径与 `handleVisibleColumnKeysChange` 一致（复用归一化 + 分区存储），
   * 故恢复后刷新与切 Tab 均可正确恢复。
   */
  const handleResetColumnKeys = () => {
    const defaults = resetVisibleColumnKeys(category)
    setVisibleColumnKeys((prev) => ({ ...prev, [category]: defaults }))
  }

  /** 「列设置」入口按钮：显示当前 Tab 已选列数，便于用户感知偏好已生效 */
  const columnSettingsLabel = `列设置（${visibleColumnKeys[category].length}/${RESOURCE_COLUMN_META[category].length}）`

  return {
    visibleColumnKeys: visibleColumnKeys[category],
    visibleColumns,
    resizableColumns,
    tableScrollX,
    tableContainerRef,
    columnSettingsOpen,
    setColumnSettingsOpen,
    columnSettingsLabel,
    handleVisibleColumnKeysChange,
    handleResetColumnKeys,
  }
}

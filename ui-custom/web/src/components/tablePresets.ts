/**
 * 表格统一样式预设（对应前端标准第 9 章「列表与长文本规范」 / frontend-developer.md Step 3.5 第 8 项）。
 *
 * 规则：
 * - 列数 ≤ 8，超出字段下沉详情 Drawer；
 * - 列数多或列内容长时必须 TABLE_SCROLL_X 底部横向滚动条；
 * - 主标识列 fixed: 'left'，操作列 fixed: 'right'；
 * - 文本列用 EllipsisText 截断，禁止单元格换行撑高行高。
 */
export const TABLE_SCROLL_X = { x: 'max-content' } as const

/**
 * 可拖动列宽的边界（px）。
 *
 * 下限保证表头文字 / 行内操作按钮仍有可点击空间；上限避免单列被拖到超宽、
 * 把其余列挤出视口（列宽偏好是纯视图态，需可预期）。
 */
export const MIN_COLUMN_WIDTH = 60
export const MAX_COLUMN_WIDTH = 800

/** 未单独登记默认宽度的列使用的兜底值（与既有 15 列宽表观感一致） */
export const DEFAULT_COLUMN_WIDTH = 140

export const TABLE_PAGINATION = {
  pageSize: 20,
  showSizeChanger: true,
  showTotal: (total: number) => `共 ${total} 条`,
} as const
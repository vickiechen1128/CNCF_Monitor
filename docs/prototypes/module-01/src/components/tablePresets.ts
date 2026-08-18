/**
 * 表格统一样式预设（对应前端标准第 9 章「列表与长文本规范」）。
 *
 * 规则：
 * - 列数 ≤ 8，超出字段下沉详情 Drawer；
 * - 列数多或列内容长时必须 TABLE_SCROLL_X（底部横向滚动条）；
 * - 主标识列 fixed: 'left'，操作列 fixed: 'right'；
 * - 文本列用 EllipsisText 截断，禁止单元格换行撑高行高。
 */
export const TABLE_SCROLL_X = { x: 'max-content' } as const

export const TABLE_PAGINATION = {
  pageSize: 20,
  showSizeChanger: true,
  showTotal: (total: number) => `共 ${total} 条`,
} as const
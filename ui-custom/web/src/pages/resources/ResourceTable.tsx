import type { RefObject } from 'react'
import { Button, Empty, Space, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  DownloadOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { ResizableHeaderCell } from '../../components/ResizableHeaderCell'
import { TABLE_PAGINATION } from '../../components/tablePresets'
import type { ResourceListItem } from './useResources'

export interface ResourceTableProps {
  dataSource: ResourceListItem[]
  columns: ColumnsType<ResourceListItem>
  loading: boolean
  /** scroll.x：可见列宽之和与容器宽度的较大值 */
  scrollX: number
  /** 表格容器引用（ResizeObserver 实测容器宽度） */
  containerRef: RefObject<HTMLDivElement>
  onRowClick: (record: ResourceListItem) => void
  page: number
  pageSize: number
  total: number
  onPageSizeChange: (page: number, pageSize: number) => void
  /** 空态动作：新增 / 下载模板 / Excel 导入 */
  onCreate: () => void
  onDownloadTemplate: () => void
  onImport: () => void
}

/**
 * 资源列表表格（T07-R6 从 ResourcesPage 原样迁出，行为等价）。
 *
 * 保留：可拖动表头（ResizableHeaderCell）、分页预设、rowKey、行点击排除行内按钮、
 * 空态三按钮集合与顺序。纯展示组件：不请求数据、不持有状态。
 */
export function ResourceTable({
  dataSource,
  columns,
  loading,
  scrollX,
  containerRef,
  onRowClick,
  page,
  pageSize,
  total,
  onPageSizeChange,
  onCreate,
  onDownloadTemplate,
  onImport,
}: ResourceTableProps) {
  return (
    // 列宽拖动需要固定布局：scroll.x 取「可见列宽之和」与容器宽度的较大值。
    // 容器宽度由 ResizeObserver 实测，列少时铺满、列多时横向滚动。
    <div ref={containerRef}>
      <Table<ResourceListItem>
        rowKey="resource_id"
        dataSource={dataSource}
        loading={loading}
        columns={columns}
        size="small"
        scroll={{ x: scrollX }}
        components={{ header: { cell: ResizableHeaderCell } }}
        onRow={(record) => ({
          onClick: (e) => {
            // T07-F6 行点击打开资源详情抽屉；行内按钮（详情/编辑/删除）点击不触发
            if ((e.target as HTMLElement).closest('button')) return
            onRowClick(record)
          },
        })}
        locale={{
          emptyText: (
            <Empty description="暂无资源">
              <Space>
                <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
                  新增资源
                </Button>
                <Button icon={<DownloadOutlined />} onClick={onDownloadTemplate}>
                  下载模板
                </Button>
                <Button icon={<UploadOutlined />} onClick={onImport}>
                  Excel 导入
                </Button>
              </Space>
            </Empty>
          ),
        }}
        pagination={{
          ...TABLE_PAGINATION,
          current: page,
          pageSize,
          total,
          onChange: (p, pz) => onPageSizeChange(p, pz),
        }}
      />
    </div>
  )
}

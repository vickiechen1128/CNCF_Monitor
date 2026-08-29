import { useState } from 'react'
import config from 'antd/locale/zh_CN'
import { MainLayout } from '../../../layouts/MainLayout'
import { FilterBar, FilterItem } from '../../../components/FilterBar'
import { EllipsisText } from '../../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../../components/tablePresets'
import { Alert, Button, Card, ConfigProvider, Empty, Select, Table, Tag, Typography } from 'antd'
import { EditOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import type { Tenant, TenantStatus } from '../../../types/domain'
import { useTenants } from './useTenants'
import { TenantDetailDrawer } from './TenantDetailDrawer'
import { TenantEditModal } from './TenantEditModal'

const { Text } = Typography

/**
 * 租户管理查看/编辑页（Module_06 §9.1 / 契约 §3）。
 * - 仅查看 /tools信息：列表 + 详情 Drawer + 编辑（name / multi_site_enabled）。
 * - 无「新建租户」「禁用」入口（MVP 后端 POST/PATCH status 返回 forbidden）。
 * - 覆盖：加载骨架屏 / 空态「暂无租户」/ 接口错误 Alert+重新加载 / 按状态筛选。
 */
export function TenantsPage() {
  const { data, loading, error, filters, setFilters, reload } = useTenants()

  const [detailTarget, setDetailTarget] = useState<Tenant | null>(null)
  const [editTarget, setEditTarget] = useState<Tenant | null>(null)

  const columns: ColumnsType<Tenant> = [
    {
      title: '租户 ID',
      dataIndex: 'id',
      key: 'id',
      width: 180,
      ellipsis: { showTitle: true },
      fixed: 'left',
      render: (id: string) => <EllipsisText>{id}</EllipsisText>,
    },
    {
      title: '租户名称',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      render: (name: string) => <EllipsisText>{name}</EllipsisText>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: TenantStatus) =>
        status === 'active' ? (
          <Tag color="#00B578">启用</Tag>
        ) : status === 'suspended' ? (
          <Tag color="#FA8C16">停用</Tag>
        ) : (
          <Tag color="#86909C">禁用</Tag>
        ),
    },
    {
      title: '平台管理员',
      dataIndex: 'is_platform_admin',
      key: 'is_platform_admin',
      width: 120,
      render: (v: boolean) => (v ? <Text type="success">是</Text> : '否'),
    },
    {
      title: '多站点采集',
      dataIndex: 'multi_site_enabled',
      key: 'multi_site_enabled',
      width: 120,
      render: (v: boolean) => (v ? <Text type="success">开启</Text> : '关闭'),
    },
    {
      title: '关联网域数',
      dataIndex: 'network_domain_ids',
      key: 'network_domain_ids',
      width: 120,
      render: (ids: string[] = []) => ids.length,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 170,
      render: (v: string) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—'),
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      fixed: 'right',
      render: (_: unknown, record: Tenant) => (
        <span>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => setDetailTarget(record)}>
            查看
          </Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => setEditTarget(record)}>
            编辑
          </Button>
        </span>
      ),
    },
  ]

  return (
    <MainLayout>
      <ConfigProvider locale={config}>
        <Card>
          {error && (
            <Alert
              type="error"
              showIcon
              message="租户列表加载失败，请稍后重试"
              description={error}
              action={
                <Button size="small" icon={<ReloadOutlined />} onClick={reload}>
                  重新加载
                </Button>
              }
              style={{ marginBottom: 16 }}
            />
          )}

          <FilterBar>
            <FilterItem label="状态" width={200}>
              <Select
                placeholder="全部"
                allowClear
                style={{ width: 120 }}
                value={filters.status}
                onChange={(v) => setFilters({ ...filters, status: v })}
              >
                <Select.Option value="active">启用</Select.Option>
                <Select.Option value="suspended">停用</Select.Option>
                <Select.Option value="disabled">禁用</Select.Option>
              </Select>
            </FilterItem>
          </FilterBar>

          <Table<Tenant>
            rowKey="id"
            dataSource={data.items}
            loading={loading}
            columns={columns}
            scroll={TABLE_SCROLL_X}
            locale={{ emptyText: <Empty description="暂无租户" /> }}
            pagination={{
              ...TABLE_PAGINATION,
              total: data.total,
            }}
          />

          <TenantDetailDrawer
            open={detailTarget !== null}
            tenant={detailTarget}
            onClose={() => setDetailTarget(null)}
          />
          <TenantEditModal
            open={editTarget !== null}
            tenant={editTarget}
            onCancel={() => setEditTarget(null)}
            onSuccess={reload}
          />
        </Card>
      </ConfigProvider>
    </MainLayout>
  )
}

export default TenantsPage
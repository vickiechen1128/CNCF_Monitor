import config from 'antd/locale/zh_CN'
import { MainLayout } from '../../../layouts/MainLayout'
import { FilterBar, FilterItem } from '../../../components/FilterBar'
import { EllipsisText } from '../../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../../components/tablePresets'
import { Alert, Button, Card, ConfigProvider, Empty, Input, Select, Table, Tag, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import type { LoginLogItem } from '../../../types/admin'
import { useLoginLogs } from './useLoginLogs'

const { Text } = Typography

/**
 * 登录日志列表页（Module_06 §6.3 / §11.1）。
 * - 数据来自 GET /api/v2/platform/login-logs，接口按时间倒序返回（前端不二次排序）。
 * - 覆盖：加载骨架屏 / 空态「暂无登录日志」/ 接口错误 Alert+重新加载。
 * - 筛选：按 username 搜索、按 success 结果筛选（FilterBar 栅格布局 + 共享分页预设）。
 */
export function LoginLogsPage() {
  const { data, loading, error, filters, setFilters, page, pageSize, onPageSizeChange, reload } =
    useLoginLogs()

  const columns: ColumnsType<LoginLogItem> = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      width: 180,
      ellipsis: { showTitle: true },
      fixed: 'left',
      render: (username: string) => <EllipsisText>{username}</EllipsisText>,
    },
    {
      title: '登录结果',
      dataIndex: 'success',
      key: 'success',
      width: 110,
      render: (success: boolean) =>
        success ? <Tag color="#00B578">成功</Tag> : <Tag color="#86909C">失败</Tag>,
    },
    {
      title: 'IP 地址',
      dataIndex: 'ip',
      key: 'ip',
      width: 180,
      render: (ip: string) => (ip ? <EllipsisText>{ip}</EllipsisText> : <Text type="secondary">—</Text>),
    },
    {
      title: '登录时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 200,
      render: (v: string) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—'),
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
              message="登录日志加载失败，请稍后重试"
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
            <FilterItem label="用户名" width={260}>
              <Input.Search
                placeholder="按用户名搜索"
                allowClear
                style={{ width: 180 }}
                onSearch={(v) => setFilters({ ...filters, username: v || undefined })}
              />
            </FilterItem>
            <FilterItem label="登录结果" width={200}>
              <Select
                placeholder="全部"
                allowClear
                style={{ width: 120 }}
                value={filters.success || undefined}
                onChange={(v) => setFilters({ ...filters, success: v })}
              >
                <Select.Option value="true">成功</Select.Option>
                <Select.Option value="false">失败</Select.Option>
              </Select>
            </FilterItem>
          </FilterBar>

          <Table<LoginLogItem>
            rowKey="id"
            dataSource={data.items}
            loading={loading}
            columns={columns}
            scroll={TABLE_SCROLL_X}
            locale={{ emptyText: <Empty description="暂无登录日志" /> }}
            pagination={{
              ...TABLE_PAGINATION,
              current: page,
              pageSize,
              total: data.total,
              onChange: (p, pz) => onPageSizeChange(p, pz),
            }}
          />
        </Card>
      </ConfigProvider>
    </MainLayout>
  )
}

export default LoginLogsPage
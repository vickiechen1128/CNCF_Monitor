/**
 * 任务组详情抽屉（SRS JG v1.2 FR-JG-10）。
 *
 * 组公共参数摘要 + 逐域子任务表（实例数 / 同步状态 / 失败原因）；组级采集状态
 * 需按子任务聚合，本抽屉暂以「逐域同步状态」为主，采集状态下钻到子任务详情。
 */
import { Button, Descriptions, Drawer, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { JobGroup, JobGroupChild } from '../../types/jobGroup'

const { Text } = Typography

const SYNC_LABEL: Record<string, { text: string; color: string }> = {
  synced: { text: '已同步', color: 'success' },
  pending: { text: '待同步', color: 'processing' },
  partial: { text: '部分失败', color: 'warning' },
  failed: { text: '同步失败', color: 'error' },
  draft: { text: '草稿', color: 'default' },
  disabled: { text: '已停用', color: 'default' },
}

export interface JobGroupDetailDrawerProps {
  open: boolean
  group: JobGroup | null
  onClose: () => void
  onEdit: (group: JobGroup) => void
  onDelete: (group: JobGroup) => void
}

export function JobGroupDetailDrawer({ open, group, onClose, onEdit, onDelete }: JobGroupDetailDrawerProps) {
  const columns: ColumnsType<JobGroupChild> = [
    { title: '网域', dataIndex: 'network_domain_name', key: 'network_domain_name', width: 160 },
    { title: '实例数', dataIndex: 'instance_count', key: 'instance_count', width: 90 },
    {
      title: '同步状态',
      dataIndex: 'sync_status',
      key: 'sync_status',
      width: 120,
      render: (status: string) => {
        const meta = SYNC_LABEL[status] ?? { text: status, color: 'default' }
        return <Tag color={meta.color}>{meta.text}</Tag>
      },
    },
    { title: '失败原因', dataIndex: 'sync_error', key: 'sync_error', render: (value: string) => value || '-' },
  ]

  return (
    <Drawer
      title={group ? `任务详情 - ${group.name}` : '任务详情'}
      width={760}
      open={open}
      onClose={onClose}
      footer={
        group ? (
          <Space style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button danger onClick={() => onDelete(group)}>
              删除任务
            </Button>
            <Space>
              <Button onClick={onClose}>关闭</Button>
              <Button type="primary" onClick={() => onEdit(group)}>
                编辑任务
              </Button>
            </Space>
          </Space>
        ) : null
      }
    >
      {group && (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Descriptions size="small" column={2} bordered>
            <Descriptions.Item label="任务名称">{group.name}</Descriptions.Item>
            <Descriptions.Item label="采集任务名">{group.job_name}</Descriptions.Item>
            <Descriptions.Item label="采集模板">{group.template_code || '-'}</Descriptions.Item>
            <Descriptions.Item label="状态">{group.status === 'enabled' ? '启用' : '已停用'}</Descriptions.Item>
            <Descriptions.Item label="采集间隔">{group.scrape_interval}</Descriptions.Item>
            <Descriptions.Item label="采集超时">{group.scrape_timeout}</Descriptions.Item>
            <Descriptions.Item label="采集路径">{group.metrics_path}</Descriptions.Item>
            <Descriptions.Item label="协议">{group.scheme}</Descriptions.Item>
            <Descriptions.Item label="创建人">{group.created_by || '-'}</Descriptions.Item>
            <Descriptions.Item label="覆盖网域">{group.domains.length} 个</Descriptions.Item>
          </Descriptions>

          <div>
            <Text strong>各网域执行情况</Text>
            <Text type="secondary" style={{ fontSize: 12, marginInlineStart: 8 }}>
              同一任务按实例所属网域自动拆分为多份下发；单个网域失败不影响其他网域。
            </Text>
          </div>
          <Table<JobGroupChild>
            rowKey="job_id"
            size="small"
            dataSource={group.domains}
            columns={columns}
            pagination={false}
          />
        </Space>
      )}
    </Drawer>
  )
}

export default JobGroupDetailDrawer

import { useMemo, useState } from 'react'
import {
  Alert,
  Card,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  Row,
  Col,
} from 'antd'
import {
  BellOutlined,
  ClockCircleOutlined,
  FireOutlined,
  PauseCircleOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  type AlertNotification,
  type NotificationStatus,
  mockAlertNotifications,
} from '../mocks/module-08'

const { Text } = Typography

const statusConfig: Record<NotificationStatus, { color: string; icon: React.ReactNode; label: string; tip: string }> = {
  active: { color: 'error', icon: <FireOutlined />, label: 'Active（通知中）', tip: '已通过路由计算，正在通知接收人' },
  silenced: { color: 'gold', icon: <PauseCircleOutlined />, label: 'Silenced（静默）', tip: '被静默规则命中，通知被屏蔽' },
  inhibited: { color: 'purple', icon: <ThunderboltOutlined />, label: 'Inhibited（抑制）', tip: '被抑制规则抑制（存在根因告警）' },
  unprocessed: { color: 'default', icon: <ClockCircleOutlined />, label: 'Unprocessed（待处理）', tip: '刚进入 Alertmanager，尚未完成路由 / 静默 / 抑制计算' },
}

const networkDomains = Array.from(new Set(mockAlertNotifications.map((a) => a.network_domain)))

export default function AlertStatusPage() {
  const [statusFilter, setStatusFilter] = useState<NotificationStatus | 'all'>('all')
  const [domainFilter, setDomainFilter] = useState<string>('all')

  const filtered = useMemo(
    () =>
      mockAlertNotifications.filter((a) => {
        const matchStatus = statusFilter === 'all' || a.status === statusFilter
        const matchDomain = domainFilter === 'all' || a.network_domain === domainFilter
        return matchStatus && matchDomain
      }),
    [statusFilter, domainFilter]
  )

  const counts = useMemo(() => {
    const counter: Record<NotificationStatus, number> = {
      active: 0,
      silenced: 0,
      inhibited: 0,
      unprocessed: 0,
    }
    mockAlertNotifications.forEach((a) => {
      counter[a.status] += 1
    })
    return counter
  }, [])

  return (
    <MainLayout>
      <div className="page-header">
        <Typography.Title level={4} style={{ margin: 0 }}>
          告警状态
        </Typography.Title>
        <Text type="secondary">
          Alertmanager 通知状态：告警经过路由、静默、抑制后的处理结果（谁正在被通知）
        </Text>
      </div>

      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="本页 vs「Prometheus 触发告警」"
        description={
          <span>
            本页展示<Text strong>Alertmanager 通知状态</Text>（告警已路由给谁、是否被静默 / 抑制）。
            当前触发了哪些规则（firing / pending）由{' '}
            <Text strong>Module_02 查询中心</Text>代理 Prometheus `/api/v1/alerts` 展示，本模块不重复实现。
          </span>
        }
      />

      <Row gutter={16} style={{ marginBottom: 16 }}>
        {Object.entries(statusConfig).map(([key, cfg]) => (
          <Col span={6} key={key}>
            <Card size="small">
              <Tooltip title={cfg.tip}>
                <Statistic
                  title={
                    <Space size={4}>
                      {cfg.icon}
                      <span>{cfg.label}</span>
                    </Space>
                  }
                  value={counts[key as NotificationStatus]}
                  valueStyle={{ fontSize: 22, color: key === 'active' ? '#FF4C3A' : undefined }}
                />
              </Tooltip>
            </Card>
          </Col>
        ))}
      </Row>

      <Card
        className="page-card"
        title="Alertmanager 通知状态"
        extra={
          <Space>
            <span className="text-secondary">通知状态：</span>
            <Select
              value={statusFilter}
              onChange={setStatusFilter}
              style={{ width: 180 }}
              options={[
                { value: 'all', label: '全部' },
                { value: 'active', label: 'Active（通知中）' },
                { value: 'silenced', label: 'Silenced（静默）' },
                { value: 'inhibited', label: 'Inhibited（抑制）' },
                { value: 'unprocessed', label: 'Unprocessed（待处理）' },
              ]}
            />
            <span className="text-secondary">网域：</span>
            <Select
              value={domainFilter}
              onChange={setDomainFilter}
              style={{ width: 160 }}
              options={[
                { value: 'all', label: '全部' },
                ...networkDomains.map((d) => ({ value: d, label: d })),
              ]}
            />
          </Space>
        }
      >
        <Table<AlertNotification>
          dataSource={filtered}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10 }}
          columns={[
            { title: 'Alertname', dataIndex: 'alertname', key: 'alertname' },
            {
              title: '通知状态',
              dataIndex: 'status',
              key: 'status',
              render: (status: NotificationStatus) => {
                const cfg = statusConfig[status]
                return (
                  <Tooltip title={cfg.tip}>
                    <Tag color={cfg.color} icon={cfg.icon}>
                      {cfg.label}
                    </Tag>
                  </Tooltip>
                )
              },
            },
            {
              title: '接收人',
              dataIndex: 'receiver',
              key: 'receiver',
              render: (receiver: string) =>
                receiver === '-' || receiver === '待路由' ? (
                  <Text type="secondary">{receiver}</Text>
                ) : (
                  <Tag color="blue" icon={<BellOutlined />}>
                    {receiver}
                  </Tag>
                ),
            },
            { title: '网域', dataIndex: 'network_domain', key: 'network_domain' },
            { title: '实例', dataIndex: 'instance', key: 'instance', ellipsis: true },
            { title: '激活时间', dataIndex: 'active_since', key: 'active_since', width: 170 },
            {
              title: '说明',
              dataIndex: 'note',
              key: 'note',
              render: (note: string) => (
                <Tooltip title={note}>
                  <Text type="secondary" ellipsis style={{ maxWidth: 260 }}>
                    {note}
                  </Text>
                </Tooltip>
              ),
            },
          ]}
        />
      </Card>
    </MainLayout>
  )
}

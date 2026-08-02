import { useMemo, useState } from 'react'
import { Card, Table, Tag, Select, Space, Typography, Tooltip } from 'antd'
import { FireOutlined, WarningOutlined, InfoCircleOutlined, ClockCircleOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { prometheusAlerts, type AlertState, type AlertSeverity } from '../mocks/module-02'

const { Text } = Typography

const stateConfig: Record<AlertState, { color: string; icon: React.ReactNode; label: string }> = {
  firing: { color: 'error', icon: <FireOutlined />, label: 'Firing' },
  pending: { color: 'warning', icon: <ClockCircleOutlined />, label: 'Pending' },
}

const severityConfig: Record<AlertSeverity, { color: string; icon: React.ReactNode; label: string }> = {
  critical: { color: 'error', icon: <FireOutlined />, label: 'Critical' },
  warning: { color: 'warning', icon: <WarningOutlined />, label: 'Warning' },
  info: { color: 'blue', icon: <InfoCircleOutlined />, label: 'Info' },
}

const networkDomains = Array.from(new Set(prometheusAlerts.map((a) => a.network_domain)))

export function AlertStatusPage() {
  const [stateFilter, setStateFilter] = useState<AlertState | 'all'>('all')
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | 'all'>('all')
  const [domainFilter, setDomainFilter] = useState<string>('all')

  const filteredAlerts = useMemo(() => {
    return prometheusAlerts.filter((alert) => {
      const matchState = stateFilter === 'all' || alert.state === stateFilter
      const matchSeverity = severityFilter === 'all' || alert.severity === severityFilter
      const matchDomain = domainFilter === 'all' || alert.network_domain === domainFilter
      return matchState && matchSeverity && matchDomain
    })
  }, [stateFilter, severityFilter, domainFilter])

  return (
    <MainLayout>
      <Card
        title="当前告警"
        extra={
          <Space>
            <span className="text-secondary">状态：</span>
            <Select
              value={stateFilter}
              onChange={setStateFilter}
              style={{ width: 120 }}
              options={[
                { value: 'all', label: '全部' },
                { value: 'firing', label: 'Firing' },
                { value: 'pending', label: 'Pending' },
              ]}
            />
            <span className="text-secondary">严重级别：</span>
            <Select
              value={severityFilter}
              onChange={setSeverityFilter}
              style={{ width: 120 }}
              options={[
                { value: 'all', label: '全部' },
                { value: 'critical', label: 'Critical' },
                { value: 'warning', label: 'Warning' },
                { value: 'info', label: 'Info' },
              ]}
            />
            <span className="text-secondary">网域：</span>
            <Select
              value={domainFilter}
              onChange={setDomainFilter}
              style={{ width: 160 }}
              options={[{ value: 'all', label: '全部' }, ...networkDomains.map((d) => ({ value: d, label: d }))]}
            />
          </Space>
        }
      >
        <Table
          dataSource={filteredAlerts}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10 }}
          columns={[
            { title: 'Alertname', dataIndex: 'alertname', key: 'alertname' },
            {
              title: '状态',
              dataIndex: 'state',
              key: 'state',
              render: (state: AlertState) => {
                const cfg = stateConfig[state]
                return (
                  <Tag color={cfg.color} icon={cfg.icon}>
                    {cfg.label}
                  </Tag>
                )
              },
            },
            {
              title: '严重级别',
              dataIndex: 'severity',
              key: 'severity',
              render: (severity: AlertSeverity) => {
                const cfg = severityConfig[severity]
                return (
                  <Tag color={cfg.color} icon={cfg.icon}>
                    {cfg.label}
                  </Tag>
                )
              },
            },
            { title: '实例', dataIndex: 'instance', key: 'instance' },
            { title: '激活时间', dataIndex: 'active_since', key: 'active_since' },
            { title: '网域', dataIndex: 'network_domain', key: 'network_domain' },
            {
              title: '描述',
              dataIndex: 'description',
              key: 'description',
              render: (desc: string) => (
                <Tooltip title={desc}>
                  <Text ellipsis style={{ maxWidth: 240 }}>
                    {desc}
                  </Text>
                </Tooltip>
              ),
            },
            {
              title: '标签',
              dataIndex: 'labels',
              key: 'labels',
              render: (labels: Record<string, string>) => (
                <Space size={[0, 4]} wrap>
                  {Object.entries(labels).map(([key, value]) => (
                    <Tag key={key} color="purple">{`${key}=${value}`}</Tag>
                  ))}
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </MainLayout>
  )
}

export default AlertStatusPage

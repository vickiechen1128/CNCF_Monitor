import { useMemo, useState } from 'react'
import { Card, Table, Tag, Select, Space, Typography, Tooltip } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { scrapeTargets, type TargetStatus } from '../mocks/module-02'

const { Text } = Typography

const statusConfig: Record<TargetStatus, { color: string; icon: React.ReactNode; label: string }> = {
  up: { color: 'success', icon: <CheckCircleOutlined />, label: 'Up' },
  down: { color: 'error', icon: <CloseCircleOutlined />, label: 'Down' },
  unknown: { color: 'default', icon: <QuestionCircleOutlined />, label: 'Unknown' },
}

const networkDomains = Array.from(new Set(scrapeTargets.map((t) => t.network_domain)))

export function TargetsPage() {
  const [domainFilter, setDomainFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<TargetStatus | 'all'>('all')

  const filteredTargets = useMemo(() => {
    return scrapeTargets.filter((target) => {
      const matchDomain = domainFilter === 'all' || target.network_domain === domainFilter
      const matchStatus = statusFilter === 'all' || target.status === statusFilter
      return matchDomain && matchStatus
    })
  }, [domainFilter, statusFilter])

  return (
    <MainLayout>
      <Card
        title="目标状态"
        extra={
          <Space>
            <span className="text-secondary">网域：</span>
            <Select
              value={domainFilter}
              onChange={setDomainFilter}
              style={{ width: 160 }}
              options={[{ value: 'all', label: '全部' }, ...networkDomains.map((d) => ({ value: d, label: d }))]}
            />
            <span className="text-secondary">状态：</span>
            <Select
              value={statusFilter}
              onChange={setStatusFilter}
              style={{ width: 120 }}
              options={[
                { value: 'all', label: '全部' },
                { value: 'up', label: 'Up' },
                { value: 'down', label: 'Down' },
                { value: 'unknown', label: 'Unknown' },
              ]}
            />
          </Space>
        }
      >
        <Table
          dataSource={filteredTargets}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10 }}
          columns={[
            { title: 'Job', dataIndex: 'job', key: 'job' },
            { title: 'Instance', dataIndex: 'instance', key: 'instance' },
            {
              title: '状态',
              dataIndex: 'status',
              key: 'status',
              render: (status: TargetStatus) => {
                const cfg = statusConfig[status]
                return (
                  <Tag color={cfg.color} icon={cfg.icon}>
                    {cfg.label}
                  </Tag>
                )
              },
            },
            { title: '最后采集', dataIndex: 'last_scrape', key: 'last_scrape' },
            {
              title: '最后错误',
              dataIndex: 'last_error',
              key: 'last_error',
              render: (error: string) =>
                error ? (
                  <Tooltip title={error}>
                    <Text type="danger" ellipsis style={{ maxWidth: 240 }}>
                      {error}
                    </Text>
                  </Tooltip>
                ) : (
                  <Text type="secondary">-</Text>
                ),
            },
            { title: '网域', dataIndex: 'network_domain', key: 'network_domain' },
            {
              title: '标签',
              dataIndex: 'labels',
              key: 'labels',
              render: (labels: Record<string, string>) => (
                <Space size={[0, 4]} wrap>
                  {Object.entries(labels).map(([key, value]) => (
                    <Tag key={key} color="blue">{`${key}=${value}`}</Tag>
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

export default TargetsPage

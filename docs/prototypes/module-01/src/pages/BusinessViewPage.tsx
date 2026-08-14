import { useMemo } from 'react'
import { Card, Table, Tag, Space, Typography, Alert, Badge } from 'antd'
import { ApartmentOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  businessMetricStore,
  BIZ_METRIC_STATUS_MAP,
  BIZ_METRIC_STATUS_COLOR,
  BIZ_DOMAINS,
  mockResources,
  CI_TYPE_LABEL,
  STATUS_LABEL,
  type BusinessMetricStatus,
} from '../mocks/module-01'

const { Title, Text } = Typography

/**
 * {v3.7} 业务视图（独立页，导航「指标库 → 业务视图」）
 * 业务语义层落地可视化：按 business_domain 聚合成员（微服务/中间件/主机）+ 业务指标 + 埋点状态。
 * 与「业务指标库」（登记表）职责分离：登记表 = 语义契约维护；本页 = 业务域聚合视图。
 * 完整版（健康度看板 + 独立业务目录）v0.2+ 开放。
 */
export default function BusinessViewPage() {
  // 直接读模块级共享 store（登记表增删改同步写 businessMetricStore，本页跳转后可见最新状态）
  const domainGroups = useMemo(() => {
    return BIZ_DOMAINS.map((domain) => {
      const members = mockResources.filter((r) => r.business_domain === domain)
      const bizMetrics = businessMetricStore.filter((m) => m.business_domain === domain)
      return { domain, members, bizMetrics }
    }).filter((g) => g.members.length > 0 || g.bizMetrics.length > 0)
  }, [])

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>业务视图</Title>
        <Text type="secondary">
          按业务域聚合：成员（微服务 / 中间件 / 主机）+ 业务指标 + 埋点 / 采集落地状态；完整版（健康度看板 + 独立业务目录）v0.2+ 开放
        </Text>
      </div>

      {/* {v3.7} 业务语义层说明（用户语言）：业务域 = 微服务的语义聚合，微服务 = 业务域的实现载体；语义层不改变采集配置逻辑 */}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="按业务域聚合：成员（微服务 / 中间件 / 主机）+ 业务指标 + 埋点状态"
        description={
          <span>
            业务域是业务语义聚合（为谁服务），成员是技术实现载体（应用/微服务 + 中间件 + 主机，按 business_domain 自动聚合）。
            业务语义层不改变采集配置逻辑（采集仍按 CI 类型 + 实例选择），仅影响本视图 / 查询聚合（biz 标签）/ 告警分组（v0.3+）。
          </span>
        }
      />

      <Space direction="vertical" style={{ width: '100%' }} size={16}>
        {domainGroups.length === 0 && (
          <Card>
            <div style={{ textAlign: 'center', padding: 24 }}>
              <Text type="secondary">暂无业务域成员 / 指标，可先在「业务指标库」登记业务指标后在此聚合查看</Text>
            </div>
          </Card>
        )}
        {domainGroups.map((g) => (
          <Card
            key={g.domain}
            size="small"
            title={
              <Space wrap>
                <ApartmentOutlined style={{ color: '#0ECDEB' }} />
                <Text strong>{g.domain}</Text>
                <Tag>成员 {g.members.length}</Tag>
                <Tag>业务指标 {g.bizMetrics.length}</Tag>
                <Tag color="green">已上线 {g.bizMetrics.filter((m) => m.status === 'online').length}</Tag>
              </Space>
            }
          >
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
              成员（按 business_domain 自动聚合）
            </Text>
            <Table
              rowKey="resource_id"
              size="small"
              pagination={false}
              dataSource={g.members}
              columns={[
                { title: '实例', dataIndex: 'instance_name', key: 'instance_name' },
                {
                  title: '类型',
                  dataIndex: 'resource_type',
                  key: 'resource_type',
                  render: (v: string) => <Tag>{CI_TYPE_LABEL[v as keyof typeof CI_TYPE_LABEL] ?? v}</Tag>,
                },
                { title: '应用', dataIndex: 'app_name', key: 'app_name', render: (v?: string) => v || '-' },
                {
                  title: '状态',
                  dataIndex: 'status',
                  key: 'status',
                  render: (v: string) => (
                    <Badge
                      status={v === 'online' ? 'success' : v === 'maintenance' ? 'warning' : 'error'}
                      text={STATUS_LABEL[v as keyof typeof STATUS_LABEL] ?? v}
                    />
                  ),
                },
              ]}
            />
            {g.bizMetrics.length > 0 && (
              <>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', margin: '12px 0 8px' }}>
                  业务指标（语义契约 → 采集落地）
                </Text>
                <Table
                  rowKey="metric_id"
                  size="small"
                  pagination={false}
                  dataSource={g.bizMetrics}
                  columns={[
                    {
                      title: '指标名',
                      dataIndex: 'metric_name',
                      key: 'metric_name',
                      render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text>,
                    },
                    { title: '语义', dataIndex: 'description', key: 'description' },
                    {
                      title: '埋点状态',
                      dataIndex: 'status',
                      key: 'status',
                      render: (v: BusinessMetricStatus) => (
                        <Badge status={BIZ_METRIC_STATUS_COLOR[v] as 'success' | 'processing' | 'warning'} text={BIZ_METRIC_STATUS_MAP[v]} />
                      ),
                    },
                  ]}
                />
              </>
            )}
          </Card>
        ))}
      </Space>
    </MainLayout>
  )
}

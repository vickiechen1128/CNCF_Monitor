import { Card, Col, Row, Statistic, Table, Tag } from 'antd'
import { MainLayout } from '../layouts/MainLayout'
import { dashboardStats } from '../mocks/dashboard'

export function DashboardPage() {
  return (
    <MainLayout>
      <Row gutter={[16, 16]}>
        <Col span={6}>
          <Card>
            <Statistic title="资源总数" value={dashboardStats.resources.total} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="采集覆盖率" value={dashboardStats.collectionCoverage} suffix="%" />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="当前告警" value={dashboardStats.activeAlerts} valueStyle={{ color: '#cf1322' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="采集 Job" value={dashboardStats.scrapeJobs} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={12}>
          <Card title="资源分布">
            <Row gutter={[16, 16]}>
              <Col span={8}>
                <Statistic title="主机" value={dashboardStats.resources.host} />
              </Col>
              <Col span={8}>
                <Statistic title="中间件" value={dashboardStats.resources.middleware} />
              </Col>
              <Col span={8}>
                <Statistic title="应用服务" value={dashboardStats.resources.application} />
              </Col>
            </Row>
          </Card>
        </Col>
        <Col span={12}>
          <Card title="最新告警">
            <Table
              dataSource={dashboardStats.latestAlerts}
              rowKey="id"
              pagination={false}
              size="small"
              columns={[
                { title: '告警名', dataIndex: 'name', key: 'name' },
                {
                  title: '级别',
                  dataIndex: 'severity',
                  key: 'severity',
                  render: (severity: string) => (
                    <Tag color={severity === 'critical' ? 'red' : severity === 'warning' ? 'orange' : 'blue'}>
                      {severity}
                    </Tag>
                  ),
                },
                { title: '摘要', dataIndex: 'summary', key: 'summary', ellipsis: true },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Row style={{ marginTop: 16 }}>
        <Col span={24}>
          <Card title="最近活动">
            <Table
              dataSource={dashboardStats.recentActivities}
              rowKey="id"
              pagination={false}
              size="small"
              columns={[
                { title: '操作', dataIndex: 'action', key: 'action' },
                { title: '操作人', dataIndex: 'operator', key: 'operator' },
                { title: '时间', dataIndex: 'time', key: 'time' },
                { title: '结果', dataIndex: 'result', key: 'result' },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </MainLayout>
  )
}

export default DashboardPage

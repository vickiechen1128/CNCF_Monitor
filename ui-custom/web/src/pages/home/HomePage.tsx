import { useEffect, useState } from 'react'
import { Card, Spin, Alert, Row, Col, Statistic, Table, Typography, Space } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { apiClient } from '../../api/client'
import { dashboardApi } from '../../api/dashboard'
import type { DashboardSummary, RecentDeployment } from '../../api/dashboard'
import { MainLayout } from '../../layouts/MainLayout'
import { EllipsisText } from '../../components/EllipsisText'
import { TABLE_SCROLL_X } from '../../components/tablePresets'

interface Status {
  version: string
  mode: string
}

const STATUS_MOCK: Status = {
  version: 'dev-preview',
  mode: 'static-preview',
}

const DASHBOARD_MOCK: DashboardSummary = {
  resource_count: 0,
  pending_draft_count: 0,
  recent_deployments: [],
  domain_count: 0,
}

const IS_STATIC_PREVIEW = import.meta.env.VITE_STATIC_PREVIEW === 'true'

const DEPLOYMENT_COLUMNS: ColumnsType<RecentDeployment> = [
  {
    title: '变更单号',
    dataIndex: 'change_no',
    key: 'change_no',
    render: (value: string) => <EllipsisText>{value}</EllipsisText>,
  },
  {
    title: '网域',
    dataIndex: 'network_domain_name',
    key: 'network_domain_name',
    render: (value: string) => <EllipsisText>{value}</EllipsisText>,
  },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    render: (value: string) => <Typography.Text>{value}</Typography.Text>,
  },
  {
    title: '下发时间',
    dataIndex: 'triggered_at',
    key: 'triggered_at',
  },
]

export function HomePage() {
  const [status, setStatus] = useState<Status | null>(() => (IS_STATIC_PREVIEW ? STATUS_MOCK : null))
  const [error, setError] = useState<string | null>(null)

  const [dashboard, setDashboard] = useState<DashboardSummary | null>(() =>
    IS_STATIC_PREVIEW ? DASHBOARD_MOCK : null,
  )
  const [dashboardLoading, setDashboardLoading] = useState(() => !IS_STATIC_PREVIEW)
  const [dashboardError, setDashboardError] = useState<string | null>(null)

  useEffect(() => {
    // Vercel 静态预览环境没有后端，不发起请求
    if (IS_STATIC_PREVIEW) {
      return
    }

    apiClient
      .get<Status>('/api/v1/status')
      .then((res) => {
        if (res.status === 'success') {
          setStatus(res.data)
        } else {
          setError(res.error || '请求失败')
        }
      })
      .catch((err: Error) => {
        setError(err.message)
      })
  }, [])

  useEffect(() => {
    if (IS_STATIC_PREVIEW) {
      return
    }

    dashboardApi
      .getSummary()
      .then((res) => {
        if (res.status === 'success') {
          setDashboard(res.data)
        } else {
          setDashboardError(res.error || '请求失败')
        }
        setDashboardLoading(false)
      })
      .catch((err: Error) => {
        setDashboardError(err.message)
        setDashboardLoading(false)
      })
  }, [])

  const recentDeployments = dashboard?.recent_deployments?.slice(0, 5) ?? []

  return (
    <MainLayout>
      <Card title="Dashboard 概览" className="dashboard-card">
        {dashboardLoading && <Spin tip="加载中..." />}
        {dashboardError && <Alert message="请求失败" description={dashboardError} type="error" showIcon />}
        {dashboard && (
          <div>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} md={8} lg={6}>
                <Card size="small">
                  <Statistic title="资源总数" value={dashboard.resource_count} />
                </Card>
              </Col>
              <Col xs={24} sm={12} md={8} lg={6}>
                <Card size="small">
                  <Statistic title="待确认配置草稿数" value={dashboard.pending_draft_count} />
                </Card>
              </Col>
              <Col xs={24} sm={12} md={8} lg={6}>
                <Card size="small">
                  <Statistic title="已纳管网域数" value={dashboard.domain_count} />
                </Card>
              </Col>
            </Row>

            <Card title="最近下发记录" size="small" style={{ marginTop: 16 }}>
              {recentDeployments.length === 0 ? (
                <Typography.Text type="secondary">暂无下发记录</Typography.Text>
              ) : (
                <Table
                  rowKey="id"
                  size="small"
                  columns={DEPLOYMENT_COLUMNS}
                  dataSource={recentDeployments}
                  pagination={false}
                  scroll={TABLE_SCROLL_X}
                />
              )}
            </Card>
          </div>
        )}
      </Card>

      {/* 系统状态标注：版本/模式放在页面角落，不占据首屏中央 */}
      {(status || error) && (
        <div style={{ textAlign: 'right', marginTop: 12 }}>
          <Typography.Text type={error ? 'danger' : 'secondary'} style={{ fontSize: 12 }}>
            <Space size={16}>
              {status && <span>版本 {status.version}</span>}
              {status && <span>模式 {status.mode}</span>}
              {error && <span>状态加载失败：{error}</span>}
            </Space>
          </Typography.Text>
        </div>
      )}
    </MainLayout>
  )
}

export default HomePage
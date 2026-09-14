import { Card, Row, Col, Typography } from 'antd'
import { Link } from 'react-router-dom'
import {
  DatabaseOutlined,
  CloudServerOutlined,
  FileTextOutlined,
  LineChartOutlined,
  BellOutlined,
} from '@ant-design/icons'

interface QuickLinkItem {
  label: string
  href: string
  icon: React.ReactNode
}

const QUICK_LINKS: QuickLinkItem[] = [
  { label: '资源管理', href: '/resources', icon: <DatabaseOutlined /> },
  { label: '采集 Job', href: '/scrape-jobs', icon: <CloudServerOutlined /> },
  { label: '配置预览下发', href: '/config-preview', icon: <FileTextOutlined /> },
  { label: '指标查询', href: '/query', icon: <LineChartOutlined /> },
  { label: '告警状态', href: '/alert-status', icon: <BellOutlined /> },
]

export function QuickAccess() {
  return (
    <Card title="系统快速入口" data-testid="quick-access-card" style={{ marginTop: 16 }}>
      <Row gutter={[16, 16]}>
        {QUICK_LINKS.map((item) => (
          <Col key={item.href} xs={24} sm={12} md={8} lg={6} xl={4}>
            <Link to={item.href} style={{ display: 'block', textDecoration: 'none' }}>
              <Card hoverable size="small">
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>{item.icon}</div>
                  <Typography.Text strong>{item.label}</Typography.Text>
                </div>
              </Card>
            </Link>
          </Col>
        ))}
      </Row>
    </Card>
  )
}

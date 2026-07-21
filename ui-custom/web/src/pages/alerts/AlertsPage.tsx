import { Card, Typography } from 'antd'

const { Title } = Typography

export function AlertsPage() {
  return (
    <Card>
      <Title level={4}>告警状态</Title>
      <p>当前告警列表展示入口。</p>
    </Card>
  )
}

export default AlertsPage

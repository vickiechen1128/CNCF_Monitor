import { Card, Typography } from 'antd'

const { Title } = Typography

export function ResourcePage() {
  return (
    <Card>
      <Title level={4}>资源管理</Title>
      <p>主机 / 中间件 / 应用服务资源的 CRUD 与 Excel 导入入口。</p>
    </Card>
  )
}

export default ResourcePage

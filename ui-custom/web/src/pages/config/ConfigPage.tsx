import { Card, Typography } from 'antd'

const { Title } = Typography

export function ConfigPage() {
  return (
    <Card>
      <Title level={4}>配置中心</Title>
      <p>标签模板、采集 Job、拨测配置与 prometheus.yml 预览入口。</p>
    </Card>
  )
}

export default ConfigPage

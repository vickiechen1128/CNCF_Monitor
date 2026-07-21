import { Card, Typography } from 'antd'

const { Title } = Typography

export function QueryPage() {
  return (
    <Card>
      <Title level={4}>指标查询</Title>
      <p>PromQL 编辑器、查询结果（表格/JSON/简单折线）入口。</p>
    </Card>
  )
}

export default QueryPage

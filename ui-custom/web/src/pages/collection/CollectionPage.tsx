import { Card, Typography } from 'antd'

const { Title } = Typography

export function CollectionPage() {
  return (
    <Card>
      <Title level={4}>采集状态</Title>
      <p>采集目标列表、状态筛选与拨测结果展示入口。</p>
    </Card>
  )
}

export default CollectionPage

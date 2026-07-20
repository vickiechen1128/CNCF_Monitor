import { useEffect, useState } from 'react'
import { Layout, Typography, Card, Spin, Alert } from 'antd'
import './App.css'

const { Header, Content } = Layout
const { Title } = Typography

interface Status {
  version: string
  mode: string
}

function App() {
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/v1/status')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data: Status) => {
        setStatus(data)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  return (
    <Layout className="app-layout">
      <Header className="app-header">
        <Title level={3} className="app-title">
          MetricCenter
        </Title>
      </Header>
      <Content className="app-content">
        <Card title="系统状态" className="status-card">
          {loading && <Spin tip="加载中..." />}
          {error && <Alert message="请求失败" description={error} type="error" showIcon />}
          {status && (
            <div>
              <p>
                <strong>版本：</strong>
                {status.version}
              </p>
              <p>
                <strong>模式：</strong>
                {status.mode}
              </p>
            </div>
          )}
        </Card>
      </Content>
    </Layout>
  )
}

export default App

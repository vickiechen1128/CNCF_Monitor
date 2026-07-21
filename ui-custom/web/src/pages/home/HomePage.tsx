import { useEffect, useState } from 'react'
import { Card, Spin, Alert } from 'antd'
import { apiClient } from '../../api/client'
import { MainLayout } from '../../layouts/MainLayout'

interface Status {
  version: string
  mode: string
}

export function HomePage() {
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiClient
      .get<Status>('/api/v1/status')
      .then((res) => {
        if (res.status === 'success') {
          setStatus(res.data)
        } else {
          setError(res.error || '请求失败')
        }
        setLoading(false)
      })
      .catch((err: Error) => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  return (
    <MainLayout>
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
    </MainLayout>
  )
}

export default HomePage

import { useEffect, useState } from 'react'
import { Card, Spin, Alert } from 'antd'
import { apiClient } from '../../api/client'
import { MainLayout } from '../../layouts/MainLayout'

interface Status {
  version: string
  mode: string
}

const STATUS_MOCK: Status = {
  version: 'dev-preview',
  mode: 'static-preview',
}

export function HomePage() {
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Vercel 静态预览环境没有后端，使用 mock 状态
    if (import.meta.env.VITE_STATIC_PREVIEW === 'true') {
      setStatus(STATUS_MOCK)
      setLoading(false)
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
        setLoading(false)
      })
      .catch((err: Error) => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  return (
    <MainLayout>
      <Card title="系统状态（PR 预览）" className="status-card">
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

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Alert, Button, Spin } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { dashboardPanelApi, type DashboardPanel } from '../../api/dashboardPanels'
import { MainLayout } from '../../layouts/MainLayout'
import { DashboardFrame } from './DashboardFrame'

export function DashboardPanelPage() {
  const { id = '' } = useParams()
  const [panel, setPanel] = useState<DashboardPanel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 请求代际：重试 / 切换面板时丢弃旧响应，避免卸载后 setState 与竞态覆盖。
  const requestSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    try {
      const res = await dashboardPanelApi.get(id)
      if (seq !== requestSeq.current) return
      setPanel(res.data)
    } catch (err) {
      if (seq !== requestSeq.current) return
      setPanel(null)
      setError(err instanceof Error ? err.message : '面板加载失败')
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [id])

  useEffect(() => {
    // 数据加载在 effect 启动；loading/error 为请求态而非可派生状态，沿用仓库既有模式。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    return () => {
      requestSeq.current += 1
    }
  }, [load])

  return (
    <MainLayout>
      <div className="dashboard-panel-page">
        {loading && (
          <div className="dashboard-panel-state">
            <Spin />
            <span>大屏加载中…</span>
          </div>
        )}
        {error && (
          <Alert
            type="error"
            showIcon
            message={error}
            action={
              <Button aria-label="重新加载" icon={<ReloadOutlined />} onClick={() => void load()}>
                重新加载
              </Button>
            }
          />
        )}
        {panel && <DashboardFrame url={panel.url} title={panel.name} />}
      </div>
    </MainLayout>
  )
}

export default DashboardPanelPage

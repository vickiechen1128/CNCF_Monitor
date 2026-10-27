import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react'
import { useParams } from 'react-router-dom'
import { Alert, Button, Spin } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { dashboardPanelApi, type DashboardPanel } from '../../api/dashboardPanels'
import { MainLayout } from '../../layouts/MainLayout'
import { buildKioskURL } from './kioskUrl'
import { attachKioskEventGuards } from './kioskEvents'

export function DashboardPanelPage() {
  const { id = '' } = useParams()
  const [panel, setPanel] = useState<DashboardPanel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const eventGuardCleanup = useRef<() => void>(() => undefined)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await dashboardPanelApi.get(id)
      setPanel(res.data)
    } catch (err) {
      setPanel(null)
      setError(err instanceof Error ? err.message : '面板加载失败')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    let cancelled = false
    dashboardPanelApi.get(id)
      .then((res) => {
        if (!cancelled) setPanel(res.data)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setPanel(null)
        setError(err instanceof Error ? err.message : '面板加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [id])

  useEffect(() => () => eventGuardCleanup.current(), [])

  const handleIframeLoad = (event: SyntheticEvent<HTMLIFrameElement>) => {
    eventGuardCleanup.current()
    eventGuardCleanup.current = attachKioskEventGuards(event.currentTarget)
  }

  return (
    <MainLayout>
      <div className="dashboard-panel-page">
        {loading && <div className="dashboard-panel-state"><Spin tip="大屏加载中…" /></div>}
        {error && (
          <Alert
            type="error"
            showIcon
            message={error}
            action={<Button aria-label="重新加载" icon={<ReloadOutlined />} onClick={() => void load()}>重新加载</Button>}
          />
        )}
        {panel && (
          <iframe
            className="dashboard-panel-frame"
            src={buildKioskURL(panel.url)}
            title={panel.name}
            onLoad={handleIframeLoad}
            allowFullScreen
          />
        )}
      </div>
    </MainLayout>
  )
}

export default DashboardPanelPage

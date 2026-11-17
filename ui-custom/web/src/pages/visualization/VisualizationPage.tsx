/**
 * 可视化大屏页（M05 SRS v1.1 FR-11 / FR-12 / §8.3）。
 *
 * 一级导航第 2 位入口。MVP 形态复用已登记的自定义大屏面板（Grafana iframe），
 * 不预置模板（预置模板属 v0.3）；页面提供：
 * - 面板选择（URL `?panel=<id>` 可分享 / 刷新保持）；
 * - 全屏 / 退出全屏（DashboardFrame 内，浏览器全屏后门户 Header / Sider 自动隐藏）；
 * - 新窗口打开与重新加载；
 * - 空态引导到「面板挂载」。
 *
 * 数据源：GET /api/v3/platform/dashboard/panels（M05 自有实体 DashboardPanel）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Alert, Button, Empty, Select, Space, Typography } from 'antd'
import { ExportOutlined, ReloadOutlined } from '@ant-design/icons'
import { dashboardPanelApi, type DashboardPanel } from '../../api/dashboardPanels'
import { getStoredUser } from '../../api/client'
import { LoadingPlaceholder } from '../../components/LoadingPlaceholder'
import { MainLayout } from '../../layouts/MainLayout'
import { DashboardFrame } from '../dashboard/DashboardFrame'
import { buildKioskURL } from '../dashboard/kioskUrl'

const MAX_PANELS = 100

export function VisualizationPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [panels, setPanels] = useState<DashboardPanel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadSeq, setReloadSeq] = useState(0)
  const [frameKey, setFrameKey] = useState(0)
  const isAdmin = getStoredUser()?.role === 'admin'
  const requestSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    try {
      const res = await dashboardPanelApi.list({ page: 1, page_size: MAX_PANELS })
      if (seq !== requestSeq.current) return
      setPanels(res.data.list)
    } catch (err) {
      if (seq !== requestSeq.current) return
      setError(err instanceof Error ? err.message : '大屏列表加载失败，请稍后重试')
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    // 数据加载在 effect 启动；loading/error 为请求态而非可派生状态，沿用仓库既有模式。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    return () => {
      requestSeq.current += 1
    }
  }, [load, reloadSeq])

  // 面板选择以 URL 为单一事实源：直接分享 / 刷新仍停留在同一块大屏。
  const requestedId = Number(searchParams.get('panel'))
  const selected = useMemo(
    () => panels.find((panel) => panel.id === requestedId) ?? panels[0] ?? null,
    [panels, requestedId],
  )

  const selectPanel = (id: number) => {
    setSearchParams({ panel: String(id) }, { replace: true })
    setFrameKey((key) => key + 1)
  }

  const openInNewWindow = () => {
    if (!selected) return
    try {
      window.open(buildKioskURL(selected.url), '_blank', 'noopener,noreferrer')
    } catch {
      // 地址非法时 DashboardFrame 已展示可读错误，这里不再重复弹窗。
    }
  }

  return (
    <MainLayout>
      <div className="visualization-page" data-testid="visualization-page">
        <div className="visualization-toolbar">
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              可视化大屏
            </Typography.Title>
            <Typography.Text type="secondary">
              选择已挂载的 Grafana 面板投屏；全屏后门户导航自动隐藏。
            </Typography.Text>
          </div>
          {panels.length > 0 && (
            <Space wrap>
              <Select
                aria-label="选择大屏面板"
                style={{ minWidth: 240 }}
                value={selected?.id}
                onChange={selectPanel}
                options={panels.map((panel) => ({ value: panel.id, label: panel.name }))}
              />
              <Button icon={<ReloadOutlined />} onClick={() => setFrameKey((key) => key + 1)}>
                重新加载
              </Button>
              <Button icon={<ExportOutlined />} onClick={openInNewWindow}>
                新窗口打开
              </Button>
            </Space>
          )}
        </div>

        {loading && <LoadingPlaceholder tip="大屏加载中…" />}

        {!loading && error && (
          <Alert
            type="error"
            showIcon
            message="大屏列表加载失败"
            description={error}
            action={
              <Button
                aria-label="重新加载大屏列表"
                icon={<ReloadOutlined />}
                onClick={() => setReloadSeq((seq) => seq + 1)}
              >
                重新加载
              </Button>
            }
          />
        )}

        {!loading && !error && panels.length === 0 && (
          <Empty
            className="visualization-empty"
            description="尚未挂载可视化大屏"
          >
            <Typography.Text type="secondary">
              {isAdmin ? (
                <>
                  前往 <Link to="/admin/dashboard-panels">面板挂载</Link> 登记 Grafana 面板后即可在此投屏。
                </>
              ) : (
                '请联系管理员在「系统与平台管理 → 面板挂载」登记 Grafana 面板。'
              )}
            </Typography.Text>
          </Empty>
        )}

        {!loading && !error && selected && (
          <div className="visualization-frame-wrap">
            <DashboardFrame
              key={`${selected.id}-${frameKey}`}
              url={selected.url}
              title={selected.name}
              showFullscreen
            />
          </div>
        )}
      </div>
    </MainLayout>
  )
}

export default VisualizationPage

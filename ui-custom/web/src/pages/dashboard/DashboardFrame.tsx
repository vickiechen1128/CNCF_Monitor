/**
 * Grafana iframe 共用展示组件（M05 FR-10 / NFR-05）：
 * - 统一追加 `kiosk` / `hideLogo=true`（见 kioskUrl.ts）；
 * - 同源时屏蔽双击与 Escape（见 kioskEvents.ts）；
 * - 加载失败 / 超时给出可读提示与重试入口，不把 iframe 的空白当成正常状态；
 * - 可选全屏按钮（可视化大屏页使用，FR-12）：全屏作用于本组件容器，
 *   门户 Header / Sider 随浏览器全屏自动隐藏，iframe 铺满可视区域。
 *
 * 失败判据：`onError` 或 12s 内未触发 `onLoad`。Grafana 跳登录页也算一次
 * 成功加载（onLoad 会触发），页面不误报网络错误，符合「登录态由 Grafana 侧负责」。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react'
import { Alert, Button, Spin } from 'antd'
import { FullscreenExitOutlined, FullscreenOutlined, ReloadOutlined } from '@ant-design/icons'
import { buildKioskURL } from './kioskUrl'
import { attachKioskEventGuards } from './kioskEvents'

/** iframe 加载超时（毫秒）：超过后按失败处理，避免用户面对永久空白。 */
const FRAME_LOAD_TIMEOUT_MS = 12_000

interface DashboardFrameProps {
  /** 已登记的 Grafana 仪表盘地址（原始串，组件内部追加 kiosk 参数） */
  url: string
  /** iframe 可访问名称（同时作为面板标题） */
  title: string
  /** 是否展示全屏 / 退出全屏按钮（可视化大屏页开启） */
  showFullscreen?: boolean
}

interface FrameState {
  /** 当前状态归属的 frame key；与当前 key 不一致时视为全新加载（无需 effect 里重置换态）。 */
  key: string
  loaded: boolean
  error: boolean
}

export function DashboardFrame({ url, title, showFullscreen = false }: DashboardFrameProps) {
  const [reloadKey, setReloadKey] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [state, setState] = useState<FrameState>({ key: '', loaded: false, error: false })
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const guardCleanup = useRef<() => void>(() => undefined)
  const loadTimer = useRef<number | undefined>(undefined)

  // URL 解析失败（历史脏数据 / 手工改库）：展示配置错误，不渲染 iframe。
  const { src, urlError } = useMemo(() => {
    try {
      return { src: buildKioskURL(url), urlError: null as string | null }
    } catch {
      return {
        src: null as string | null,
        urlError: '大屏地址无效，请管理员到「面板挂载」重新登记 Grafana 地址。',
      }
    }
  }, [url])

  const frameKey = src ? `${src}-${reloadKey}` : ''
  // 换地址 / 重试时 key 变化，派生出的 loaded/error 自动回到初始态；
  // 这样无需在 effect 里同步 setState（避免级联渲染）。
  const active = state.key === frameKey ? state : { key: frameKey, loaded: false, error: false }

  const clearLoadTimer = useCallback(() => {
    if (loadTimer.current !== undefined) {
      window.clearTimeout(loadTimer.current)
      loadTimer.current = undefined
    }
  }, [])

  // 只负责启动/清理超时计时；setState 发生在计时器回调（异步）或 iframe 事件里。
  useEffect(() => {
    if (!src) return
    clearLoadTimer()
    loadTimer.current = window.setTimeout(() => {
      setState({ key: frameKey, loaded: false, error: true })
      clearLoadTimer()
    }, FRAME_LOAD_TIMEOUT_MS)
    return clearLoadTimer
  }, [src, frameKey, clearLoadTimer])

  // 换地址 / 卸载时释放上一个 iframe 文档上的事件守卫。
  useEffect(
    () => () => {
      clearLoadTimer()
      guardCleanup.current()
    },
    [frameKey, clearLoadTimer],
  )

  // 全屏状态跟随浏览器（Esc 退出时按钮文案要同步）。
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const handleLoad = (event: SyntheticEvent<HTMLIFrameElement>) => {
    clearLoadTimer()
    setState({ key: frameKey, loaded: true, error: false })
    guardCleanup.current()
    guardCleanup.current = attachKioskEventGuards(event.currentTarget)
  }

  const handleError = () => {
    clearLoadTimer()
    setState({ key: frameKey, loaded: false, error: true })
  }

  const retry = () => {
    setReloadKey((key) => key + 1)
  }

  const toggleFullscreen = async () => {
    const node = wrapperRef.current
    if (!node) return
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
        return
      }
      if (node.requestFullscreen) await node.requestFullscreen()
    } catch {
      /* 浏览器不支持 / 被策略拒绝：保持普通展示，不阻断大屏 */
    }
  }

  return (
    <div
      ref={wrapperRef}
      className="dashboard-frame-wrap"
      data-testid="dashboard-frame-wrap"
    >
      {urlError && (
        <Alert type="error" showIcon message="大屏地址不可用" description={urlError} />
      )}
      {!urlError && active.error && (
        <Alert
          type="error"
          showIcon
          message="大屏加载失败"
          description="请检查 Grafana 地址是否可访问、网络是否连通，以及 Grafana 侧是否开启 allow_embedding。"
          action={
            <Button aria-label="重新加载大屏" icon={<ReloadOutlined />} onClick={retry}>
              重新加载
            </Button>
          }
        />
      )}
      {!urlError && !active.error && src && (
        <>
          <iframe
            key={frameKey}
            className="dashboard-panel-frame"
            src={src}
            title={title}
            onLoad={handleLoad}
            onError={handleError}
            allowFullScreen
          />
          {!active.loaded && (
            <div className="dashboard-frame-loading" data-testid="dashboard-frame-loading">
              <Spin />
              <span>大屏加载中…</span>
            </div>
          )}
        </>
      )}
      {showFullscreen && !urlError && !active.error && (
        <Button
          size="small"
          className="dashboard-frame-fullscreen-toggle"
          aria-label={isFullscreen ? '退出全屏' : '全屏'}
          icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
          onClick={() => void toggleFullscreen()}
        >
          {isFullscreen ? '退出全屏' : '全屏'}
        </Button>
      )}
    </div>
  )
}

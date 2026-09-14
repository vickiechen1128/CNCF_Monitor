import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Row,
  Space,
  Spin,
  Statistic,
  theme,
  Tooltip,
} from 'antd'
import { WarningOutlined, ReloadOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { alertStatusApi } from '../../api/alertmanager'
import type { PromAlertItem, AmAlertItem, PromAlertsData, AmAlertsData } from '../../types/alertmanager'
import type { ApiResponse } from '../../types/api'

export interface AlertCounts {
  active: number
  silenced: number
  inhibited: number
  /** AM 待处理：刚进入 Alertmanager，尚未完成路由 / 静默 / 抑制计算（契约 §10.2 四态之一） */
  unprocessed: number
  firing: number
  pending: number
}

interface AlertStatusCardProps {
  isStaticPreview?: boolean
  mockCounts?: AlertCounts
}

function computeCounts(
  promRes: ApiResponse<PromAlertsData> | null,
  amRes: ApiResponse<AmAlertsData> | null,
): AlertCounts {
  // promRes / amRes 仅在信封 status === 'success' 时被写入（见 toSourceState），
  // 业务错误信封不会静默计 0，而是走 promError / amError 呈现。
  const promAlerts: PromAlertItem[] = promRes?.data?.alerts ?? []
  const amAlerts: AmAlertItem[] = amRes?.data?.items ?? []
  return {
    active: amAlerts.filter((i) => i.notify_status === 'active').length,
    silenced: amAlerts.filter((i) => i.notify_status === 'silenced').length,
    inhibited: amAlerts.filter((i) => i.notify_status === 'inhibited').length,
    unprocessed: amAlerts.filter((i) => i.notify_status === 'unprocessed').length,
    firing: promAlerts.filter((a) => a.state === 'firing').length,
    pending: promAlerts.filter((a) => a.state === 'pending').length,
  }
}

/** 单数据源取数结果归一：网络异常与业务错误信封（status: 'error'）统一转 error，不静默吞 0。 */
function toSourceState<T>(
  settled: PromiseSettledResult<ApiResponse<T>>,
): { res: ApiResponse<T> | null; error: string | null } {
  if (settled.status === 'rejected') {
    const reason: unknown = settled.reason
    return { res: null, error: reason instanceof Error ? reason.message : String(reason) }
  }
  if (settled.value.status === 'success') {
    return { res: settled.value, error: null }
  }
  return { res: null, error: settled.value.error || '请求失败' }
}

export function AlertStatusCard({ isStaticPreview = false, mockCounts }: AlertStatusCardProps) {
  const { token } = theme.useToken()
  const [promRes, setPromRes] = useState<ApiResponse<PromAlertsData> | null>(null)
  const [amRes, setAmRes] = useState<ApiResponse<AmAlertsData> | null>(null)
  const [promError, setPromError] = useState<string | null>(null)
  const [amError, setAmError] = useState<string | null>(null)
  const [loading, setLoading] = useState(() => !isStaticPreview)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    if (isStaticPreview) {
      return
    }
    let cancelled = false
    // allSettled：单端点失败不丢弃另一端点已成功数据，失败源局部降级提示（M1）
    Promise.allSettled([alertStatusApi.getPromAlerts(), alertStatusApi.getAlertmanagerAlerts()]).then(
      ([prom, am]) => {
        if (cancelled) return
        const p = toSourceState(prom)
        const a = toSourceState(am)
        setPromRes(p.res)
        setAmRes(a.res)
        setPromError(p.error)
        setAmError(a.error)
        setLoading(false)
      },
    )
    return () => {
      cancelled = true
    }
  }, [isStaticPreview, retryKey])

  const handleRetry = () => {
    setLoading(true)
    setPromError(null)
    setAmError(null)
    setRetryKey((k) => k + 1)
  }

  const counts = useMemo(() => {
    if (isStaticPreview && mockCounts) {
      return mockCounts
    }
    return computeCounts(promRes, amRes)
  }, [isStaticPreview, mockCounts, promRes, amRes])

  const allFailed = !loading && promError !== null && amError !== null
  const partialError = !loading && !allFailed && (promError !== null || amError !== null)
  const errorText = [promError, amError].filter(Boolean).join('；')

  // 空态只在「两条链路均取数成功且全为 0」时引导；部分失败时不误导（M2）
  const isEmpty =
    counts.active +
      counts.silenced +
      counts.inhibited +
      counts.unprocessed +
      counts.firing +
      counts.pending ===
    0
  const showEmptyGuide = !loading && !allFailed && !partialError && isEmpty

  const retryAction = (
    <Button size="small" icon={<ReloadOutlined />} onClick={handleRetry}>
      重试
    </Button>
  )

  return (
    <Card
      title="告警状态"
      data-testid="alert-status-card"
      extra={
        showEmptyGuide ? (
          <Link to="/alert-config">暂无告警，去配置通知规则 →</Link>
        ) : null
      }
      style={{ marginTop: 16 }}
    >
      {loading && <Spin />}
      {!loading && allFailed && (
        <Alert message="告警状态加载失败" description={errorText} type="error" showIcon action={retryAction} />
      )}
      {!loading && !allFailed && (
        <>
          {partialError && (
            <Alert
              message="部分告警数据加载失败"
              description={errorText}
              type="warning"
              showIcon
              action={retryAction}
              style={{ marginBottom: 16 }}
            />
          )}
          <Row gutter={[16, 16]} align="middle">
            <Col xs={24} sm={12} md={6}>
              <Statistic
                title={
                  <Space>
                    通知中
                    <Tooltip title="Alertmanager 治理态：当前正在通知的告警">
                      <WarningOutlined style={{ color: token.colorError }} />
                    </Tooltip>
                  </Space>
                }
                value={counts.active}
                valueStyle={{ color: token.colorError }}
              />
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Statistic title="已静默 / 已抑制" value={`${counts.silenced} / ${counts.inhibited}`} />
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Statistic
                title={
                  <Tooltip title="Alertmanager 待处理：刚进入 Alertmanager，尚未完成路由 / 静默 / 抑制计算">
                    <span>待处理</span>
                  </Tooltip>
                }
                value={counts.unprocessed}
              />
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Statistic
                title={
                  <Tooltip title="Prometheus 当前触发态：firing=触发中 / pending=待处理">
                    <span>Prometheus 触发 / 待处理</span>
                  </Tooltip>
                }
                value={`${counts.firing} / ${counts.pending}`}
              />
            </Col>
          </Row>
        </>
      )}
    </Card>
  )
}

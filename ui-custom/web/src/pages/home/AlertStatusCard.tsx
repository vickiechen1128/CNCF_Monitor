import { useEffect, useMemo, useState } from 'react'
import { Card, Spin, Alert, Statistic, Row, Col, Typography, Button, Tooltip, Space } from 'antd'
import { WarningOutlined, ReloadOutlined } from '@ant-design/icons'
import { alertStatusApi } from '../../api/alertmanager'
import type { PromAlertItem, AmAlertItem, PromAlertsData, AmAlertsData } from '../../types/alertmanager'
import type { ApiResponse } from '../../types/api'

export interface AlertCounts {
  active: number
  silenced: number
  inhibited: number
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
  const promAlerts: PromAlertItem[] = promRes?.status === 'success' ? (promRes.data?.alerts ?? []) : []
  const amAlerts: AmAlertItem[] = amRes?.status === 'success' ? (amRes.data?.items ?? []) : []
  return {
    active: amAlerts.filter((i) => i.notify_status === 'active').length,
    silenced: amAlerts.filter((i) => i.notify_status === 'silenced').length,
    inhibited: amAlerts.filter((i) => i.notify_status === 'inhibited').length,
    firing: promAlerts.filter((a) => a.state === 'firing').length,
    pending: promAlerts.filter((a) => a.state === 'pending').length,
  }
}

export function AlertStatusCard({ isStaticPreview = false, mockCounts }: AlertStatusCardProps) {
  const [promRes, setPromRes] = useState<ApiResponse<PromAlertsData> | null>(null)
  const [amRes, setAmRes] = useState<ApiResponse<AmAlertsData> | null>(null)
  const [loading, setLoading] = useState(() => !isStaticPreview)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    if (isStaticPreview) {
      return
    }
    let cancelled = false
    Promise.all([alertStatusApi.getPromAlerts(), alertStatusApi.getAlertmanagerAlerts()])
      .then(([prom, am]) => {
        if (cancelled) return
        setPromRes(prom)
        setAmRes(am)
        setLoading(false)
      })
      .catch((err: Error) => {
        if (cancelled) return
        setError(err.message)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isStaticPreview, retryKey])

  const handleRetry = () => {
    setLoading(true)
    setError(null)
    setRetryKey((k) => k + 1)
  }

  const counts = useMemo(() => {
    if (isStaticPreview && mockCounts) {
      return mockCounts
    }
    return computeCounts(promRes, amRes)
  }, [isStaticPreview, mockCounts, promRes, amRes])

  const isEmpty =
    counts.active + counts.silenced + counts.inhibited + counts.firing + counts.pending === 0
  const showEmptyGuide = !loading && !error && isEmpty

  return (
    <Card
      title="告警状态"
      data-testid="alert-status-card"
      extra={
        showEmptyGuide ? (
          <Typography.Link href="/alert-config">尚未挂载通知配置，去配置 →</Typography.Link>
        ) : null
      }
      style={{ marginTop: 16 }}
    >
      {loading && <Spin />}
      {error && (
        <Alert
          message="告警状态加载失败"
          description={error}
          type="error"
          showIcon
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={handleRetry}>
              重试
            </Button>
          }
        />
      )}
      {!loading && !error && (
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} sm={12} md={8}>
            <Statistic
              title={
                <Space>
                  通知中
                  <Tooltip title="Alertmanager 治理态：当前正在通知的告警">
                    <WarningOutlined style={{ color: '#ff4d4f' }} />
                  </Tooltip>
                </Space>
              }
              value={counts.active}
              valueStyle={{ color: '#ff4d4f' }}
            />
          </Col>
          <Col xs={24} sm={12} md={8}>
            <Statistic title="已静默 / 已抑制" value={`${counts.silenced} / ${counts.inhibited}`} />
          </Col>
          <Col xs={24} sm={12} md={8}>
            <Statistic
              title={
                <Tooltip title="Prometheus 当前触发态">
                  <span>Prom 触发 / 待处理</span>
                </Tooltip>
              }
              value={`${counts.firing} / ${counts.pending}`}
            />
          </Col>
        </Row>
      )}
    </Card>
  )
}

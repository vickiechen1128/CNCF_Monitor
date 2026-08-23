import { useCallback, useEffect, useState } from 'react'
import { Alert, Badge, Button, Card, Empty, Space, Spin, Typography, message } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { scrapeJobApi } from '../../api/scrapeJobs'
import type { InstallationStatus, ScrapeJobInstanceItem } from '../../types/strategy'

const { Text } = Typography

const INSTALL_STATUS_MAP: Record<InstallationStatus, { label: string; status: 'success' | 'warning' | 'default' }> = {
  unconfirmed: { label: '待确认', status: 'warning' },
  confirmed: { label: '已确认', status: 'success' },
  not_applicable: { label: '不适用', status: 'default' },
}

interface ExporterInstallationPanelProps {
  /** 采集 Job id（已保存后展示安装确认；新建未保存时为 0/空） */
  jobId: number
}

/**
 * Exporter 安装确认面板（Module_01 §5.6/§6.2.5/§8④/§11.1，F5）。
 * 展示 Job 已选实例的安装状态（unconfirmed/confirmed/not_applicable）；
 * 勾选触发 confirmInstance（confirmed_by 固定 platform_admin）；未确认实例生成配置前禁止由 UI 引导。
 */
export function ExporterInstallationPanel({ jobId }: ExporterInstallationPanelProps) {
  const [items, setItems] = useState<ScrapeJobInstanceItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actingId, setActingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!jobId) {
      setItems([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await scrapeJobApi.instances(jobId)
      setItems(res.data?.items ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : '安装状态加载失败')
    } finally {
      setLoading(false)
    }
  }, [jobId])

  useEffect(() => {
    // 异步请求回调内 setState；沿用本模块既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const confirm = useCallback(async (resourceId: string) => {
    setActingId(resourceId)
    try {
      await scrapeJobApi.confirmInstance(jobId, resourceId, { confirmed_by: 'platform_admin' })
      message.success('已确认安装')
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '确认失败')
    } finally {
      setActingId(null)
    }
  }, [jobId, load])

  const unconfirm = useCallback(async (resourceId: string) => {
    setActingId(resourceId)
    try {
      await scrapeJobApi.unconfirmInstance(jobId, resourceId)
      message.success('已取消确认')
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '取消失败')
    } finally {
      setActingId(null)
    }
  }, [jobId, load])

  if (!jobId) {
    return (
      <Alert
        type="info"
        showIcon
        message="保存采集任务后可进行 Exporter 安装确认"
        description="未确认的实例在生成采集配置前不允许下发（UI 引导禁止）。"
      />
    )
  }

  return (
    <Card
      size="small"
      title="Exporter 安装确认"
      extra={
        <Button type="link" size="small" icon={<ReloadOutlined />} onClick={() => void load()} disabled={loading}>
          刷新
        </Button>
      }
    >
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      {loading && !items.length ? (
        <Spin />
      ) : items.length === 0 ? (
        <Empty description="暂无已选实例" />
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          {items.map((it) => {
            const s = INSTALL_STATUS_MAP[it.status] ?? INSTALL_STATUS_MAP.unconfirmed
            return (
              <div key={it.resource_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space>
                  <Badge status={s.status} />
                  <Text>{it.instance_name}</Text>
                  <Text type="secondary">{it.instance_ip}</Text>
                </Space>
                <Space size={8}>
                  <Text type="secondary">{s.label}</Text>
                  {it.status === 'unconfirmed' ? (
                    <Button size="small" type="primary" loading={actingId === it.resource_id} onClick={() => void confirm(it.resource_id)}>
                      确认安装
                    </Button>
                  ) : (
                    <Button size="small" disabled={actingId === it.resource_id} onClick={() => void unconfirm(it.resource_id)}>
                      取消
                    </Button>
                  )}
                </Space>
              </div>
            )
          })}
        </Space>
      )}
    </Card>
  )
}

export default ExporterInstallationPanel
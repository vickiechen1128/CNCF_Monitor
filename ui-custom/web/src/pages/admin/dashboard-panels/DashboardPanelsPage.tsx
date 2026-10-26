import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Button, Card, Table } from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { dashboardPanelApi, type DashboardPanel } from '../../../api/dashboardPanels'
import { getStoredUser } from '../../../api/client'
import { EllipsisText } from '../../../components/EllipsisText'
import { MainLayout } from '../../../layouts/MainLayout'
import { DashboardPanelFormModal } from './DashboardPanelFormModal'

export function DashboardPanelsPage() {
  const [panels, setPanels] = useState<DashboardPanel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const isAdmin = getStoredUser()?.role === 'admin'

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await dashboardPanelApi.list()
      setPanels(res.data.list)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    dashboardPanelApi.list()
      .then((res) => {
        if (!cancelled) setPanels(res.data.list)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败，请稍后重试')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const columns: ColumnsType<DashboardPanel> = [
    {
      title: '面板名称',
      dataIndex: 'name',
      width: 220,
      render: (name: string) => <EllipsisText>{name}</EllipsisText>,
    },
    {
      title: 'Grafana URL',
      dataIndex: 'url',
      render: (url: string) => <EllipsisText>{url}</EllipsisText>,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 180,
      render: (value?: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—',
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_: unknown, record) => <Link to={`/dashboard/panels/${record.id}`}>查看大屏</Link>,
    },
  ]

  return (
    <MainLayout>
      <Card
        title="面板挂载"
        extra={isAdmin && (
          <Button aria-label="新增面板" type="primary" icon={<PlusOutlined />} onClick={() => setFormOpen(true)}>
            新增面板
          </Button>
        )}
      >
        {error && (
          <Alert
            type="error"
            showIcon
            message={error}
            action={<Button aria-label="重新加载" icon={<ReloadOutlined />} onClick={() => void load()}>重新加载</Button>}
            style={{ marginBottom: 16 }}
          />
        )}
        <Table
          rowKey="id"
          columns={columns}
          dataSource={panels}
          loading={loading}
          locale={{ emptyText: '暂无挂载面板' }}
          pagination={false}
          scroll={{ x: 900 }}
        />
      </Card>
      <DashboardPanelFormModal
        open={formOpen}
        onCancel={() => setFormOpen(false)}
        onSuccess={() => void load()}
      />
    </MainLayout>
  )
}

export default DashboardPanelsPage

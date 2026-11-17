import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Button, Card, Empty, Space, Table } from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { dashboardPanelApi, type DashboardPanel } from '../../../api/dashboardPanels'
import { getStoredUser } from '../../../api/client'
import { EllipsisText } from '../../../components/EllipsisText'
import { MainLayout } from '../../../layouts/MainLayout'
import { DashboardPanelFormModal } from './DashboardPanelFormModal'

/** 面板列表分页：默认 20/页（M05 PRD v1.15），后端上限 100。 */
const DEFAULT_PAGE_SIZE = 20

export function DashboardPanelsPage() {
  const [panels, setPanels] = useState<DashboardPanel[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingPanel, setEditingPanel] = useState<DashboardPanel | null>(null)
  const isAdmin = getStoredUser()?.role === 'admin'
  const requestSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    try {
      const res = await dashboardPanelApi.list({ page, page_size: pageSize })
      if (seq !== requestSeq.current) return
      setPanels(res.data.list)
      setTotal(res.data.total)
    } catch (err) {
      if (seq !== requestSeq.current) return
      setError(err instanceof Error ? err.message : '加载失败，请稍后重试')
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [page, pageSize])

  useEffect(() => {
    // 数据加载在 effect 启动；loading/error 为请求态而非可派生状态，沿用仓库既有模式。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    return () => {
      requestSeq.current += 1
    }
  }, [load])

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
      width: 180,
      render: (_: unknown, record) => (
        <Space>
          <Link to={`/dashboard/panels/${record.id}`}>查看大屏</Link>
          {isAdmin && (
            <Button type="link" onClick={() => { setEditingPanel(record); setFormOpen(true) }}>
              编辑
            </Button>
          )}
        </Space>
      ),
    },
  ]

  return (
    <MainLayout>
      <Card
        title="面板挂载"
        extra={isAdmin && (
          <Button aria-label="新增面板" type="primary" icon={<PlusOutlined />} onClick={() => { setEditingPanel(null); setFormOpen(true) }}>
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
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无挂载面板"
              >
                {isAdmin && (
                  <span style={{ color: 'rgba(0,0,0,0.45)' }}>
                    点击右上角「新增面板」登记 Grafana 大屏
                  </span>
                )}
              </Empty>
            ),
          }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50', '100'],
            showTotal: (count) => `共 ${count} 条`,
            onChange: (nextPage, nextPageSize) => {
              if (nextPageSize !== pageSize) {
                setPageSize(nextPageSize)
                setPage(1)
                return
              }
              setPage(nextPage)
            },
          }}
          scroll={{ x: 900 }}
        />
      </Card>
      <DashboardPanelFormModal
        open={formOpen}
        panel={editingPanel}
        onCancel={() => { setFormOpen(false); setEditingPanel(null) }}
        onSuccess={() => {
          // 列表按创建时间升序，新增面板落在末页：创建后跳到末页，编辑后留在当前页。
          if (editingPanel) {
            void load()
            return
          }
          const lastPage = Math.max(1, Math.ceil((total + 1) / pageSize))
          setPage(lastPage)
          if (lastPage === page) void load()
        }}
      />
    </MainLayout>
  )
}

export default DashboardPanelsPage

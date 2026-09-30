import { useCallback, useEffect, useState } from 'react'
import config from 'antd/locale/zh_CN'
import { Alert, Badge, Button, Card, ConfigProvider, Empty, Table, Tag } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { MainLayout } from '../../../layouts/MainLayout'
import { EllipsisText } from '../../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../../components/tablePresets'
import { cloudDictApi } from '../../../api/resources'
import type { CloudDict } from '../../../types/resource'

/**
 * 云类型中文映射（对齐 platform/models/cloud_dict.go：PUB/GM/IND/PRI）。
 * 仅用于本页展示列，不导出（避免 react-refresh/only-export-components 告警）。
 */
const CLOUD_TYPE_LABELS: Record<string, string> = {
  PUB: '公有云',
  GM: '政务云',
  IND: '行业云',
  PRI: '私有云',
}

/**
 * 云载体中文映射（对齐 platform/models/cloud_dict.go：TX/CU/CM）。
 * seed 佐证：GM-CU = 「政务云（联通）」→ CU=联通；TX=腾讯、CM=移动。
 */
const CARRIER_LABELS: Record<string, string> = {
  TX: '腾讯',
  CU: '联通',
  CM: '移动',
}

/**
 * 云字典只读展示页（Module_07 §5.20 / 决策 98 / 102；dev-feedback #19）。
 * - 数据源 `GET /api/v2/platform/cloud-dict`（复用 `cloudDictApi.list()`，非分页信封 `{list,total}`）。
 * - **部署级只读字典**：严禁任何增 / 删 / 改 / 启停入口，条目增删随版本发版 / 部署配置更新。
 * - `cloud_type` / `carrier` 仅作展示列（红线④）：不参与筛选、不作为查询 / 标签维度。
 * - 契约当前未含 `description`，故本页不展示描述列（如需展示须后端补字段）。
 */
export function CloudDictPage() {
  const [list, setList] = useState<CloudDict[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await cloudDictApi.list()
      setList(res.data?.list ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '云字典加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // 异步请求回调内 setState；沿用本仓库既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const columns: ColumnsType<CloudDict> = [
    {
      title: '云编码',
      dataIndex: 'cloud_code',
      key: 'cloud_code',
      fixed: 'left',
      width: 140,
      render: (v: string) => <EllipsisText>{v}</EllipsisText>,
    },
    {
      title: '云名称',
      dataIndex: 'cloud_name',
      key: 'cloud_name',
      width: 200,
      render: (v: string) => <EllipsisText>{v}</EllipsisText>,
    },
    {
      title: '云类型',
      dataIndex: 'cloud_type',
      key: 'cloud_type',
      width: 130,
      // 仅展示映射值，未收录编码回退原码（不隐藏未知值）
      render: (v: string) => <Tag>{CLOUD_TYPE_LABELS[v] ?? v}</Tag>,
    },
    {
      title: '云载体',
      dataIndex: 'carrier',
      key: 'carrier',
      width: 120,
      render: (v: string) => CARRIER_LABELS[v] ?? v,
    },
    {
      title: '启用状态',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 110,
      render: (v: boolean) =>
        v ? <Badge status="success" text="已启用" /> : <Badge status="default" text="已停用" />,
    },
  ]

  return (
    <MainLayout>
      <ConfigProvider locale={config}>
        <Card
          title="云字典"
          extra={
            <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
              刷新
            </Button>
          }
        >
          <Alert
            type="info"
            showIcon
            message="云字典为部署级只读字典，条目增删随版本发版 / 部署配置更新，不在本页维护。"
            description="云归属（cloud）是资源标签的唯一取值来源；云类型 / 云载体仅为条目描述属性，不作为筛选或标签维度。"
            style={{ marginBottom: 16 }}
          />
          {error && (
            <Alert
              type="error"
              showIcon
              message="云字典加载失败，请稍后重试"
              description={error}
              action={
                <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}>
                  重新加载
                </Button>
              }
              style={{ marginBottom: 16 }}
            />
          )}
          <Table<CloudDict>
            rowKey="cloud_code"
            dataSource={list}
            loading={loading}
            columns={columns}
            size="small"
            scroll={TABLE_SCROLL_X}
            locale={{ emptyText: <Empty description="暂无云字典条目" /> }}
            pagination={{ ...TABLE_PAGINATION }}
          />
        </Card>
      </ConfigProvider>
    </MainLayout>
  )
}

export default CloudDictPage
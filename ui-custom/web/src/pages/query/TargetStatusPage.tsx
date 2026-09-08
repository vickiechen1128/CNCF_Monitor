import { useCallback, useEffect, useState } from 'react'
import { Alert, Badge, Button, Card, Empty, Select, Table, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { MainLayout } from '../../layouts/MainLayout'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { EllipsisText } from '../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { targetsApi } from '../../api/targets'
import { networkDomainApi } from '../../api/domain'
import type { TargetHealth, TargetItem } from '../../types/query'

const { Text } = Typography

/** 采集状态展示名与色（§2.1.1 health 三枚举） */
const HEALTH_META: Record<TargetHealth, { label: string; badge: 'success' | 'error' | 'warning' }> = {
  up: { label: '在线', badge: 'success' },
  down: { label: '离线', badge: 'error' },
  unknown: { label: '未知', badge: 'warning' },
}

const HEALTH_OPTIONS: { value: TargetHealth; label: string }[] = [
  { value: 'up', label: '在线' },
  { value: 'down', label: '离线' },
  { value: 'unknown', label: '未知' },
]

/**
 * 采集目标状态页（Module_02 决策 47-4，P1 极简列表）。
 * 跨 Job 的全局排障入口：按 health / 网域过滤的 TargetItem 极简列表，
 * 非唯一状态知情入口（M01/M07 回显承担）。加载骨架 / 空态 / 错误态齐全。
 */
export function TargetStatusPage() {
  const [targets, setTargets] = useState<TargetItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [domains, setDomains] = useState<{ id: string; name: string }[]>([])
  const [health, setHealth] = useState<TargetHealth | undefined>()
  const [networkDomain, setNetworkDomain] = useState<string | undefined>()

  useEffect(() => {
    networkDomainApi
      .list({ page: 1, page_size: 100 })
      .then((res) => setDomains((res.data?.list ?? []).map((d) => ({ id: d.id, name: d.name }))))
      .catch(() => setDomains([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await targetsApi.list({
        job: undefined,
        network_domain: networkDomain,
        health,
      })
      setTargets(res.data?.activeTargets ?? [])
    } catch (e) {
      setTargets([])
      setError(e instanceof Error ? e.message : '目标状态加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [health, networkDomain])

  useEffect(() => {
    // 请求回调内完成 setState；沿用项目既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const columns: ColumnsType<TargetItem> = [
    {
      title: '采集 Job',
      dataIndex: 'job',
      key: 'job',
      render: (v?: string) => v || '-',
    },
    {
      title: '实例地址',
      dataIndex: 'instance',
      key: 'instance',
      render: (v?: string) => <Text code>{v || '-'}</Text>,
    },
    {
      title: '所属网域',
      dataIndex: 'network_domain',
      key: 'network_domain',
      render: (v?: string) => v || 'default',
    },
    {
      title: '采集状态',
      dataIndex: 'health',
      key: 'health',
      width: 120,
      render: (v?: TargetHealth) => {
        const meta = HEALTH_META[v ?? 'unknown']
        return <Badge status={meta.badge} text={meta.label} />
      },
    },
    {
      title: '最后采集时间',
      dataIndex: 'lastScrape',
      key: 'lastScrape',
      render: (v?: string) => (v ? new Date(v).toLocaleString() : '-'),
    },
    {
      title: '最后错误',
      dataIndex: 'lastError',
      key: 'lastError',
      render: (v?: string) => (v ? <EllipsisText maxWidth={260}>{v}</EllipsisText> : '-'),
    },
    {
      title: '采集耗时',
      dataIndex: 'scrapeDuration',
      key: 'scrapeDuration',
      width: 110,
      render: (v?: number) => (typeof v === 'number' ? `${v.toFixed(3)}s` : '-'),
    },
  ]

  return (
    <MainLayout>
      <Card>
        {error && (
          <Alert
            type="error"
            showIcon
            message="目标状态加载失败，请稍后重试"
            description={error}
            action={
              <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}>
                重新加载
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        )}
        <FilterBar>
          <FilterItem label="采集状态" width={200}>
            <Select
              placeholder="全部状态"
              allowClear
              style={{ width: 140 }}
              value={health}
              onChange={(v) => setHealth((v as TargetHealth) || undefined)}
              options={HEALTH_OPTIONS}
            />
          </FilterItem>
          <FilterItem label="所属网域" width={240}>
            <Select
              placeholder="全部网域"
              allowClear
              showSearch
              optionFilterProp="label"
              style={{ width: 180 }}
              value={networkDomain}
              onChange={(v) => setNetworkDomain(v as string | undefined)}
            >
              {domains.map((d) => (
                <Select.Option key={d.id} value={d.id} label={d.name}>
                  {d.name} ({d.id})
                </Select.Option>
              ))}
            </Select>
          </FilterItem>
        </FilterBar>

        <Table<TargetItem>
          rowKey={(r) => `${r.job}:${r.instance}`}
          dataSource={targets}
          loading={loading}
          columns={columns}
          size="small"
          scroll={TABLE_SCROLL_X}
          locale={{ emptyText: <Empty description="暂无采集目标" /> }}
          pagination={{
            ...TABLE_PAGINATION,
            showSizeChanger: false,
            hideOnSinglePage: true,
          }}
        />
      </Card>
    </MainLayout>
  )
}

export default TargetStatusPage
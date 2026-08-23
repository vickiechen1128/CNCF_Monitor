import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Input,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { networkDomainApi } from '../../api/domain'
import { scrapeJobApi } from '../../api/scrapeJobs'
import type { NetworkDomain } from '../../types/domain'
import type { MonitorType, ScrapeJob } from '../../types/strategy'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { EllipsisText } from '../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { CHANGE_STATUS_MAP, JOB_TYPE_MAP, MONITOR_TYPE_CASCADE, MONITOR_TYPE_MAP } from './strategyConstants'
import { useScrapeJobs } from './useScrapeJobs'
import { ScrapeJobFormDrawer } from './ScrapeJobFormDrawer'
import { aggregateJobStatus } from './jobStatus'
import { CollectorTemplatesTab } from './CollectorTemplatesTab'

const { Text } = Typography

/**
 * 采集 Job Tab 页（Module_01 §3.1/§5.4/§8/§11.1/§11.2，F3）。
 * - 网域（仅已纳管 is_monitored=true 且 status=enabled）/ 监控类型（两级级联）/ 关键字筛选，分页默认 20/页；
 * - 列：Job名 / 类型 / 网域 / 采集器 / 已选实例数 / 间隔 / 下发状态 / 状态（聚合四态）/ 参数同步 / 操作；
 * - 状态聚合四态：待下发 / 已生效 / 已停用 / 草稿（v0.2 灰显占位）；参数同步列展示 mapping_overrides.length 概览；
 * - 启停 / 删除二次确认；成功提示「变更将由 M09 生成变更单」+「前往配置变更确认」跳转；
 * - 加载骨架 / 空态「暂无采集任务」/ 错误态。
 */
function JobsTab() {
  const { data, loading, error, filters, setFilters, page, pageSize, onPageChange, onPageSizeChange, reload } =
    useScrapeJobs()
  const [domains, setDomains] = useState<NetworkDomain[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ScrapeJob | null>(null)

  // 已纳管（is_monitored=true）且非冻结（status=enabled）的网域下拉（§5.4 / §11.1）
  useEffect(() => {
    // 异步请求回调内 setState（既不阻塞也不在 effect 内同步 setState）
    networkDomainApi
      .list({ page: 1, page_size: 100 })
      .then((res) => setDomains(res.data?.list ?? []))
      .catch(() => setDomains([]))
  }, [])

  const domainById = useMemo(() => {
    const m = new Map<string, NetworkDomain>()
    domains.filter((d) => d.is_monitored && d.status === 'enabled').forEach((d) => m.set(d.id, d))
    return m
  }, [domains])

  const notifyChangeGuide = useCallback(() => {
    message.success('变更将由 M09 生成变更单并下发')
  }, [])

  const toggleEnabled = useCallback(async (job: ScrapeJob, enabled: boolean) => {
    try {
      await scrapeJobApi.update(job.id, {
        job_name: job.job_name,
        network_domain_id: job.network_domain_id,
        job_type: job.job_type,
        ...(job.monitor_type ? { monitor_type: job.monitor_type as MonitorType } : {}),
        enabled,
      })
      notifyChangeGuide()
      reload()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败，请稍后重试')
    }
  }, [notifyChangeGuide, reload])

  const removeJob = useCallback(async (job: ScrapeJob) => {
    try {
      await scrapeJobApi.remove(job.id)
      notifyChangeGuide()
      reload()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败，请稍后重试')
    }
  }, [notifyChangeGuide, reload])

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }
  const openEdit = (record: ScrapeJob) => {
    setEditing(record)
    setFormOpen(true)
  }

  const columns: ColumnsType<ScrapeJob> = [
    {
      title: 'Job 名称',
      dataIndex: 'job_name',
      key: 'job_name',
      fixed: 'left',
      width: 220,
      render: (v: string) => <EllipsisText>{v}</EllipsisText>,
    },
    {
      title: '类型',
      dataIndex: 'job_type',
      key: 'job_type',
      width: 90,
      render: (v: string) => <EllipsisText>{JOB_TYPE_MAP[v] ?? v}</EllipsisText>,
    },
    {
      title: '网域',
      dataIndex: 'network_domain_id',
      key: 'network_domain_id',
      width: 160,
      render: (v: string) => <EllipsisText>{domainById.get(v)?.name ?? v}</EllipsisText>,
    },
    {
      title: '监控类型',
      dataIndex: 'monitor_type',
      key: 'monitor_type',
      width: 140,
      render: (v?: string) => (v ? MONITOR_TYPE_MAP[v as keyof typeof MONITOR_TYPE_MAP] ?? v : '-'),
    },
    {
      title: '采集器',
      dataIndex: 'exporter_template_id',
      key: 'exporter_template_id',
      width: 160,
      render: (v?: string) => (v ? <EllipsisText>{v}</EllipsisText> : '-'),
    },
    {
      title: '已选实例',
      dataIndex: 'selected_instance_ids',
      key: 'selected_instance_ids',
      width: 100,
      render: (v?: string[]) => v?.length ?? 0,
    },
    { title: '间隔', dataIndex: 'scrape_interval', key: 'scrape_interval', width: 90, render: (v?: string) => v || '-' },
    {
      title: '下发状态',
      dataIndex: 'change_status',
      key: 'change_status',
      width: 100,
      render: (v: string) => CHANGE_STATUS_MAP[v] ?? v,
    },
    {
      title: '状态',
      key: 'status',
      width: 100,
      render: (_: unknown, r: ScrapeJob) => {
        const s = aggregateJobStatus(r)
        return (
          <Badge
            status={s.badgeStatus}
            text={<Text type={s.disabled ? 'secondary' : undefined}>{s.label}</Text>}
          />
        )
      },
    },
    {
      title: '参数同步',
      key: 'params',
      width: 110,
      render: (_: unknown, r: ScrapeJob) => {
        const n = r.mapping_overrides?.length ?? 0
        return n > 0 ? <Tag color="blue">已覆盖 {n} 项</Tag> : <Text type="secondary">同步</Text>
      },
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 160,
      render: (_: unknown, r: ScrapeJob) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => openEdit(r)}>
            编辑
          </Button>
          <Tooltip title={r.enabled ? '点击停用' : '点击启用'}>
            <Switch
              size="small"
              checked={r.enabled}
              onChange={(checked) => void toggleEnabled(r, checked)}
              aria-label="启停"
            />
          </Tooltip>
          <Popconfirm
            title="删除采集任务"
            description="删除后该任务将不再下发配置，确定删除？"
            okText="删除"
            cancelText="取消"
            onConfirm={() => void removeJob(r)}
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <Card
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={reload}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增采集任务
          </Button>
        </Space>
      }
    >
      {error && (
        <Alert
          type="error"
          showIcon
          message="采集任务加载失败，请稍后重试"
          description={error}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={reload}>
              重新加载
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      )}
      <FilterBar>
        <FilterItem label="网域" width={230}>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="全部网域（已纳管）"
            style={{ width: 190 }}
            value={filters.network_domain_id}
            onChange={(v) => setFilters({ ...filters, network_domain_id: v ?? undefined, keyword: filters.keyword })}
          >
            {[...domainById.values()].map((d) => (
              <Select.Option key={d.id} value={d.id} label={d.name}>
                {d.name}
              </Select.Option>
            ))}
          </Select>
        </FilterItem>
        <FilterItem label="监控类型" width={220}>
          <Select
            allowClear
            placeholder="全部监控类型"
            style={{ width: 180 }}
            value={filters.monitor_type}
            onChange={(v) => setFilters({ ...filters, monitor_type: v as never ?? undefined })}
          >
            {MONITOR_TYPE_CASCADE.map((g) =>
              g.types.map((t) => (
                <Select.Option key={t} value={t}>
                  {MONITOR_TYPE_MAP[t]}
                </Select.Option>
              )),
            )}
          </Select>
        </FilterItem>
        <FilterItem label="关键字" width={260}>
          <Input.Search
            allowClear
            placeholder="搜索 Job 名称"
            style={{ width: 220 }}
            value={filters.keyword}
            onSearch={(v) => setFilters({ ...filters, keyword: v || undefined })}
          />
        </FilterItem>
      </FilterBar>

      <Table<ScrapeJob>
        rowKey="id"
        dataSource={data.list}
        loading={loading}
        columns={columns}
        size="small"
        scroll={TABLE_SCROLL_X}
        locale={{ emptyText: <Empty description="暂无采集任务" /> }}
        pagination={{
          ...TABLE_PAGINATION,
          current: page,
          pageSize,
          total: data.total,
          onChange: onPageChange,
          onShowSizeChange: onPageSizeChange,
        }}
      />

      <ScrapeJobFormDrawer
        open={formOpen}
        record={editing}
        onCancel={() => setFormOpen(false)}
        onSuccess={() => {
          setFormOpen(false)
          reload()
        }}
      />
    </Card>
  )
}

/**
 * 采集 Job 页（F8 挂载）：承载「采集 Job」与「采集器管理」两个 Tab。
 * 默认展示采集 Job；`?tab=collectors` 直达采集器管理（F2 不独立导航）。
 */
export function ScrapeJobListPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') === 'collectors' ? 'collectors' : 'jobs'

  const handleTabChange = (key: string) => {
    if (key === 'collectors') setSearchParams({ tab: 'collectors' })
    else setSearchParams({})
  }

  return (
    <Tabs
      activeKey={activeTab}
      onChange={handleTabChange}
      items={[
        { key: 'jobs', label: '采集 Job', children: <JobsTab /> },
        { key: 'collectors', label: '采集器管理', children: <CollectorTemplatesTab /> },
      ]}
    />
  )
}

export default ScrapeJobListPage
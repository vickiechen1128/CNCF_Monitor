/**
 * 采集任务列表（M01，SRS JG v1.3）。
 *
 * 用户只认识「采集任务」：一行一个任务，任务类型为采集 / 拨测；跨域由系统按实例所属网域
 * 自动落成多份域级配置（`job_group_id` 为内部字段，界面不出现「任务组 / 未分组」）。
 * 列表为单视图：跨域任务展示「覆盖网域」聚合，展开为逐域子任务。
 */
import { useCallback, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  ConfigProvider,
  Empty,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import config from 'antd/locale/zh_CN'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Navigate, useLocation } from 'react-router-dom'
import type { ColumnsType } from 'antd/es/table'
import { MainLayout } from '../../layouts/MainLayout'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { jobGroupApi } from '../../api/jobGroups'
import { scrapeJobApi } from '../../api/scrapeJobs'
import type { JobGroup, JobGroupChild } from '../../types/jobGroup'
import type { JobType, MonitorType, ScrapeJob } from '../../types/strategy'
import type { ScrapeJobV3 } from '../../types/strategyV3'
import { useScrapeJobs } from './useScrapeJobs'
import { useJobScrapeStatus } from './useJobScrapeStatus'
import { JOB_TYPE_MAP, MONITOR_TYPE_MAP, MONITOR_TYPE_CASCADE } from './strategyConstants'
import SyncStatusTag from './SyncStatusTag'
import { ScrapeJobFormDrawer } from './ScrapeJobFormDrawer'
import { ScrapeJobDetailDrawer } from './ScrapeJobDetailDrawer'
import { JobGroupWizardDrawer } from './JobGroupWizardDrawer'
import { JobGroupDetailDrawer } from './JobGroupDetailDrawer'

const { Text } = Typography

/** 列表行：一个采集任务（跨域任务 = 组；单域任务 = 无组 Job） */
type TaskRow =
  | { kind: 'group'; key: string; group: JobGroup }
  | { kind: 'job'; key: string; job: ScrapeJob }

const SYNC_LABEL: Record<string, { text: string; color: string }> = {
  synced: { text: '已同步', color: 'success' },
  pending: { text: '待同步', color: 'processing' },
  syncing: { text: '同步中', color: 'processing' },
  failed: { text: '同步失败', color: 'error' },
  draft: { text: '草稿', color: 'default' },
  disabled: { text: '已停用', color: 'default' },
}

/** 把后端组视图的子任务投影成 Job（用于采集状态聚合与展开行） */
function childJob(child: JobGroupChild): ScrapeJob | null {
  const job = child.job as ScrapeJobV3 | undefined
  if (!job) return null
  return {
    ...(job as unknown as ScrapeJob),
    job_group_id: job.job_group_id,
    job_group_name: job.job_group_name,
  }
}

export function ScrapeJobListPage() {
  const location = useLocation()
  // 兼容旧外链：`/scrape-jobs?tab=collectors` → 采集器管理独立页
  if (new URLSearchParams(location.search).get('tab') === 'collectors') {
    return <Navigate to="/collectors" replace />
  }
  return (
    <MainLayout>
      <JobsTab />
    </MainLayout>
  )
}

function JobsTab() {
  const [keyword, setKeyword] = useState('')
  const [monitorType, setMonitorType] = useState<MonitorType | undefined>()
  const [jobType, setJobType] = useState<JobType | undefined>()
  const [domainFilter, setDomainFilter] = useState<string | undefined>()
  const [groupsPage, setGroupsPage] = useState(1)
  const [groups, setGroups] = useState<JobGroup[]>([])
  const [groupsTotal, setGroupsTotal] = useState(0)
  const [groupsLoading, setGroupsLoading] = useState(true)
  const [groupsError, setGroupsError] = useState<string | null>(null)

  // 单域任务（无内部承载）：与跨域任务同表展示
  const {
    data: jobData,
    loading: jobsLoading,
    error: jobsError,
    reload: reloadJobs,
    page: jobsPage,
    pageSize,
    onPageChange: onJobsPageChange,
  } = useScrapeJobs({ ungrouped: true, keyword: keyword || undefined, monitor_type: monitorType, job_type: jobType, network_domain_id: domainFilter })

  const loadGroups = useCallback(() => {
    setGroupsLoading(true)
    setGroupsError(null)
    jobGroupApi
      .list({ keyword: keyword || undefined, page: groupsPage, page_size: 20 })
      .then((res) => {
        setGroups(res.data.list ?? [])
        setGroupsTotal(res.data.total ?? 0)
      })
      .catch((err) => setGroupsError(err instanceof Error ? err.message : '任务加载失败'))
      .finally(() => setGroupsLoading(false))
  }, [keyword, groupsPage])

  // 首屏与筛选变化时拉取组（单域任务由 hook 自行触发）
  const renderedKey = `${keyword}|${groupsPage}`
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  if (loadedKey !== renderedKey) {
    setLoadedKey(renderedKey)
    loadGroups()
  }

  const reload = useCallback(() => {
    setGroupsPage(1)
    loadGroups()
    reloadJobs()
  }, [loadGroups, reloadJobs])

  const [wizardOpen, setWizardOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<JobGroup | null>(null)
  const [adoptJobID, setAdoptJobID] = useState<string | null>(null)
  const [detailGroup, setDetailGroup] = useState<JobGroup | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingJob, setEditingJob] = useState<ScrapeJob | null>(null)
  const [viewing, setViewing] = useState<ScrapeJob | null>(null)

  // 采集状态聚合：跨域任务的子任务 + 单域任务
  const statusJobs = useMemo<ScrapeJob[]>(() => {
    const children = groups.flatMap((group) =>
      group.domains.map((child) => childJob(child)).filter((job): job is ScrapeJob => Boolean(job)),
    )
    return [...jobData.list, ...children]
  }, [groups, jobData.list])
  const scrapeStatusByJob = useJobScrapeStatus(statusJobs)

  const rows: TaskRow[] = useMemo(
    () => [
      ...groups.map((group) => ({ kind: 'group' as const, key: `group:${group.id}`, group })),
      ...jobData.list.map((job) => ({ kind: 'job' as const, key: `job:${job.id}`, job })),
    ],
    [groups, jobData.list],
  )

  const total = groupsTotal + jobData.total
  const loading = groupsLoading || jobsLoading
  const error = groupsError ?? jobsError ?? null

  const openCreate = () => {
    setEditingGroup(null)
    setAdoptJobID(null)
    setWizardOpen(true)
  }
  const openGroupEdit = (group: JobGroup) => {
    setEditingGroup(group)
    setAdoptJobID(null)
    setWizardOpen(true)
  }
  /** 单域任务编辑：跨域保存时由后端晋升（复用原 Job 行） */
  const openJobEdit = (job: ScrapeJob) => {
    setEditingGroup({
      id: '',
      name: job.job_name,
      job_name: job.job_name,
      job_type: job.job_type,
      resource_category: (job.resource_category ?? 'host') as JobGroup['resource_category'],
      monitor_type: job.monitor_type,
      blackbox_module: job.blackbox_module,
      scrape_interval: job.scrape_interval,
      scrape_timeout: job.scrape_timeout,
      metrics_path: job.metrics_path,
      scheme: job.scheme,
      status: job.enabled ? 'enabled' : 'disabled',
      created_by: '',
      created_at: job.created_at,
      updated_at: job.updated_at,
      domains: [],
      sync: { status: job.sync?.status ?? 'draft', total: 1, synced: 0, failed: 0, pending: 0, draft: 0 },
    })
    setAdoptJobID(job.id)
    setWizardOpen(true)
  }

  const removeGroup = async (group: JobGroup) => {
    try {
      await jobGroupApi.remove(group.id)
      message.success(`已删除任务「${group.name}」`)
      setDetailGroup(null)
      reload()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败')
    }
  }
  const removeJob = async (job: ScrapeJob) => {
    try {
      await scrapeJobApi.remove(job.id)
      message.success('已删除任务')
      reload()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  const toggleEnabled = async (job: ScrapeJob, enabled: boolean) => {
    try {
      await scrapeJobApi.update(job.id, {
        ...job,
        enabled,
        resource_category: job.resource_category as never,
      } as never)
      reload()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败')
    }
  }

  const syncTag = (status: string) => {
    const meta = SYNC_LABEL[status] ?? { text: status, color: 'default' }
    return <Tag color={meta.color}>{meta.text}</Tag>
  }

  const columns: ColumnsType<TaskRow> = [
    {
      title: '任务名',
      key: 'name',
      fixed: 'left',
      width: 220,
      render: (_: unknown, row: TaskRow) =>
        row.kind === 'group' ? (
          <div>
            <div>{row.group.name}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {row.group.job_name}
            </Text>
          </div>
        ) : (
          <div>
            <div>{row.job.job_name}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              单域任务
            </Text>
          </div>
        ),
    },
    {
      title: '类型',
      key: 'job_type',
      width: 90,
      render: (_: unknown, row: TaskRow) => {
        const type = row.kind === 'group' ? row.group.job_type : row.job.job_type
        return JOB_TYPE_MAP[type] ?? type
      },
    },
    {
      title: '覆盖网域',
      key: 'domains',
      width: 220,
      render: (_: unknown, row: TaskRow) => {
        if (row.kind === 'job') return row.job.network_domain_name || row.job.network_domain_id
        const names = row.group.domains.map((child) => child.network_domain_name)
        return (
          <Space size={4} wrap>
            <Tag color="blue">{names.length} 个网域</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {names.join(' / ')}
            </Text>
          </Space>
        )
      },
    },
    {
      title: '监控类型',
      key: 'monitor_type',
      width: 140,
      render: (_: unknown, row: TaskRow) => {
        const value = row.kind === 'group' ? row.group.monitor_type : row.job.monitor_type
        if (!value) return row.kind === 'group' && row.group.blackbox_module ? row.group.blackbox_module : '-'
        return MONITOR_TYPE_MAP[value as keyof typeof MONITOR_TYPE_MAP] ?? value
      },
    },
    {
      title: '已选实例',
      key: 'instances',
      width: 100,
      render: (_: unknown, row: TaskRow) =>
        row.kind === 'group'
          ? row.group.domains.reduce((sum, child) => sum + child.instance_count, 0)
          : (row.job.selected_instance_ids?.length ?? 0),
    },
    {
      title: '实例采集状态',
      key: 'collection',
      width: 180,
      render: (_: unknown, row: TaskRow) => {
        if (row.kind === 'group') {
          const views = row.group.domains
            .map((child) => (child.job ? scrapeStatusByJob[child.job.id] : undefined))
            .filter(Boolean) as { online: number; total: number; down: number; pending: number }[]
          if (views.length === 0) return <Text type="secondary">-</Text>
          const online = views.reduce((sum, view) => sum + view.online, 0)
          const count = views.reduce((sum, view) => sum + view.total, 0)
          const bad = views.some((view) => view.down > 0 || view.pending > 0)
          return <Tag color={bad ? 'error' : 'green'}>{`在线 ${online} / 总数 ${count}`}</Tag>
        }
        const view = scrapeStatusByJob[row.job.id]
        if (!view) return <Text type="secondary">-</Text>
        const bad = view.down > 0 || view.pending > 0
        return <Tag color={bad ? 'error' : 'green'}>{`在线 ${view.online} / 总数 ${view.total}`}</Tag>
      },
    },
    {
      title: '间隔',
      key: 'interval',
      width: 90,
      render: (_: unknown, row: TaskRow) =>
        row.kind === 'group' ? row.group.scrape_interval : row.job.scrape_interval || '-',
    },
    {
      title: '启用状态',
      key: 'enabled',
      width: 100,
      render: (_: unknown, row: TaskRow) => {
        const enabled = row.kind === 'group' ? row.group.status === 'enabled' : row.job.enabled
        return <Tag color={enabled ? 'green' : 'default'}>{enabled ? '已启用' : '已停用'}</Tag>
      },
    },
    {
      title: '同步状态',
      key: 'sync',
      width: 150,
      render: (_: unknown, row: TaskRow) => {
        if (row.kind === 'group') {
          return (
            <Space direction="vertical" size={0}>
              {syncTag(row.group.sync.status)}
              <Text type="secondary" style={{ fontSize: 12 }}>
                成功 {row.group.sync.synced} / 失败 {row.group.sync.failed} / 共 {row.group.sync.total}
              </Text>
            </Space>
          )
        }
        return <SyncStatusTag sync={row.job.sync} draftStatus={row.job.draft_status} enabled={row.job.enabled} />
      },
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 200,
      render: (_: unknown, row: TaskRow) =>
        row.kind === 'group' ? (
          <Space size={0}>
            <Button type="link" size="small" onClick={() => setDetailGroup(row.group)}>
              详情
            </Button>
            <Button type="link" size="small" onClick={() => openGroupEdit(row.group)}>
              编辑
            </Button>
            <Popconfirm
              title={`删除任务「${row.group.name}」？`}
              description="其域级子任务将一并删除，M09 会停止对这些网域的采集。"
              okText="删除"
              okButtonProps={{ danger: true }}
              onConfirm={() => void removeGroup(row.group)}
            >
              <Button type="link" size="small" danger>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ) : (
          <Space size={0}>
            <Button type="link" size="small" onClick={() => setViewing(row.job)}>
              查看
            </Button>
            <Button type="link" size="small" onClick={() => openJobEdit(row.job)}>
              编辑
            </Button>
            <Tooltip title="映射默认值 / 采集器登记 / 安装确认等高级能力">
              <Button
                type="link"
                size="small"
                onClick={() => {
                  setEditingJob(row.job)
                  setFormOpen(true)
                }}
              >
                高级
              </Button>
            </Tooltip>
            <Button
              type="link"
              size="small"
              danger={row.job.enabled}
              onClick={() => void toggleEnabled(row.job, !row.job.enabled)}
            >
              {row.job.enabled ? '停用' : '启用'}
            </Button>
            <Popconfirm title="删除采集任务" okText="删除" onConfirm={() => void removeJob(row.job)}>
              <Button type="link" size="small" danger>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ),
    },
  ]

  return (
    <ConfigProvider locale={config}>
      <Card
        title="采集任务"
        extra={
          <Space>
            <Input.Search
              placeholder="按任务名 / 域名搜索"
              allowClear
              style={{ width: 220 }}
              onSearch={(value) => {
                setKeyword(value)
                setGroupsPage(1)
              }}
            />
            <Button icon={<ReloadOutlined />} onClick={reload}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建采集任务
            </Button>
          </Space>
        }
      >
        {error && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="任务加载失败"
            description={error}
            action={
              <Button size="small" onClick={reload}>
                重新加载
              </Button>
            }
          />
        )}
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="一个任务可覆盖多个网域：选择实例后由系统按实例所属网域自动下发，无需先选网域。"
        />
        <FilterBar>
          <FilterItem label="任务类型" width={160}>
            <Select
              allowClear
              placeholder="全部类型"
              style={{ width: 140 }}
              value={jobType}
              onChange={(value) => setJobType(value as JobType | undefined)}
              options={[
                { value: 'standard', label: '采集' },
                { value: 'blackbox', label: '拨测' },
              ]}
            />
          </FilterItem>
          <FilterItem label="监控类型" width={200}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="全部监控类型"
              style={{ width: 180 }}
              value={monitorType}
              onChange={(value) => setMonitorType(value as MonitorType | undefined)}
              options={MONITOR_TYPE_CASCADE.flatMap((item) =>
                item.types.map((type) => ({ value: type, label: MONITOR_TYPE_MAP[type] })),
              )}
            />
          </FilterItem>
          <FilterItem label="网域" width={180}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="全部网域"
              style={{ width: 160 }}
              value={domainFilter}
              onChange={(value) => setDomainFilter(value as string | undefined)}
              options={(jobData.list ?? []).map((job) => ({
                value: job.network_domain_id,
                label: job.network_domain_name || job.network_domain_id,
              }))}
            />
          </FilterItem>
        </FilterBar>

        <Table<TaskRow>
          rowKey="key"
          loading={loading}
          dataSource={rows}
          columns={columns}
          scroll={TABLE_SCROLL_X}
          expandable={{
            rowExpandable: (row) => row.kind === 'group' && row.group.domains.length > 0,
            expandedRowRender: (row) =>
              row.kind === 'group' ? (
                <Table<JobGroupChild>
                  rowKey="job_id"
                  size="small"
                  pagination={false}
                  dataSource={row.group.domains}
                  columns={[
                    { title: '所属网域', dataIndex: 'network_domain_name', key: 'network_domain_name', width: 160 },
                    { title: '实例数', dataIndex: 'instance_count', key: 'instance_count', width: 90 },
                    {
                      title: '采集状态',
                      key: 'collection',
                      width: 160,
                      render: (_: unknown, child: JobGroupChild) => {
                        const view = child.job ? scrapeStatusByJob[child.job.id] : undefined
                        if (!view) return <Text type="secondary">-</Text>
                        const bad = view.down > 0 || view.pending > 0
                        return (
                          <Tag color={bad ? 'error' : 'green'}>{`在线 ${view.online} / 总数 ${view.total}`}</Tag>
                        )
                      },
                    },
                    {
                      title: '同步状态',
                      dataIndex: 'sync_status',
                      key: 'sync_status',
                      width: 120,
                      render: (status: string) => syncTag(status),
                    },
                    { title: '失败原因', dataIndex: 'sync_error', key: 'sync_error', render: (v: string) => v || '-' },
                  ]}
                />
              ) : null,
          }}
          pagination={{
            ...TABLE_PAGINATION,
            current: groupsPage,
            pageSize,
            total,
            onChange: (nextPage) => {
              setGroupsPage(nextPage)
              onJobsPageChange(nextPage)
            },
          }}
          locale={{
            emptyText: <Empty description="还没有采集任务，点击右上角「新建采集任务」" />,
          }}
        />
        {jobsPage !== groupsPage && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            单域任务当前第 {jobsPage} 页
          </Text>
        )}
      </Card>

      <JobGroupDetailDrawer
        open={Boolean(detailGroup)}
        group={detailGroup}
        onClose={() => setDetailGroup(null)}
        onEdit={(group) => {
          setDetailGroup(null)
          openGroupEdit(group)
        }}
        onDelete={(group) => void removeGroup(group)}
      />

      <JobGroupWizardDrawer
        open={wizardOpen}
        record={editingGroup}
        adoptJobId={adoptJobID}
        onClose={() => {
          setWizardOpen(false)
          setEditingGroup(null)
          setAdoptJobID(null)
        }}
        onSaved={reload}
      />

      <ScrapeJobFormDrawer
        open={formOpen}
        record={editingJob}
        onCancel={() => setFormOpen(false)}
        onSuccess={() => {
          setFormOpen(false)
          reload()
        }}
      />

      <ScrapeJobDetailDrawer
        open={Boolean(viewing)}
        job={viewing}
        onClose={() => setViewing(null)}
        resolveDomainName={(id) => {
          const job = jobData.list.find((item) => item.network_domain_id === id)
          return job?.network_domain_name ?? id
        }}
        resolveTemplateName={(ref) => {
          const job = jobData.list.find((item) => String(item.exporter_template_id) === String(ref))
          return job?.exporter_template_name ?? String(ref)
        }}
        resolveLabelTemplateName={(id) => {
          const job = jobData.list.find((item) => String(item.label_template_id) === String(id))
          return job?.label_template_name ?? String(id)
        }}
        getDefaultMapping={() => undefined}
      />
    </ConfigProvider>
  )
}

export default ScrapeJobListPage

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Key } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
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
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { InfoCircleOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType, TableRowSelection } from 'antd/es/table/interface'
import { networkDomainApi } from '../../api/domain'
import { scrapeJobApi } from '../../api/scrapeJobs'
import { exporterTemplateApi } from '../../api/exporterTemplates'
import { labelTemplateApi } from '../../api/labelTemplates'
import { ciExporterMappingApi } from '../../api/ciExporterMappings'
import type { NetworkDomain } from '../../types/domain'
import type { CITypeExporterMapping, ExporterTemplate, MonitorType, ScrapeJob } from '../../types/strategy'
import type { LabelTemplateListItem } from '../../types/label'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { EllipsisText } from '../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { MainLayout } from '../../layouts/MainLayout'
import { JOB_TYPE_MAP, MONITOR_TYPE_CASCADE, MONITOR_TYPE_MAP } from './strategyConstants'
import { useScrapeJobs } from './useScrapeJobs'
import { useJobScrapeStatus } from './useJobScrapeStatus'
import { ScrapeJobFormDrawer } from './ScrapeJobFormDrawer'
import { ScrapeJobDetailDrawer } from './ScrapeJobDetailDrawer'
import { aggregateJobStatus } from './jobStatus'

const { Text } = Typography

/**
 * 变更进度（M09 管线追踪视角，Module_01 §9），回答「它挂在变更单的哪一环」。
 * 与「生效状态」列共用底层 change_status，但用 M09 管线词表呈现，避免两列文案撞车。
 */
const CHANGE_PROGRESS_MAP: Record<string, string> = {
  none: '无变更',
  pending: '待确认',
  confirmed: '已确认待下发',
  deployed: '已下发',
}

/**
 * 采集 Job Tab 页（Module_01 §3.1/§5.4/§8/§11.1/§11.2，F3）。
 * - 网域（仅已纳管 is_monitored=true 且 status=enabled）/ 监控类型（两级级联）/ 关键字筛选，分页默认 20/页；
 * - 列：Job名 / 类型 / 网域 / 采集器 / 已选实例数 / 间隔 / 变更进度 / 生效状态 / 参数同步 / 操作；
 * - 「生效状态」= 用户视角生命周期（草稿 / 待生效（原待下发）/ 已生效 / 已停用）；「变更进度」= M09 管线视角
 *   （待确认 / 已确认待下发 / 已下发 / 无变更）；参数同步列展示 mapping_overrides.length 概览；
 * - 启停 / 删除二次确认；成功提示「变更将由 M09 生成变更单」+「前往配置变更确认」跳转；
 * - 加载骨架 / 空态「暂无采集任务」/ 错误态。
 */
function JobsTab() {
  const { data, loading, error, filters, setFilters, page, pageSize, onPageChange, onPageSizeChange, reload } =
    useScrapeJobs()
  const [domains, setDomains] = useState<NetworkDomain[]>([])
  const [templates, setTemplates] = useState<ExporterTemplate[]>([])
  const [labelTemplates, setLabelTemplates] = useState<LabelTemplateListItem[]>([])
  const [defaultMappings, setDefaultMappings] = useState<CITypeExporterMapping[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ScrapeJob | null>(null)
  // 决策 47-2 Job 实例级下钻：『查看』抽屉展示该 Job 各实例/目标的具体采集状态
  const [viewing, setViewing] = useState<ScrapeJob | null>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  // 决策 47-2 per-job 形态：按当前页 Job 聚合「实例采集状态」（在线/待采集/已下发未采到），约 20s 自动刷新
  const scrapeStatusByJob = useJobScrapeStatus(data.list)

  // 已纳管（is_monitored=true）且非冻结（status=enabled）的网域下拉（§5.4 / §11.1）
  useEffect(() => {
    // 异步请求回调内 setState（既不阻塞也不在 effect 内同步 setState）
    networkDomainApi
      .list({ page: 1, page_size: 100 })
      .then((res) => setDomains(res.data?.list ?? []))
      .catch(() => setDomains([]))
  }, [])

  // 采集器模板 / 标签模板 / 默认映射快照：F1-1 采集器列反查名称、标签模板列渲染；F1-2 参数同步三态对比
  useEffect(() => {
    Promise.all([
      exporterTemplateApi.list({ page: 1, page_size: 100 }),
      labelTemplateApi.list({ page: 1, page_size: 100 }),
      ciExporterMappingApi.list({ is_default: true, page: 1, page_size: 100 }),
    ])
      .then(([tmplRes, labelRes, mapRes]) => {
        setTemplates(tmplRes.data?.list ?? [])
        setLabelTemplates(labelRes.data?.list ?? [])
        setDefaultMappings(mapRes.data?.list ?? [])
      })
      .catch(() => {
        setTemplates([])
        setLabelTemplates([])
        setDefaultMappings([])
      })
  }, [])

  const domainById = useMemo(() => {
    const m = new Map<string, NetworkDomain>()
    domains.filter((d) => d.is_monitored && d.status === 'enabled').forEach((d) => m.set(d.id, d))
    return m
  }, [domains])

  // 采集器模板按「数字 id / 名称」双重索引，兼容 job.exporter_template_id 为 id 或名称两种口径（F1-1）
  const templateByRef = useMemo(() => {
    const m = new Map<string, ExporterTemplate>()
    templates.forEach((t) => {
      m.set(String(t.id), t)
      m.set(t.name, t)
    })
    return m
  }, [templates])

  // 标签模板按 id 索引（F1-1）
  const labelTemplateById = useMemo(() => {
    const m = new Map<string, LabelTemplateListItem>()
    labelTemplates.forEach((t) => m.set(String(t.id), t))
    return m
  }, [labelTemplates])

  // 默认映射快照按 monitor_type 索引（F1-2 参数同步「异常驱动」对比基线）
  const defaultMappingByMonitorType = useMemo(() => {
    const m = new Map<string, CITypeExporterMapping>()
    defaultMappings.filter((d) => d.is_default).forEach((d) => m.set(d.monitor_type, d))
    return m
  }, [defaultMappings])

  // 补配跳转占位（Job 列表侧「待配置」入口；实际维护在采集器默认配置/M07）
  const openLabelTemplateGuide = useCallback(() => {
    message.info('标签模板补配请前往「采集器默认配置」维护（M07）')
  }, [])

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

  const batchSubmitReady = useCallback(async () => {
    if (selectedRowKeys.length === 0) return
    try {
      await scrapeJobApi.batchSubmitReady({ ids: selectedRowKeys as number[] })
      message.success('已批量提交生效')
      setSelectedRowKeys([])
      reload()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '批量提交生效失败，请稍后重试')
    }
  }, [selectedRowKeys, reload])

  const rowSelection = useMemo<TableRowSelection<ScrapeJob>>(
    () => ({
      selectedRowKeys,
      onChange: (newSelectedRowKeys) => {
        setSelectedRowKeys(newSelectedRowKeys)
      },
      preserveSelectedRowKeys: true,
    }),
    [selectedRowKeys],
  )

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
      // F1-1：按 exporter_template_id 反查真实模板名（id/名称双重索引）；blackbox 显拨测模块；
      // 查不到才回退「默认采集器」占位，禁止裸露 ID
      render: (_: unknown, r: ScrapeJob) => {
        if (r.job_type === 'blackbox') return r.blackbox_module ? <EllipsisText>{r.blackbox_module}</EllipsisText> : '-'
        const ref = r.exporter_template_id
        if (!ref) return '-'
        const tmpl = templateByRef.get(String(ref))
        return tmpl ? <EllipsisText>{tmpl.name}</EllipsisText> : <EllipsisText>默认采集器</EllipsisText>
      },
    },
    {
      title: '标签模板',
      key: 'label_template',
      width: 140,
      // O1/T01-F14：异常驱动。正常继承（job.label_template_id 命中）→ 只显模板名，不显「待配置」Tag；
      // 仅当 job 未关联标签模板、但该 monitor_type 的默认映射已挂 label_template_id（有默认标签待补配）时，
      // 显橙色「待配置」Tag（可点击补配引导）；其余 → '-'
      render: (_: unknown, r: ScrapeJob) => {
        const ref = r.label_template_id
        if (ref) {
          const t = labelTemplateById.get(String(ref))
          return <EllipsisText>{t?.name ?? '标签模板'}</EllipsisText>
        }
        const def = r.monitor_type ? defaultMappingByMonitorType.get(String(r.monitor_type)) : undefined
        if (def?.label_template_id) {
          return (
            <Tag color="orange" onClick={openLabelTemplateGuide} style={{ cursor: 'pointer' }}>
              待配置
            </Tag>
          )
        }
        return '-'
      },
    },
    {
      title: '已选实例',
      dataIndex: 'selected_instance_ids',
      key: 'selected_instance_ids',
      width: 100,
      render: (v?: string[]) => v?.length ?? 0,
    },
    {
      // 决策 47-2：实例采集状态列对齐原型。
      // 数据源 = M02 targets 聚合（useJobScrapeStatus 只读消费 /api/v1/targets 按 job 过滤，约 20s 自动刷新）；
      // 存在「待采集 / 已下发未采到」实例时整格高饱和红；整格（Tag）可点击进入 Job 详情查看各实例具体原因。
      title: (
        <Tooltip title="在线实例数 / 已选实例总数（数据由「查询中心」M02 按 Job 回显，本模块只读，约 20s 自动刷新）；存在未在线实例时整格高亮，点击查看详情原因">
          <Space size={4}>
            实例采集状态
            <InfoCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
          </Space>
        </Tooltip>
      ),
      key: 'collection_status',
      width: 190,
      render: (_: unknown, r: ScrapeJob) => {
        // blackbox 拨测 Job 无实例维度采集状态；未选任何实例时显示 '-'
        if (r.job_type === 'blackbox') return <Text type="secondary">-</Text>
        const total = r.selected_instance_ids.length
        if (total === 0) return <Text type="secondary">-</Text>
        const v = scrapeStatusByJob[r.id]
        if (!v) return <Spin size="small" />
        const anomaly = v.down > 0 || v.pending > 0
        const onClick = () => setViewing(r)
        const text = `在线 ${v.online} / 总数 ${total}`
        return anomaly ? (
          <Tooltip title="存在「待采集 / 已下发未采到」实例，点击查看详情确认失败原因">
            <Tag
              color="#FF4C3A"
              style={{ marginInlineEnd: 0, cursor: 'pointer', fontWeight: 500 }}
              onClick={onClick}
            >
              {text}
            </Tag>
          </Tooltip>
        ) : (
          <Tooltip title="点击查看各实例采集状态详情">
            <Tag color="green" style={{ marginInlineEnd: 0, cursor: 'pointer' }} onClick={onClick}>
              {text}
            </Tag>
          </Tooltip>
        )
      },
    },
    { title: '间隔', dataIndex: 'scrape_interval', key: 'scrape_interval', width: 90, render: (v?: string) => v || '-' },
    {
      title: '变更进度',
      dataIndex: 'change_status',
      key: 'change_status',
      width: 110,
      render: (v: string) => CHANGE_PROGRESS_MAP[v] ?? v,
    },
    {
      title: '生效状态',
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
      // F1-2：三态回显（异常驱动）。优先按持久化 mapping_overrides（后端当前不落库，dev F-03）
      // 显示「已覆盖 n 项」；否则对比当前默认映射快照——不一致显「待同步」，一致显「已同步」。
      render: (_: unknown, r: ScrapeJob) => {
        if (r.job_type === 'blackbox') return <Text type="secondary">同步</Text>
        const n = r.mapping_overrides?.length ?? 0
        if (n > 0) {
          return (
            <Tooltip title={`已覆盖 ${n} 个采集参数`}>
              <Tag color="blue">已覆盖 {n} 项</Tag>
            </Tooltip>
          )
        }
        const def = r.monitor_type ? defaultMappingByMonitorType.get(String(r.monitor_type)) : undefined
        const pending =
          !!def &&
          ((r.scrape_interval && r.scrape_interval !== def.scrape_interval) ||
            (r.scrape_timeout && r.scrape_timeout !== def.scrape_timeout) ||
            (r.metrics_path && r.metrics_path !== def.metrics_path) ||
            (r.scheme && r.scheme !== def.scheme))
        return pending ? (
          <Tooltip title="映射默认值已变更，建议在编辑中同步">
            <Tag color="orange">待同步</Tag>
          </Tooltip>
        ) : (
          <Tooltip title="参数与当前默认映射一致">
            <Text type="secondary">已同步</Text>
          </Tooltip>
        )
      },
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 160,
      render: (_: unknown, r: ScrapeJob) => {
        // 决策 44-1：change_status=pending 的 job 已挂起变更单，禁止编辑/删除/启停，
        // 避免变更单内容与源数据脱节。
        const isPending = r.change_status === 'pending'
        const pendingTip = '该 Job 存在待确认变更单，请先前往配置变更确认页处理'
        return (
          <Space size={0}>
            {/* 决策 47-2：查看该 Job 各实例/目标的具体采集状态（原型对齐的 Job 内下钻入口） */}
            <Tooltip title="查看各实例采集状态详情">
              <Button type="link" size="small" onClick={() => setViewing(r)}>
                查看
              </Button>
            </Tooltip>
            <Tooltip title={isPending ? pendingTip : undefined}>
              <Button type="link" size="small" disabled={isPending} onClick={() => openEdit(r)}>
                编辑
              </Button>
            </Tooltip>
            {/* M01 PRD（破坏性操作二次确认）：启停为有文字按钮 + Popconfirm，
                停用明确提示监控中断影响；原小号无文字 Switch 可发现性差且无确认 */}
            <Popconfirm
              title={r.enabled ? '停用采集任务' : '启用采集任务'}
              description={
                r.enabled
                  ? `停用后「${r.job_name}」将从下发配置中移除，相关监控中断；需到配置变更页确认后生效。`
                  : `启用后「${r.job_name}」将重新纳入配置下发；需到配置变更页确认后生效。`
              }
              okText={r.enabled ? '确认停用' : '确认启用'}
              okButtonProps={r.enabled ? { danger: true } : undefined}
              cancelText="取消"
              onConfirm={() => void toggleEnabled(r, !r.enabled)}
              disabled={isPending}
            >
              <Tooltip title={isPending ? pendingTip : undefined}>
                <Button type="link" size="small" danger={r.enabled} disabled={isPending}>
                  {r.enabled ? '停用' : '启用'}
                </Button>
              </Tooltip>
            </Popconfirm>
            <Popconfirm
              title="删除采集任务"
              description="删除后该任务将不再下发配置，确定删除？"
              okText="删除"
              cancelText="取消"
              onConfirm={() => void removeJob(r)}
              disabled={isPending}
            >
              <Tooltip title={isPending ? pendingTip : undefined}>
                <Button type="link" size="small" danger disabled={isPending}>
                  删除
                </Button>
              </Tooltip>
            </Popconfirm>
          </Space>
        )
      },
    },
  ]

  return (
    <Card
      extra={
        <Space>
          {selectedRowKeys.length > 0 && (
            <>
              <span style={{ marginRight: 8 }}>已选 {selectedRowKeys.length} 项</span>
              <Tooltip
                title={
                  data.list.some((j) => selectedRowKeys.includes(j.id as Key) && j.draft_status === 'draft')
                    ? undefined
                    : '选中的 Job 均不是草稿态，无需提交生效'
                }
              >
                <Button
                  type="primary"
                  disabled={
                    !data.list.some((j) => selectedRowKeys.includes(j.id as Key) && j.draft_status === 'draft')
                  }
                  onClick={() => void batchSubmitReady()}
                >
                  批量提交生效
                </Button>
              </Tooltip>
            </>
          )}
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
        rowSelection={rowSelection}
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
      {/* 决策 47-2 Job 详情抽屉（原型对齐）：『实例采集状态』格与操作列『查看』共用同一入口 */}
      <ScrapeJobDetailDrawer
        open={!!viewing}
        job={viewing}
        onClose={() => setViewing(null)}
        resolveDomainName={(id) => domainById.get(id)?.name ?? id}
        resolveTemplateName={(ref) => templateByRef.get(String(ref))?.name ?? String(ref)}
        resolveLabelTemplateName={(id) => labelTemplateById.get(String(id))?.name ?? String(id)}
        getDefaultMapping={(m) => (m ? defaultMappingByMonitorType.get(m) : undefined)}
      />
    </Card>
  )
}

/**
 * 采集 Job 独立页（F-09 用户裁定拆分，路由 /scrape-jobs，2026-08-23）。
 * 「采集器管理」已拆为独立页面（/collectors），故本页仅承载采集 Job 列表，
 * 不再使用页内 Tabs；旧 `?tab=collectors` 直达链接自动重定向到 /collectors。
 */
export function ScrapeJobListPage() {
  const location = useLocation()
  // 兼容旧外链：`/scrape-jobs?tab=collectors` → 采集器管理独立页（F-09）
  if (new URLSearchParams(location.search).get('tab') === 'collectors') {
    return <Navigate to="/collectors" replace />
  }

  return (
    <MainLayout>
      <JobsTab />
    </MainLayout>
  )
}

export default ScrapeJobListPage
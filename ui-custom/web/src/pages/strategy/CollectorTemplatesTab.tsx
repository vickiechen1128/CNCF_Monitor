import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Drawer,
  Empty,
  Popover,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Typography,
} from 'antd'
import {
  DownloadOutlined,
  FileTextOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { ciExporterMappingApi, type CITypeExporterMappingListParams } from '../../api/ciExporterMappings'
import { exporterTemplateApi } from '../../api/exporterTemplates'
import { labelTemplateApi } from '../../api/labelTemplates'
import type { LabelTemplateListItem } from '../../types/label'
import type { ExporterSource } from '../../types/strategy'
import type { CITypeExporterMapping } from '../../types/strategy'
import type { ExporterTemplate } from '../../types/strategy'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { MONITOR_TYPE_CASCADE, MONITOR_TYPE_MAP } from './strategyConstants'
import { ExporterTemplateDrawer } from './ExporterTemplateDrawer'
import { MappingDrawer } from './MappingDrawer'
import { LabelTemplateSelectDrawer } from './LabelTemplateSelectDrawer'
import { LabelTemplatePreview } from './LabelTemplatePreview'

const { Text } = Typography

/**
 * 联合行：默认采集配置（mapping）行 或 「未被引用」采集器模板（template）行。
 * 原型将默认映射行 + 未被引用模板池行并入同一列表（F1-5）。
 */
type CollectorRow =
  | { kind: 'mapping'; key: string; mapping: CITypeExporterMapping; template?: ExporterTemplate }
  | { kind: 'template'; key: string; template: ExporterTemplate }

/** 安装指南 / 下载 / 文档 Popover 图标链（F1-6） */
function InstallLinks({ template }: { template?: ExporterTemplate }) {
  if (!template) return <Text type="secondary">-</Text>
  return (
    <Popover
      title="安装 / 下载 / 文档"
      trigger="click"
      content={
        <Space direction="vertical" size={4}>
          {template.install_guide ? <Text style={{ maxWidth: 260, whiteSpace: 'pre-wrap' }}>{template.install_guide}</Text> : <Text type="secondary">暂无安装指南</Text>}
          <Space size={8}>
            {template.download_url && (
              <a href={template.download_url} target="_blank" rel="noreferrer">
                <DownloadOutlined /> 下载
              </a>
            )}
            {template.homepage && (
              <a href={template.homepage} target="_blank" rel="noreferrer">
                <FileTextOutlined /> 文档
              </a>
            )}
          </Space>
        </Space>
      }
    >
      <Button type="link" size="small" icon={<FileTextOutlined />}>
        安装指南
      </Button>
    </Popover>
  )
}

/**
 * 采集器管理 Tab（承载于采集 Job 页，不独立导航，Module_01 §9.1 / TaskDesc F2 / F10 增强）。
 * - 顶部 Steps 三步动线（登记采集器 → 配置默认采集 → 创建 Job 确认安装），可收起（A4，P1 修复）；
 * - 列表 = 默认采集配置（CITypeExporterMapping）+ 「未被引用」采集器模板（ExporterTemplate）池行（F1-5）；
 * - 模板行展示 安装指南/下载/文档（Popover 图标链，F1-6）；空态内联登记（A9）；模板行「去配置」（F1-5）。
 */
export function CollectorTemplatesTab() {
  const [mappings, setMappings] = useState<CITypeExporterMapping[]>([])
  const [templates, setTemplates] = useState<ExporterTemplate[]>([])
  const [labelTemplates, setLabelTemplates] = useState<LabelTemplateListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<{ monitor_type?: string; source?: ExporterSource }>({})
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const [stepsVisible, setStepsVisible] = useState(true)

  // 登记采集器 / 新增默认采集配置 / 编辑（补配）抽屉
  const [tmplOpen, setTmplOpen] = useState(false)
  const [mappingOpen, setMappingOpen] = useState(false)
  const [editingMapping, setEditingMapping] = useState<CITypeExporterMapping | null>(null)
  // 标签模板轻量抽屉（Q1b：更换/补配独立入口，仅改 label_template_id）
  const [labelSelectOpen, setLabelSelectOpen] = useState(false)
  const [labelSelectMode, setLabelSelectMode] = useState<'replace' | 'supplement'>('replace')
  const [labelSelectMapping, setLabelSelectMapping] = useState<CITypeExporterMapping | null>(null)
  // 标签模板查看（只读预览抽屉）
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewMapping, setPreviewMapping] = useState<CITypeExporterMapping | null>(null)

  const templateById = useMemo(() => {
    const m = new Map<number, ExporterTemplate>()
    templates.forEach((t) => m.set(t.id, t))
    return m
  }, [templates])

  // 标签模板 id -> 模板对象，用于「标签模板」列与预览抽屉展示具体模板及映射明细
  const labelTemplateById = useMemo(() => {
    const m = new Map<number, LabelTemplateListItem>()
    labelTemplates.forEach((t) => m.set(t.id, t))
    return m
  }, [labelTemplates])

  const load = useCallback(async () => {
    try {
      const params: CITypeExporterMappingListParams = {
        monitor_type: filters.monitor_type,
        page,
        page_size: pageSize,
      }
      const [mappingRes, tmplRes, lblRes] = await Promise.all([
        ciExporterMappingApi.list(params),
        exporterTemplateApi.list({ page: 1, page_size: 100 }),
        labelTemplateApi.list({ page: 1, page_size: 100 }),
      ])
      setMappings(mappingRes.data?.list ?? [])
      setTotal(mappingRes.data?.total ?? 0)
      setTemplates(tmplRes.data?.list ?? [])
      setLabelTemplates(lblRes.data?.list ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [filters.monitor_type, page, pageSize])

  useEffect(() => {
    // 数据请求回调内在异步完成后才 setState；沿用本模块既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, refresh])

  const reload = useCallback(() => {
    setError(null)
    setLoading(true)
    setRefresh((r) => r + 1)
  }, [])

  const openCreateMapping = () => {
    setEditingMapping(null)
    setMappingOpen(true)
  }
  const openEditMapping = (record: CITypeExporterMapping) => {
    setEditingMapping(record)
    setMappingOpen(true)
  }
  /** 标签模板轻量抽屉（Q1b）：mode=replace 更换 / supplement 补配，仅改标签模板 */
  const openLabelTemplateSelect = (record: CITypeExporterMapping, mode: 'replace' | 'supplement') => {
    setLabelSelectMapping(record)
    setLabelSelectMode(mode)
    setLabelSelectOpen(true)
  }
  /** template 行「去配置」：打开默认采集配置新增抽屉（F1-5） */
  const openConfigureForTemplate = () => {
    setEditingMapping(null)
    setMappingOpen(true)
  }

  /** 按下拉 source 前端过滤（契约 §4 列表仅按 monitor_type/is_default 筛选） */
  const sourceFilteredMappings = useMemo(() => {
    if (!filters.source) return mappings
    return mappings.filter((m) => templateById.get(Number(m.exporter_template_id))?.source === filters.source)
  }, [mappings, filters.source, templateById])

  // 「未被引用」模板池行：未被任何默认映射引用，且（若选来源）匹配来源（F1-5）
  const unreferencedTemplates = useMemo(() => {
    const referenced = new Set(sourceFilteredMappings.map((m) => String(m.exporter_template_id)))
    return templates.filter((t) => {
      if (filters.source && t.source !== filters.source) return false
      return !referenced.has(String(t.id))
    })
  }, [templates, sourceFilteredMappings, filters.source])

  // 合并行：默认采集配置行 + 未被引用模板行
  const rows = useMemo<CollectorRow[]>(() => {
    const mappingRows: CollectorRow[] = sourceFilteredMappings.map((m) => ({
      kind: 'mapping',
      key: `m-${m.id}`,
      mapping: m,
      template: templateById.get(Number(m.exporter_template_id)),
    }))
    const templateRows: CollectorRow[] = unreferencedTemplates.map((t) => ({ kind: 'template', key: `t-${t.id}`, template: t }))
    return [...mappingRows, ...templateRows]
  }, [sourceFilteredMappings, unreferencedTemplates, templateById])

  const columns: ColumnsType<CollectorRow> = [
    {
      title: '监控类型',
      key: 'monitor_type',
      render: (_, row) => {
        if (row.kind === 'template') return <Text type="secondary">-</Text>
        return MONITOR_TYPE_MAP[row.mapping.monitor_type as keyof typeof MONITOR_TYPE_MAP] ?? row.mapping.monitor_type
      },
    },
    {
      title: '默认采集器',
      key: 'exporter',
      render: (_, row) => {
        const tmpl = row.kind === 'mapping' ? row.template : row.template
        return tmpl ? <Text strong>{tmpl.name}</Text> : <Text type="secondary">{row.kind === 'mapping' ? '待解析' : '-'}</Text>
      },
    },
    {
      title: '默认端口',
      key: 'default_port',
      render: (_, row) => {
        const tmpl = row.kind === 'template' ? row.template : row.template
        return tmpl ? (tmpl.default_port ?? '-') : (row.kind === 'mapping' ? (row.mapping.default_port ?? '-') : '-')
      },
    },
    {
      title: '采集路径',
      key: 'metrics_path',
      render: (_, row) => {
        if (row.kind === 'template') return row.template.metrics_path || '/'
        return row.template?.metrics_path || row.mapping.metrics_path || '/'
      },
    },
    {
      title: '协议',
      key: 'scheme',
      render: (_, row) => {
        if (row.kind === 'template') return row.template.scheme || '-'
        return row.template?.scheme || row.mapping.scheme || '-'
      },
    },
    {
      title: '采集参数',
      key: 'params',
      render: (_, row) =>
        row.kind === 'mapping' ? (
          <Space direction="vertical" size={0}>
            <Text type="secondary">间隔 {row.mapping.scrape_interval || '-'}</Text>
            <Text type="secondary">超时 {row.mapping.scrape_timeout || '-'}</Text>
          </Space>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '默认',
      key: 'is_default',
      width: 80,
      render: (_, row) => (row.kind === 'mapping' && row.mapping.is_default ? <Tag color="green">默认</Tag> : '-'),
    },
    {
      title: '引用状态',
      key: 'is_referenced',
      render: (_, row) => {
        if (row.kind === 'template') return <Badge status="warning" text="未被引用" />
        return row.mapping.is_referenced === false ? <Badge status="warning" text="未被引用" /> : <Badge status="success" text="已引用" />
      },
    },
    {
      title: '标签模板',
      key: 'label_template',
      width: 220,
      render: (_, row) =>
        row.kind === 'template' ? (
          <Text type="secondary">-</Text>
        ) : (
          <Space direction="vertical" size={4}>
            <Space size={4}>
              {labelTemplateById.has(Number(row.mapping.label_template_id)) ? (
                <Text strong>{labelTemplateById.get(Number(row.mapping.label_template_id))?.name}</Text>
              ) : (
                <Text strong>{row.mapping.has_label_template ? (row.mapping.label_template_id ? '已挂模板' : '待配置') : '未配置'}</Text>
              )}
              {labelTemplateById.has(Number(row.mapping.label_template_id)) &&
                labelTemplateById.get(Number(row.mapping.label_template_id))?.is_default && <Tag color="blue">默认</Tag>}
              {!row.mapping.has_label_template && <Tag color="orange">待配置</Tag>}
            </Space>
            <Space size={0}>
              <Button type="link" size="small" onClick={() => { setPreviewMapping(row.mapping); setPreviewOpen(true) }}>
                查看
              </Button>
              {/* Q1b：更换/补配走独立轻量抽屉（仅改标签模板），不进入采集参数编辑 */}
              <Button type="link" size="small" onClick={() => openLabelTemplateSelect(row.mapping, 'replace')}>
                更换
              </Button>
              <Button type="link" size="small" onClick={() => openLabelTemplateSelect(row.mapping, 'supplement')}>
                补配
              </Button>
            </Space>
          </Space>
        ),
    },
    {
      title: '安装/文档',
      key: 'install',
      width: 120,
      render: (_, row) => <InstallLinks template={row.kind === 'mapping' ? row.template : row.template} />,
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 100,
      render: (_, row) =>
        row.kind === 'mapping' ? (
          <Button type="link" size="small" onClick={() => openEditMapping(row.mapping)}>
            编辑
          </Button>
        ) : (
          <Button type="link" size="small" onClick={openConfigureForTemplate}>
            去配置
          </Button>
        ),
    },
  ]

  return (
    <Card
      extra={
        <Space>
          <Button icon={<PlusOutlined />} onClick={() => setTmplOpen(true)}>
            登记采集器
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateMapping}>
            新增默认采集配置
          </Button>
        </Space>
      }
    >
      {error && (
        <Alert
          type="error"
          showIcon
          message="默认采集配置加载失败，请稍后重试"
          description={error}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={reload}>
              重新加载
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      )}

      {/* A4：Steps 三步动线（登记采集器 → 配置默认采集 → 创建 Job 确认安装），可收起 */}
      {stepsVisible && (
        <div
          style={{
            background: 'var(--color-bg-layout, #fafafa)',
            borderRadius: 8,
            padding: '16px 24px',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text strong>部署动线</Text>
            <Button type="link" size="small" onClick={() => setStepsVisible(false)}>
              收起
            </Button>
          </div>
          <Steps
            size="small"
            current={-1}
            items={[
              { title: '登记采集器', description: '在采集器池登记自研/第三方/官方采集器' },
              { title: '配置默认采集', description: '为监控类型配置默认采集实现与参数' },
              { title: '创建 Job 确认安装', description: '创建采集任务并确认实例安装' },
            ]}
          />
        </div>
      )}

      <FilterBar>
        <FilterItem label="监控类型" width={220}>
          <Select
            allowClear
            placeholder="全部监控类型"
            style={{ width: 180 }}
            value={filters.monitor_type}
            onChange={(v) => setFilters({ ...filters, monitor_type: v ?? undefined })}
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
        <FilterItem label="来源" width={200}>
          <Select
            allowClear
            placeholder="全部来源"
            style={{ width: 140 }}
            value={filters.source}
            onChange={(v) => setFilters({ ...filters, source: (v as ExporterSource) ?? undefined })}
          >
            <Select.Option value="official">官方</Select.Option>
            <Select.Option value="third_party">第三方</Select.Option>
            <Select.Option value="internal">内部自建</Select.Option>
          </Select>
        </FilterItem>
      </FilterBar>

      <Table<CollectorRow>
        rowKey="key"
        dataSource={rows}
        loading={loading}
        columns={columns}
        size="small"
        scroll={TABLE_SCROLL_X}
        locale={{
          emptyText: (
            <Empty description="暂无默认采集配置">
              {/* A9：空态内联登记入口，复用 ExporterTemplateDrawer */}
              <Space direction="vertical">
                <Text type="secondary">池中没有需要的采集器？</Text>
                <Button icon={<PlusOutlined />} onClick={() => setTmplOpen(true)}>
                  登记自研/第三方采集器
                </Button>
              </Space>
            </Empty>
          ),
        }}
        pagination={{
          ...TABLE_PAGINATION,
          current: page,
          pageSize,
          total,
          onChange: (p, pz) => {
            setPage(p)
            setPageSize(pz)
          },
        }}
      />

      <ExporterTemplateDrawer open={tmplOpen} onCancel={() => setTmplOpen(false)} onSuccess={reload} />
      <MappingDrawer open={mappingOpen} record={editingMapping} onCancel={() => setMappingOpen(false)} onSuccess={reload} />
      <LabelTemplateSelectDrawer
        open={labelSelectOpen}
        mode={labelSelectMode}
        record={labelSelectMapping!}
        onCancel={() => setLabelSelectOpen(false)}
        onSuccess={reload}
      />
      <Drawer
        title="标签模板预览"
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        width={420}
      >
        {previewMapping ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            {labelTemplateById.has(Number(previewMapping.label_template_id)) ? (
              <LabelTemplatePreview template={labelTemplateById.get(Number(previewMapping.label_template_id)) ?? null} />
            ) : (
              <div>
                <Text type="secondary">标签模板</Text>
                <div>
                  <Text strong>{previewMapping.has_label_template ? (previewMapping.label_template_id ? '已挂模板' : '待配置') : '未配置'}</Text>
                </div>
              </div>
            )}
            <div>
              <Text type="secondary">监控类型</Text>
              <div>{MONITOR_TYPE_MAP[previewMapping.monitor_type as keyof typeof MONITOR_TYPE_MAP] ?? previewMapping.monitor_type}</div>
            </div>
            <div>
              <Text type="secondary">说明</Text>
              <div>标签模板由 M07 维护，本配置仅记录引用。补配 / 更换请使用「补配」入口。</div>
            </div>
          </Space>
        ) : (
          <Empty description="无预览内容" />
        )}
      </Drawer>
    </Card>
  )
}

export default CollectorTemplatesTab
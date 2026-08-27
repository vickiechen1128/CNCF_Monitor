import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Popconfirm,
  Popover,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import {
  DownloadOutlined,
  FileTextOutlined,
  PlusOutlined,
  ReadOutlined,
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

/** 采集器来源展示名（F-28 查看抽屉） */
const SOURCE_MAP: Record<string, string> = {
  official: '官方',
  third_party: '第三方',
  internal: '内部自建',
}

/**
 * 联合行：默认采集配置（mapping）行 或 「未被引用」采集器模板（template）行。
 * 原型将默认映射行 + 未被引用模板池行并入同一列表（F1-5）。
 */
type CollectorRow =
  | { kind: 'mapping'; key: string; mapping: CITypeExporterMapping; template?: ExporterTemplate }
  | { kind: 'template'; key: string; template: ExporterTemplate }

/** 安装指南 / 下载 / 文档 图标链（F1-6，对齐原型 v3.13 收敛：图标 + Tooltip 文字链） */
function InstallLinks({ template }: { template?: ExporterTemplate }) {
  if (!template) return <Text type="secondary">-</Text>
  if (!template.install_guide && !template.download_url && !template.homepage) return <Text type="secondary">-</Text>
  return (
    <Space size={2}>
      {template.install_guide && (
        <Popover
          placement="topLeft"
          trigger="click"
          title={`${template.name} 安装指南`}
          content={<Text style={{ fontSize: 12, maxWidth: 380, display: 'block', whiteSpace: 'pre-wrap' }}>{template.install_guide}</Text>}
        >
          <Tooltip title="安装指南">
            <Button type="link" size="small" icon={<ReadOutlined />} style={{ paddingInline: 4 }} />
          </Tooltip>
        </Popover>
      )}
      {template.download_url && (
        <Tooltip title="下载">
          <Button
            type="link"
            size="small"
            icon={<DownloadOutlined />}
            style={{ paddingInline: 4 }}
            onClick={() => window.open(template.download_url!, '_blank')}
          />
        </Tooltip>
      )}
      {template.homepage && (
        <Tooltip title="文档">
          <Button
            type="link"
            size="small"
            icon={<FileTextOutlined />}
            style={{ paddingInline: 4 }}
            onClick={() => window.open(template.homepage!, '_blank')}
          />
        </Tooltip>
      )}
    </Space>
  )
}

/**
 * 采集器管理 Tab（承载于采集 Job 页，不独立导航，Module_01 §9.1 / TaskDesc F2 / F10 增强）。
 * - 顶部 Steps 三步动线（登记采集器 → 配置默认采集 → 创建 Job 确认安装），可收起（A4，P1 修复）；
 * - 列表 = 默认采集配置（CITypeExporterMapping）+ 「未被引用」采集器模板（ExporterTemplate）池行（F1-5）；
 * - 模板行展示 安装指南/下载/文档（Popover 图标链，F1-6）；空态内联登记（A9）；模板行「去配置」（F1-5）+ 自建模板「删除」（F-27 A）；
 */
export function CollectorTemplatesTab() {
  const [mappings, setMappings] = useState<CITypeExporterMapping[]>([])
  // 全量映射（跨分页）仅用于「未被引用」集合判定，避免分页后其他页引用的模板被误判为未引用（F-30 分页 bug）
  const [allMappings, setAllMappings] = useState<CITypeExporterMapping[]>([])
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
  // 「去配置」/ 登记成功引导：新增默认采集配置时预填的采集器模板
  const [prefillTemplate, setPrefillTemplate] = useState<ExporterTemplate | null>(null)
  // 标签模板轻量抽屉（Q1b：更换/补配独立入口，仅改 label_template_id）
  const [labelSelectOpen, setLabelSelectOpen] = useState(false)
  const [labelSelectMode, setLabelSelectMode] = useState<'replace' | 'supplement'>('replace')
  const [labelSelectMapping, setLabelSelectMapping] = useState<CITypeExporterMapping | null>(null)
  // 标签模板查看（只读预览抽屉）
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewMapping, setPreviewMapping] = useState<CITypeExporterMapping | null>(null)
  // 采集器查看（F-28：只读详情抽屉，含 supported_monitor_types 等登记信息回显）
  const [viewTemplate, setViewTemplate] = useState<ExporterTemplate | null>(null)

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
      const [mappingRes, allMappingRes, tmplRes, lblRes] = await Promise.all([
        ciExporterMappingApi.list(params),
        // 全量映射（page_size 上限 100）用于「未被引用」判定；当前页仅用于表格行展示
        ciExporterMappingApi.list({ monitor_type: filters.monitor_type, page: 1, page_size: 100 }),
        exporterTemplateApi.list({ page: 1, page_size: 100 }),
        labelTemplateApi.list({ page: 1, page_size: 100 }),
      ])
      setMappings(mappingRes.data?.list ?? [])
      setAllMappings(allMappingRes.data?.list ?? [])
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
    setPrefillTemplate(null)
    setMappingOpen(true)
  }
  const openEditMapping = (record: CITypeExporterMapping) => {
    setEditingMapping(record)
    setPrefillTemplate(null)
    setMappingOpen(true)
  }
  /** 标签模板轻量抽屉（Q1b）：mode=replace 更换 / supplement 补配，仅改标签模板 */
  const openLabelTemplateSelect = (record: CITypeExporterMapping, mode: 'replace' | 'supplement') => {
    setLabelSelectMapping(record)
    setLabelSelectMode(mode)
    setLabelSelectOpen(true)
  }
  /** template 行「去配置」：打开默认采集配置新增抽屉并预填该模板（F1-5 + F-26 动线补齐） */
  const openConfigureForTemplate = (template: ExporterTemplate) => {
    setEditingMapping(null)
    setPrefillTemplate(template)
    setMappingOpen(true)
  }

  /** template 行「删除」（F-27 A）：仅非内置可删；内置/被引用由后端 forbidden 兜底 */
  const removeTemplate = useCallback(
    async (template: ExporterTemplate) => {
      try {
        await exporterTemplateApi.remove(template.id)
        message.success(`采集器「${template.name}」已删除`)
        reload()
      } catch (e) {
        message.error(e instanceof Error ? e.message : '删除失败，请稍后重试')
      }
    },
    [reload],
  )

  /** mapping 行「删除」（F-28）：仅非内置可删；被 Job 引用由后端 forbidden 兜底 */
  const removeMapping = useCallback(
    async (mapping: CITypeExporterMapping) => {
      try {
        await ciExporterMappingApi.remove(mapping.id)
        message.success('默认采集配置已删除')
        reload()
      } catch (e) {
        message.error(e instanceof Error ? e.message : '删除失败，请稍后重试')
      }
    },
    [reload],
  )

  /** 按下拉 source 前端过滤（契约 §4 列表仅按 monitor_type/is_default 筛选） */
  const sourceFilteredMappings = useMemo(() => {
    if (!filters.source) return mappings
    return mappings.filter((m) => templateById.get(Number(m.exporter_template_id))?.source === filters.source)
  }, [mappings, filters.source, templateById])

  // 「未被引用」模板池行：未被任何默认映射引用，且（若选来源）匹配来源（F1-5）。
  // referenced 必须基于全量 allMappings（跨分页），而非当前页 sourceFilteredMappings——
  // 否则一旦 mapping 分页，被其他页引用的 template 会在当前页误显示为「未被引用」（F-30 分页 bug）。
  const referencedTemplateIds = useMemo(() => {
    const s = new Set<string>()
    allMappings.forEach((m) => s.add(String(m.exporter_template_id)))
    return s
  }, [allMappings])

  const unreferencedTemplates = useMemo(() => {
    return templates.filter((t) => {
      if (filters.source && t.source !== filters.source) return false
      return !referencedTemplateIds.has(String(t.id))
    })
  }, [templates, referencedTemplateIds, filters.source])

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
      // F-30 行类型标识：消除「行消失 / 谁的端口」混淆——同表双概念（默认配置行 vs 未引用采集器行）
      title: '行类型',
      key: 'row_kind',
      width: 110,
      render: (_, row) =>
        row.kind === 'mapping' ? <Tag color="blue">默认配置</Tag> : <Tag>未引用采集器</Tag>,
    },
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
      // 来源列（F-32 放开三来源登记后补）：官方/第三方/内部自建；内置行 Tooltip 标注「平台内置，只读」
      title: '来源',
      key: 'source',
      width: 100,
      render: (_, row) => {
        const tmpl = row.kind === 'mapping' ? row.template : row.template
        if (!tmpl) return <Text type="secondary">-</Text>
        const color = tmpl.source === 'official' ? 'blue' : tmpl.source === 'third_party' ? 'purple' : 'default'
        const label = SOURCE_MAP[tmpl.source] ?? tmpl.source
        const tag = <Tag color={color}>{label}</Tag>
        return tmpl.is_builtin ? <Tooltip title="平台内置采集器（只读）">{tag}</Tooltip> : tag
      },
    },
    {
      // F-30 端口语义区分：mapping 行「生效端口（默认）」（覆盖生效），template 行「登记默认端口」（采集器登记值）。
      // 彩色语义 Tag + 加粗端口值：生效端口用绿色、登记默认用橙色，一眼区分端口来源（F1-6 展示增强）
      title: '默认端口',
      key: 'default_port',
      render: (_, row) => {
        if (row.kind === 'template') {
          return (
            <Tooltip title="登记默认端口：采集器登记时填写的默认端口">
              <Space size={4}>
                <Tag color="orange">登记默认</Tag>
                <Text strong>{row.template.default_port ?? '-'}</Text>
              </Space>
            </Tooltip>
          )
        }
        // mapping：有覆盖值优先，无则继承 template 默认
        const port = row.mapping.default_port
        const effective = port && port > 0 ? port : row.template?.default_port
        return (
          <Tooltip title="生效端口（默认）：默认采集配置的覆盖值，未覆盖时继承采集器登记默认端口">
            <Space size={4}>
              <Tag color="green">生效端口</Tag>
              <Text strong>{effective ?? '-'}</Text>
            </Space>
          </Tooltip>
        )
      },
    },
    {
      title: '采集路径',
      key: 'metrics_path',
      render: (_, row) => {
        if (row.kind === 'template') return row.template.metrics_path || '/'
        // mapping：有覆盖值优先，无则继承 template 默认
        return row.mapping.metrics_path || row.template?.metrics_path || '/'
      },
    },
    {
      title: '协议',
      key: 'scheme',
      render: (_, row) => {
        if (row.kind === 'template') return row.template.scheme || '-'
        // mapping：有覆盖值优先，无则继承 template 默认
        return row.mapping.scheme || row.template?.scheme || '-'
      },
    },
    {
      title: '采集参数',
      key: 'params',
      render: (_, row) =>
        row.kind === 'mapping' ? (
          <Space direction="vertical" size={0}>
            {/* F-28 稀疏覆盖：留空=继承全局默认（15s/10s） */}
            <Text type="secondary">间隔 {row.mapping.scrape_interval || '15s（默认）'}</Text>
            <Text type="secondary">超时 {row.mapping.scrape_timeout || '10s（默认）'}</Text>
          </Space>
        ) : (
          <Text type="secondary">-</Text>
        ),
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
      title: '安装指南 / 下载 / 文档',
      key: 'install',
      width: 130,
      render: (_, row) => <InstallLinks template={row.kind === 'mapping' ? row.template : row.template} />,
    },
    {
      // 架构列：arm vs x86 为安装选包关键信息；OS（linux/windows）非必需，不占列宽
      title: '架构',
      key: 'arch',
      width: 90,
      render: (_, row) => {
        const tmpl = row.kind === 'mapping' ? row.template : row.template
        return tmpl ? <Tag>{tmpl.arch || 'any'}</Tag> : <Text type="secondary">-</Text>
      },
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 210,
      render: (_, row) =>
        row.kind === 'mapping' ? (
          <Space size={0}>
            <Button type="link" size="small" onClick={() => openEditMapping(row.mapping)}>
              编辑
            </Button>
            {/* F-28：映射行也可查看所引用采集器的登记详情（含支持的监控对象类型） */}
            {row.template && (
              <Button type="link" size="small" onClick={() => setViewTemplate(row.template!)}>
                查看
              </Button>
            )}
            {/* F-28：非内置默认采集配置可删除；内置由平台 seed 维护（后端 bad_request 兜底），
                被 Job 引用时后端 forbidden 兜底 */}
            {!row.mapping.is_builtin && (
              <Popconfirm
                title="删除默认采集配置"
                description="删除后该监控类型将无默认采集实现；已被采集 Job 引用的配置无法删除。"
                okText="删除"
                okButtonProps={{ danger: true }}
                cancelText="取消"
                onConfirm={() => void removeMapping(row.mapping)}
              >
                <Button type="link" size="small" danger>
                  删除
                </Button>
              </Popconfirm>
            )}
          </Space>
        ) : (
          <Space size={0}>
            {/* F-28：查看采集器登记详情（名称/版本/支持的监控对象类型/端口/路径/协议/安装指南等） */}
            <Button type="link" size="small" onClick={() => setViewTemplate(row.template)}>
              查看
            </Button>
            <Button type="link" size="small" onClick={() => openConfigureForTemplate(row.template)}>
              去配置
            </Button>
            {/* F-27 A：自建采集器删除入口；内置模板只读不提供删除（后端同步 forbidden 兜底） */}
            {!row.template.is_builtin && (
              <Popconfirm
                title="删除采集器"
                description={`删除后「${row.template.name}」将不可再被默认采集配置引用；已被引用的采集器无法删除。`}
                okText="删除"
                okButtonProps={{ danger: true }}
                cancelText="取消"
                onConfirm={() => void removeTemplate(row.template)}
              >
                <Button type="link" size="small" danger>
                  删除
                </Button>
              </Popconfirm>
            )}
          </Space>
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
              { title: '登记采集器', description: '登记官方 / 第三方 / 内部自建采集器（F-29 D 放开来源，与内置同名冲突）' },
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
                  登记采集器
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

      <ExporterTemplateDrawer
        open={tmplOpen}
        onCancel={() => setTmplOpen(false)}
        onSuccess={(t) => {
          reload()
          // F-26 动线补齐：登记成功顺势打开「新增默认采集配置」并预填刚登记的采集器
          if (t) openConfigureForTemplate(t)
        }}
      />
      <MappingDrawer
        open={mappingOpen}
        record={editingMapping}
        initialTemplate={editingMapping ? null : prefillTemplate}
        onCancel={() => setMappingOpen(false)}
        onSuccess={reload}
      />
      <LabelTemplateSelectDrawer
        open={labelSelectOpen}
        mode={labelSelectMode}
        record={labelSelectMapping!}
        onCancel={() => setLabelSelectOpen(false)}
        onSuccess={reload}
      />
      {/* F-28：采集器登记详情只读查看（模板行 + 映射行均可打开） */}
      <Drawer
        title={viewTemplate ? `采集器详情：${viewTemplate.name}` : '采集器详情'}
        open={!!viewTemplate}
        onClose={() => setViewTemplate(null)}
        width={520}
      >
        {viewTemplate && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="名称">{viewTemplate.name}</Descriptions.Item>
            <Descriptions.Item label="版本">{viewTemplate.version || '-'}</Descriptions.Item>
            <Descriptions.Item label="描述">
              {viewTemplate.description ? <Text style={{ whiteSpace: 'pre-wrap' }}>{viewTemplate.description}</Text> : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="来源">
              <Space size={4}>
                <span>{SOURCE_MAP[viewTemplate.source] ?? viewTemplate.source}</span>
                {viewTemplate.is_builtin && <Tag color="blue">内置</Tag>}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="支持的监控对象类型">
              {viewTemplate.supported_monitor_types?.length ? (
                <Space size={4} wrap>
                  {viewTemplate.supported_monitor_types.map((t) => (
                    <Tag key={t}>{MONITOR_TYPE_MAP[t as keyof typeof MONITOR_TYPE_MAP] ?? t}</Tag>
                  ))}
                </Space>
              ) : (
                <Text type="secondary">未标注（可被任意监控对象类型引用）</Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="默认端口">{viewTemplate.default_port || '-'}</Descriptions.Item>
            <Descriptions.Item label="采集路径">{viewTemplate.metrics_path || '-'}</Descriptions.Item>
            <Descriptions.Item label="协议">{viewTemplate.scheme || '-'}</Descriptions.Item>
            <Descriptions.Item label="操作系统 / 架构">
              {viewTemplate.os || 'any'} / {viewTemplate.arch || 'any'}
            </Descriptions.Item>
            <Descriptions.Item label="下载地址">
              {viewTemplate.download_url ? (
                <a href={viewTemplate.download_url} target="_blank" rel="noreferrer">
                  {viewTemplate.download_url}
                </a>
              ) : (
                '-'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="文档">
              {viewTemplate.homepage ? (
                <a href={viewTemplate.homepage} target="_blank" rel="noreferrer">
                  {viewTemplate.homepage}
                </a>
              ) : (
                '-'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="安装指南">
              {viewTemplate.install_guide ? (
                <Text style={{ whiteSpace: 'pre-wrap' }}>{viewTemplate.install_guide}</Text>
              ) : (
                '-'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="描述">
              {viewTemplate.description ? (
                <Text style={{ whiteSpace: 'pre-wrap' }}>{viewTemplate.description}</Text>
              ) : (
                '-'
              )}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
      <Drawer
        title="标签模板预览"
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        width={420}
      >        {previewMapping ? (
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
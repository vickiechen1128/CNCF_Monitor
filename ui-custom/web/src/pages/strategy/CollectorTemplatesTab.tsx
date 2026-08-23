import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Drawer,
  Empty,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { ciExporterMappingApi, type CITypeExporterMappingListParams } from '../../api/ciExporterMappings'
import { exporterTemplateApi } from '../../api/exporterTemplates'
import type { ExporterSource } from '../../types/strategy'
import type { CITypeExporterMapping } from '../../types/strategy'
import type { ExporterTemplate } from '../../types/strategy'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { MONITOR_TYPE_CASCADE, MONITOR_TYPE_MAP } from './strategyConstants'
import { ExporterTemplateDrawer } from './ExporterTemplateDrawer'
import { MappingDrawer } from './MappingDrawer'

const { Text } = Typography

/**
 * 采集器管理 Tab（承载于采集 Job 页，不独立导航，Module_01 §9.1 / TaskDesc F2）。
 * 默认采集配置列表（CITypeExporterMapping）+ 采集器模板登记（ExporterTemplate）。
 * - 列表按 monitor_type（后端）+ source（前端按模板 enrich 过滤）筛选；
 *   行展示 监控类型 / 默认采集器 / 端口 / 路径 / 协议 / 参数 / 默认标记 / 未被引用标记（is_referenced=false）/
 *   标签模板卡片（查看 / 更换 / 补配 + 待配置 badge）。
 * - 主按钮「新增默认采集配置」+「登记采集器」次级；空态引导。
 */
export function CollectorTemplatesTab() {
  const [mappings, setMappings] = useState<CITypeExporterMapping[]>([])
  const [templates, setTemplates] = useState<ExporterTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<{ monitor_type?: string; source?: ExporterSource }>({})
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [refresh, setRefresh] = useState(0)

  // 登记采集器 / 新增默认采集配置 / 编辑（补配）抽屉
  const [tmplOpen, setTmplOpen] = useState(false)
  const [mappingOpen, setMappingOpen] = useState(false)
  const [editingMapping, setEditingMapping] = useState<CITypeExporterMapping | null>(null)
  // 标签模板查看（只读预览抽屉）
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewMapping, setPreviewMapping] = useState<CITypeExporterMapping | null>(null)

  const templateById = useMemo(() => {
    const m = new Map<number, ExporterTemplate>()
    templates.forEach((t) => m.set(t.id, t))
    return m
  }, [templates])

  const load = useCallback(async () => {
    try {
      const params: CITypeExporterMappingListParams = {
        monitor_type: filters.monitor_type,
        page,
        page_size: pageSize,
      }
      const [mappingRes, tmplRes] = await Promise.all([
        ciExporterMappingApi.list(params),
        exporterTemplateApi.list({ page: 1, page_size: 100 }),
      ])
      setMappings(mappingRes.data?.list ?? [])
      setTotal(mappingRes.data?.total ?? 0)
      setTemplates(tmplRes.data?.list ?? [])
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

  /** 按下拉 source 前端过滤（契约 §4 列表仅按 monitor_type/is_default 筛选） */
  const sourceFiltered = useMemo(() => {
    if (!filters.source) return mappings
    return mappings.filter((m) => templateById.get(Number(m.exporter_template_id))?.source === filters.source)
  }, [mappings, filters.source, templateById])

  const columns: ColumnsType<CITypeExporterMapping> = [
    {
      title: '监控类型',
      dataIndex: 'monitor_type',
      key: 'monitor_type',
      render: (v: string) => MONITOR_TYPE_MAP[v as keyof typeof MONITOR_TYPE_MAP] ?? v,
    },
    {
      title: '默认采集器',
      dataIndex: 'exporter_template_id',
      key: 'exporter_template_id',
      render: (v: number) => {
        const tmpl = templateById.get(Number(v))
        return tmpl ? <Text strong>{tmpl.name}</Text> : <Text type="secondary">{v}</Text>
      },
    },
    { title: '默认端口', dataIndex: 'default_port', key: 'default_port', render: (v?: number) => v ?? '-' },
    { title: '采集路径', dataIndex: 'metrics_path', key: 'metrics_path', render: (v?: string) => v || '/' },
    { title: '协议', dataIndex: 'scheme', key: 'scheme', render: (v?: string) => v || '-' },
    {
      title: '采集参数',
      key: 'params',
      render: (_: unknown, r: CITypeExporterMapping) => (
        <Space direction="vertical" size={0}>
          <Text type="secondary">间隔 {r.scrape_interval || '-'}</Text>
          <Text type="secondary">超时 {r.scrape_timeout || '-'}</Text>
        </Space>
      ),
    },
    {
      title: '默认',
      dataIndex: 'is_default',
      key: 'is_default',
      width: 80,
      render: (v: boolean) => (v ? <Tag color="green">默认</Tag> : '-'),
    },
    {
      title: '引用状态',
      dataIndex: 'is_referenced',
      key: 'is_referenced',
      render: (v?: boolean) =>
        v === false ? <Badge status="warning" text="未被引用" /> : <Badge status="success" text="已引用" />,
    },
    {
      title: '标签模板',
      key: 'label_template',
      width: 220,
      render: (_: unknown, r: CITypeExporterMapping) => (
        <Space direction="vertical" size={4}>
          <Space size={4}>
            <Text strong>{r.has_label_template ? (r.label_template_id ?? '已挂模板') : '待配置'}</Text>
            {!r.has_label_template && <Tag color="orange">待配置</Tag>}
          </Space>
          <Space size={0}>
            <Button type="link" size="small" onClick={() => { setPreviewMapping(r); setPreviewOpen(true) }}>
              查看
            </Button>
            <Button type="link" size="small" onClick={() => openEditMapping(r)}>
              更换
            </Button>
            <Button type="link" size="small" onClick={() => openEditMapping(r)}>
              补配
            </Button>
          </Space>
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 80,
      render: (_: unknown, r: CITypeExporterMapping) => (
        <Button type="link" size="small" onClick={() => openEditMapping(r)}>
          编辑
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

      <Table<CITypeExporterMapping>
        rowKey="id"
        dataSource={sourceFiltered}
        loading={loading}
        columns={columns}
        size="small"
        scroll={TABLE_SCROLL_X}
        locale={{ emptyText: <Empty description="暂无默认采集配置" /> }}
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
      <Drawer
        title="标签模板预览"
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        width={420}
      >
        {previewMapping ? (
          <Space direction="vertical">
            <div>
              <Text type="secondary">标签模板</Text>
              <div>
                <Text strong>{previewMapping.has_label_template ? previewMapping.label_template_id || '已挂模板' : '待配置'}</Text>
              </div>
            </div>
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
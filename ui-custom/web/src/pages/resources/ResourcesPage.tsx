import { useEffect, useMemo, useState } from 'react'
import config from 'antd/locale/zh_CN'
import { MainLayout } from '../../layouts/MainLayout'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { EllipsisText } from '../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfigProvider,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { networkDomainApi } from '../../api/domain'
import { businessDomainApi, resourceApi } from '../../api/resources'
import type { NetworkDomain } from '../../types/domain'
import type { BusinessDomain, ResourceCategory } from '../../types/resource'
import type { CoverageState } from '../../types/query'
import { MonitorStatusBadge } from '../../components/MonitorStatusBadge'
import { useResources } from './useResources'
import type { ResourceListItem } from './useResources'
import { useResourceCoverage } from './useResourceCoverage'
import { ResourceFormDrawer } from './ResourceFormDrawer'
import { ResourceDetailDrawer } from './ResourceDetailDrawer'
import { ImportModal } from './ImportModal'
import { ImportRecordsPanel } from './ImportRecordsPanel'

const { Text } = Typography

/** 五类资源类别（Module_07 §5.1 / 决策 D19） */
const RESOURCE_TYPES: ResourceCategory[] = ['host', 'database', 'middleware', 'application', 'generic_target']

/** 资源类别展示名（对齐原型 RESOURCE_TYPE_MAP） */
const RESOURCE_TYPE_MAP: Record<ResourceCategory, string> = {
  host: '主机',
  database: '数据库',
  middleware: '中间件',
  application: '应用',
  generic_target: '通用目标',
}

/** 运行状态展示名（Module_07 §5.2 / 决策 32，UI 展示名「运行状态」） */
const STATUS_MAP: Record<string, string> = {
  online: '在线',
  offline: '离线',
  maintenance: '维护中',
  orphan: '孤儿',
}

/** 运行状态色（对齐原型 STATUS_COLOR） */
const STATUS_COLOR: Record<string, string> = {
  online: '#00B578',
  offline: '#FF4C3A',
  maintenance: '#FA8C16',
  orphan: '#86909C',
}

/** 数据来源展示名（Module_07 §5.2；cmdb 为 v0.4+ 预留） */
const SOURCE_TYPE_MAP: Record<string, string> = {
  manual: '手动录入',
  import: 'Excel 导入',
  cmdb: 'CMDB 同步',
}

/** 行内主标识展示字段：取当前行可读名称，兜底 resource_id */
function resourceDisplayName(record: ResourceListItem): string {
  return (
    record.instance_name ||
    record.service_name ||
    record.target_name ||
    record.resource_id ||
    '-'
  )
}

/**
 * 资源管理列表页（Module_07 §11.1 页面状态矩阵，L3 任务 T07-F3）。
 * 覆盖：五类 Tab（主机/数据库/中间件/应用/通用目标）切换按 resource_category 请求列表、
 * 网域/业务/运行状态/采集状态（未监控）/关键字筛选、分页（默认 50）、
 * 加载骨架屏 / 空态「暂无资源」+引导 / 接口错误 Alert+重新加载 / 权限不足空态。
 * 操作：删除（Popconfirm 二次确认，调 DELETE /resources/:resource_id）。
 * 其余入口（新增/编辑抽屉 T07-F4、下载模板/Excel 导入 T07-F5、详情抽屉 T07-F6）
 * 本任务仅占位，接入见对应任务。
 */
export function ResourcesPage() {
  const {
    category,
    setCategory,
    data,
    filteredList,
    loading,
    error,
    permissionDenied,
    filters,
    setFilters,
    page,
    pageSize,
    onPageSizeChange,
    reload,
  } = useResources()

  const [networkDomains, setNetworkDomains] = useState<NetworkDomain[]>([])
  const [businessDomains, setBusinessDomains] = useState<BusinessDomain[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)
  // 决策 47-3：资源列表「采集状态」三态 badge 数据源（M02 coverage 聚合，Map by resource_id）
  const {
    coverageByResource,
    loading: coverageLoading,
    error: coverageError,
  } = useResourceCoverage(category)
  // 决策 47-3：三态筛选（全部/采集中/已下发未采到/未监控），前端按 coverage.monitor_state 过滤
  const [monitorState, setMonitorState] = useState<CoverageState | undefined>()
  // 三态筛选后的行（覆盖既有的 biz/status 客户端过滤后的 filteredList）
  const coveredList = useMemo(() => {
    if (!monitorState) return filteredList
    return filteredList.filter(
      (r) => (coverageByResource[r.resource_id]?.monitor_state ?? 'not_monitored') === monitorState,
    )
  }, [filteredList, monitorState, coverageByResource])
  // 资源新增/编辑抽屉（T07-F4）：复用 create/edit 双模式，编辑态携带行 record
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create')
  const [editingRecord, setEditingRecord] = useState<ResourceListItem | null>(null)
  // 资源详情抽屉（T07-F6）：行点击 / 「详情」入口打开，展示详情 + 适用模板 + 标签管理
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailRecord, setDetailRecord] = useState<ResourceListItem | null>(null)
  // Excel 导入弹窗（T07-F5）：模板下载 + 上传 + 结果展示；导入记录面板入口
  const [importOpen, setImportOpen] = useState(false)
  const [recordsOpen, setRecordsOpen] = useState(false)

  useEffect(() => {
    Promise.all([networkDomainApi.list({ page: 1, page_size: 100 }), businessDomainApi.list()])
      .then(([nd, bd]) => {
        setNetworkDomains(nd.data?.list ?? [])
        setBusinessDomains(bd.data?.list ?? [])
      })
      .catch(() => {
        // 下拉字典加载失败不阻塞列表展示
      })
  }, [])

  /** 网域 ID → 展示名（M06 网域清单），未匹配兜底展示 ID */
  const domainNameOf = (id: string) => networkDomains.find((d) => d.id === id)?.name ?? id
  /** 业务编码 → biz_name（Module_07 §11.2 业务列展示 biz_name） */
  const resolveBizName = (code?: string) => {
    if (!code) return '-'
    return businessDomains.find((b) => b.code === code)?.name ?? code
  }
  /** 业务是否停用（停用业务以「业务名（已停用）」标识，存量保留历史值，§11.2） */
  const isBizDisabled = (code: string) => {
    const b = businessDomains.find((d) => d.code === code)
    return !!b && !b.enabled
  }

  // 资源新增/编辑抽屉（T07-F4）：create 走当前 Tab 类型；edit 携带行 record（resource_category 取行）
  const openCreateDrawer = () => {
    setDrawerMode('create')
    setEditingRecord(null)
    setDrawerOpen(true)
  }
  const openEditDrawer = (record: ResourceListItem) => {
    setDrawerMode('edit')
    setEditingRecord(record)
    setDrawerOpen(true)
  }
  // T07-F5：下载模板 / Excel 导入统一进入 ImportModal（含模板下载 + 上传 + 结果展示）；
  // 导入记录面板（recordsOpen）内点击下载模板 / 上传时同步关闭，避免弹窗嵌套弹窗（02_Frontend_Standard §8）
  const openImportModal = () => {
    setRecordsOpen(false)
    setImportOpen(true)
  }
  // T07-F6：打开资源详情抽屉（行点击 / 「详情」入口），携带行 record 供详情展示
  const openDetailDrawer = (record: ResourceListItem) => {
    setDetailRecord(record)
    setDetailOpen(true)
  }

  const handleDelete = async (record: ResourceListItem) => {
    setDeletingId(record.resource_id)
    try {
      await resourceApi.remove(record.resource_id)
      message.success('资源已删除')
      reload()
    } catch (err) {
      // TODO(M01)：被 ScrapeJob 引用时后端返回 403 + 引用 Job 名单，提供「查看引用 Job」跳转（§6.6.1）
      message.error(err instanceof Error ? err.message : '删除失败，请稍后重试')
    } finally {
      setDeletingId(null)
    }
  }

  // 列集合对齐原型：共享列（网域 / 业务 / 来源 / 运行状态 / 操作）+ 各类型差异化列。
  // 网域列默认展示不可隐藏（§11.2）；业务列展示 biz_name、停用加「（已停用）」；
  // 运行状态列头以 hover 提示标注数据来源（决策 32）。采集状态列因后端列表不返回
  // is_monitored（决策 31-M1、M01 未实现）本阶段裁剪，仅保留「未监控」筛选。
  const buildColumns = (type: ResourceCategory): ColumnsType<ResourceListItem> => {
    const domainColumn: ColumnsType<ResourceListItem>[number] = {
      title: '网域',
      dataIndex: 'network_domain_id',
      key: 'network_domain_id',
      render: (value: string) => <Tag color="cyan">{domainNameOf(value)}</Tag>,
    }
    const businessColumn: ColumnsType<ResourceListItem>[number] = {
      title: '业务',
      dataIndex: 'biz_code',
      key: 'biz_code',
      render: (value?: string) =>
        value ? (
          <Tag color={isBizDisabled(value) ? 'default' : 'geekblue'}>
            {resolveBizName(value)}
            {isBizDisabled(value) ? '（已停用）' : ''}
          </Tag>
        ) : (
          '-'
        ),
    }
    const sourceColumn: ColumnsType<ResourceListItem>[number] = {
      title: '来源',
      dataIndex: 'source_type',
      key: 'source_type',
      render: (value: string) => <Tag>{SOURCE_TYPE_MAP[value] || value}</Tag>,
    }
    const statusColumn: ColumnsType<ResourceListItem>[number] = {
      title: (
        <span>
          <Tooltip title="运行状态数据来源：CMDB 同步 / Excel 导入 / 用户手动维护，非本模块计算">
            运行状态
            <InfoCircleOutlined style={{ marginLeft: 4, color: 'rgba(0,0,0,0.35)', fontSize: 12 }} />
          </Tooltip>
        </span>
      ),
      dataIndex: 'status',
      key: 'status',
      render: (value: string) => (
        <Badge color={STATUS_COLOR[value] ?? '#86909C'} text={STATUS_MAP[value] ?? value} />
      ),
    }
    const actionColumn: ColumnsType<ResourceListItem>[number] = {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 200,
      render: (_: unknown, record: ResourceListItem) => (
        <Space size={0}>
          <Button type="link" size="small" icon={<InfoCircleOutlined />} onClick={() => openDetailDrawer(record)}>
            详情
          </Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEditDrawer(record)}>
            编辑
          </Button>
          <Popconfirm
            title="删除资源"
            description={`确认删除资源「${resourceDisplayName(record)}」？删除后不可恢复。`}
            okText="确认删除"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(record)}
          >
            <Button type="link" size="small" danger loading={deletingId === record.resource_id} icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    }
    // 决策 47-3：采集状态三态 badge 列（数据源 M02 coverage，按 resource_id 合并；coverage 失败降级为 '-'）
    const monitorColumn: ColumnsType<ResourceListItem>[number] = {
      title: '采集状态',
      key: 'monitor_state',
      width: 120,
      render: (_: unknown, record: ResourceListItem) => {
        const coverage = coverageByResource[record.resource_id]
        const state = coverage?.monitor_state ?? 'not_monitored'
        return coverageError ? (
          <Text type="secondary">-</Text>
        ) : (
          <MonitorStatusBadge
            state={state}
            health={coverage?.health ?? null}
            lastError={coverage?.last_error}
          />
        )
      },
    }

    switch (type) {
      case 'host':
        return [
          monitorColumn,
          {
            title: '实例名 / 主机名',
            key: 'name',
            render: (_: unknown, record: ResourceListItem) => (
              <Space direction="vertical" size={0}>
                <Text strong>{record.instance_name || '-'}</Text>
                {record.hostname && (
                  <EllipsisText type="secondary" maxWidth={180}>
                    {record.hostname}
                  </EllipsisText>
                )}
              </Space>
            ),
          },
          { title: 'IP 地址', dataIndex: 'instance_ip', key: 'instance_ip', render: (v?: string) => v || '-' },
          { title: '操作系统', dataIndex: 'os_type', key: 'os_type', render: (v?: string) => v || '-' },
          {
            title: '应用 / 环境 / 集群',
            key: 'app_env_cluster',
            render: (_: unknown, record: ResourceListItem) => (
              <Space wrap size={4}>
                {record.app_name && <Tag>{record.app_name}</Tag>}
                {record.env && <Tag color="blue">{record.env}</Tag>}
                {record.cluster && <Tag color="purple">{record.cluster}</Tag>}
              </Space>
            ),
          },
          domainColumn,
          businessColumn,
          sourceColumn,
          statusColumn,
          actionColumn,
        ]
      case 'database':
        return [
          monitorColumn,
          { title: '实例名', dataIndex: 'instance_name', key: 'instance_name', render: (v?: string) => v || '-' },
          {
            title: '数据库类型',
            dataIndex: 'database_type',
            key: 'database_type',
            render: (v?: string) => (v ? <Tag color="green">{v}</Tag> : '-'),
          },
          { title: 'IP 地址', dataIndex: 'instance_ip', key: 'instance_ip', render: (v?: string) => v || '-' },
          { title: '端口', dataIndex: 'port', key: 'port', render: (v?: number) => v ?? '-' },
          { title: '版本', dataIndex: 'version', key: 'version', render: (v?: string) => v || '-' },
          domainColumn,
          businessColumn,
          sourceColumn,
          statusColumn,
          actionColumn,
        ]
      case 'middleware':
        return [
          monitorColumn,
          { title: '实例名', dataIndex: 'instance_name', key: 'instance_name', render: (v?: string) => v || '-' },
          {
            title: '中间件类型',
            dataIndex: 'middleware_type',
            key: 'middleware_type',
            render: (v?: string) => (v ? <Tag color="geekblue">{v}</Tag> : '-'),
          },
          { title: 'IP 地址', dataIndex: 'instance_ip', key: 'instance_ip', render: (v?: string) => v || '-' },
          { title: '端口', dataIndex: 'port', key: 'port', render: (v?: number) => v ?? '-' },
          { title: '版本', dataIndex: 'version', key: 'version', render: (v?: string) => v || '-' },
          domainColumn,
          businessColumn,
          sourceColumn,
          statusColumn,
          actionColumn,
        ]
      case 'application':
        return [
          monitorColumn,
          {
            title: '服务名',
            dataIndex: 'service_name',
            key: 'service_name',
            render: (v?: string) => <Text strong>{v || '-'}</Text>,
          },
          {
            title: '健康检查 URL',
            dataIndex: 'health_check_url',
            key: 'health_check_url',
            ellipsis: { showTitle: true },
            render: (v?: string) => v || '-',
          },
          { title: '协议', dataIndex: 'protocol', key: 'protocol', render: (v?: string) => v || '-' },
          { title: '端点', dataIndex: 'endpoint', key: 'endpoint', render: (v?: string) => v || '-' },
          { title: '端口', dataIndex: 'port', key: 'port', render: (v?: number) => v ?? '-' },
          domainColumn,
          businessColumn,
          sourceColumn,
          statusColumn,
          actionColumn,
        ]
      case 'generic_target':
        return [
          monitorColumn,
          {
            title: '目标名称',
            dataIndex: 'target_name',
            key: 'target_name',
            render: (v?: string) => <Text strong>{v || '-'}</Text>,
          },
          { title: 'Exporter 类型', dataIndex: 'exporter_type', key: 'exporter_type', render: (v?: string) => v || '-' },
          { title: 'IP 地址', dataIndex: 'instance_ip', key: 'instance_ip', render: (v?: string) => v || '-' },
          { title: '端口', dataIndex: 'port', key: 'port', render: (v?: number) => v ?? '-' },
          { title: '采集路径', dataIndex: 'metrics_path', key: 'metrics_path', render: (v?: string) => v || '/metrics' },
          { title: '协议', dataIndex: 'scheme', key: 'scheme', render: (v?: string) => v || 'http' },
          {
            title: '自定义标签',
            dataIndex: 'custom_labels',
            key: 'custom_labels',
            ellipsis: { showTitle: true },
            render: (v?: string) =>
              v ? (
                <Text code style={{ fontSize: 12 }}>
                  {v}
                </Text>
              ) : (
                '-'
              ),
          },
          domainColumn,
          businessColumn,
          sourceColumn,
          statusColumn,
          actionColumn,
        ]
    }
  }

  return (
    <MainLayout>
      {permissionDenied ? (
        <div style={{ marginTop: 80 }}>
          <Empty description="当前账号无此页面查看权限" />
        </div>
      ) : (
        <ConfigProvider locale={config}>
          <Card
            extra={
              <Space>
                <Button icon={<DownloadOutlined />} onClick={openImportModal}>
                  下载模板
                </Button>
                <Button icon={<UploadOutlined />} onClick={openImportModal}>
                  Excel 导入
                </Button>
                <Button icon={<HistoryOutlined />} onClick={() => setRecordsOpen(true)}>
                  导入记录
                </Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreateDrawer}>
                  新增资源
                </Button>
              </Space>
            }
          >
            {error && (
              <Alert
                type="error"
                showIcon
                message="资源列表加载失败，请稍后重试"
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
              <FilterItem label="网域" width={240}>
                <Select
                  placeholder="全部网域"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  style={{ width: 180 }}
                  value={filters.network_domain_id}
                  onChange={(v) => setFilters({ ...filters, network_domain_id: v })}
                >
                  {networkDomains.map((d) => (
                    <Select.Option key={d.id} value={d.id} label={`${d.name} (${d.id})`}>
                      {d.name} ({d.id})
                    </Select.Option>
                  ))}
                </Select>
              </FilterItem>
              <FilterItem label="业务" width={240}>
                <Select
                  placeholder="全部业务"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  style={{ width: 180 }}
                  value={filters.biz_code}
                  onChange={(v) => setFilters({ ...filters, biz_code: v })}
                >
                  {businessDomains
                    .filter((d) => d.enabled)
                    .map((d) => (
                      <Select.Option key={d.code} value={d.code} label={`${d.name} (${d.code})`}>
                        {d.name} ({d.code})
                      </Select.Option>
                    ))}
                </Select>
              </FilterItem>
              <FilterItem label="运行状态" width={200}>
                <Select
                  placeholder="全部"
                  allowClear
                  style={{ width: 120 }}
                  value={filters.status}
                  onChange={(v) => setFilters({ ...filters, status: v })}
                >
                  <Select.Option value="online">在线</Select.Option>
                  <Select.Option value="offline">离线</Select.Option>
                  <Select.Option value="maintenance">维护中</Select.Option>
                </Select>
              </FilterItem>
              <FilterItem label="采集状态" width={240}>
                <Select
                  placeholder="全部"
                  allowClear
                  style={{ width: 180 }}
                  value={monitorState}
                  onChange={(v) => setMonitorState(v as CoverageState | undefined)}
                >
                  <Select.Option value="collecting">采集中</Select.Option>
                  <Select.Option value="pending_down">已下发未采到</Select.Option>
                  <Select.Option value="not_monitored">未监控</Select.Option>
                </Select>
              </FilterItem>
              <FilterItem label="搜索" width={340}>
                <Input.Search
                  placeholder="搜索实例名 / IP / 应用"
                  allowClear
                  onSearch={(v) => setFilters({ ...filters, keyword: v || undefined })}
                  style={{ width: 280 }}
                />
              </FilterItem>
            </FilterBar>

            <Tabs
              activeKey={category}
              onChange={(key) => setCategory(key as ResourceCategory)}
              items={RESOURCE_TYPES.map((type) => ({ key: type, label: RESOURCE_TYPE_MAP[type] }))}
              style={{ marginBottom: 16 }}
            />

            <Table<ResourceListItem>
              rowKey="resource_id"
              dataSource={coveredList}
              loading={loading || coverageLoading}
              columns={buildColumns(category)}
              size="small"
              scroll={TABLE_SCROLL_X}
              onRow={(record) => ({
                onClick: (e) => {
                  // T07-F6 行点击打开资源详情抽屉；行内按钮（详情/编辑/删除）点击不触发
                  if ((e.target as HTMLElement).closest('button')) return
                  openDetailDrawer(record)
                },
              })}
              locale={{
                emptyText: (
                  <Empty description="暂无资源">
                    <Space>
                      <Button type="primary" icon={<PlusOutlined />} onClick={openCreateDrawer}>
                        新增资源
                      </Button>
                      <Button icon={<DownloadOutlined />} onClick={openImportModal}>
                        下载模板
                      </Button>
                      <Button icon={<UploadOutlined />} onClick={openImportModal}>
                        Excel 导入
                      </Button>
                    </Space>
                  </Empty>
                ),
              }}
              pagination={{
                ...TABLE_PAGINATION,
                current: page,
                pageSize,
                total: data.total,
                onChange: (p, pz) => onPageSizeChange(p, pz),
              }}
            />
          </Card>
        </ConfigProvider>
      )}
      <ResourceFormDrawer
        open={drawerOpen}
        mode={drawerMode}
        category={editingRecord?.resource_category ?? category}
        record={editingRecord}
        onCancel={() => setDrawerOpen(false)}
        onSuccess={reload}
      />
      {/* T07-F6：资源详情抽屉（详情 + 适用模板 + 标签管理；复用父页已加载的网域/业务字典） */}
      <ResourceDetailDrawer
        open={detailOpen}
        record={detailRecord}
        networkDomains={networkDomains}
        businessDomains={businessDomains}
        onCancel={() => setDetailOpen(false)}
      />
      {/* T07-F5：Excel 导入弹窗（模板下载 + 上传 + mode + 结果/错误行）；导入成功后回刷列表 */}
      <ImportModal
        open={importOpen}
        category={category}
        onCancel={() => setImportOpen(false)}
        onSuccess={reload}
      />
      {/* T07-F5：导入记录面板（列表筛选/分页/详情；空态引导打开 ImportModal） */}
      <Modal
        open={recordsOpen}
        title="导入记录"
        width={1000}
        onCancel={() => setRecordsOpen(false)}
        footer={null}
        destroyOnClose
      >
        <ImportRecordsPanel
          onDownloadTemplate={openImportModal}
          onUploadExcel={openImportModal}
        />
      </Modal>
    </MainLayout>
  )
}

export default ResourcesPage

import { useEffect, useMemo, useState } from 'react'
import config from 'antd/locale/zh_CN'
import { useSearchParams } from 'react-router-dom'
import { MainLayout } from '../../layouts/MainLayout'
import { FilterBar, FilterItem } from '../../components/FilterBar'
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
import {
  businessDomainApi,
  resourceApi,
  applicationDictApi,
  cloudDictApi,
  platformDictApi,
  serviceDictApi,
} from '../../api/resources'
import type { NetworkDomain } from '../../types/domain'
import type {
  ApplicationDict,
  BusinessDomain,
  CloudDict,
  PlatformDict,
  ResourceCategory,
  ServiceDict,
} from '../../types/resource'
import type { CoverageState } from '../../types/query'
import { MonitorStatusBadge } from '../../components/MonitorStatusBadge'
import { EllipsisText } from '../../components/EllipsisText'
import { useResources } from './useResources'
import type { ResourceListItem } from './useResources'
import { useResourceCoverage } from './useResourceCoverage'
import { ResourceFormDrawer } from './ResourceFormDrawer'
import { ResourceDetailDrawer } from './ResourceDetailDrawer'
import { ImportModal } from './ImportModal'
import { TemplateDownloadModal } from './TemplateDownloadModal'
import { ImportRecordsPanel } from './ImportRecordsPanel'
import { useSkin } from '../../skinContext'
import type { SkinTokens } from '../../skins'

const { Text } = Typography

/**
 * 「实例名」列头（database / middleware Tab，决策 70 / F-38）。
 *
 * 这两类资源的模型（`platform/models/database.go`、`resource.go`）**没有独立名称字段**，
 * `buildListItem`（`platform/config/resource/list.go:152-161`）也不产出 `instance_name`，
 * 故此前该列恒显示 `-`。按 M07 §5.12 展示口径改绑 `instance_ip`
 * （与 `module-07/task-sequence.yaml:445` 一致），即「实例标识 = 实例 IP」。
 * 该列与相邻「IP 地址」列同值，属数据模型层根因，列语义待 PRD 下一轮迭代决定
 * （见 `module-01/dev-feedback.md` F-38）。
 */
function InstanceNameTitle() {
  return (
    <span>
      实例名
      <Tooltip title="数据库 / 中间件资源暂无独立名称字段，按 M07 §5.12 以实例 IP 作为实例标识">
        <InfoCircleOutlined style={{ marginLeft: 4, color: 'rgba(0,0,0,0.35)', fontSize: 12 }} />
      </Tooltip>
    </span>
  )
}

/** 五类资源类别（Module_07 §5.1 / 决策 D19） */
const RESOURCE_TYPES: ResourceCategory[] = ['host', 'database', 'middleware', 'application', 'generic_target']

/** 资源类别展示名（对齐原型 RESOURCE_TYPE_MAP） */
const RESOURCE_TYPE_MAP: Record<ResourceCategory, string> = {
  host: '主机',
  database: '数据库',
  middleware: '中间件',
  application: '应用服务',
  generic_target: '通用目标',
}

/**
 * 子类取值字段（决策 91 首页 L1 各类型卡的子类口径）：
 * host=os_type / database=database_type / middleware=middleware_type /
 * generic_target=exporter_type；application 用 service_name（不设子类，仅供深链兜底）。
 */
const SUBTYPE_FIELD: Record<ResourceCategory, keyof ResourceListItem> = {
  host: 'os_type',
  database: 'database_type',
  middleware: 'middleware_type',
  application: 'service_name',
  generic_target: 'exporter_type',
}

/** 运行状态展示名（Module_07 §5.2 / 决策 32，UI 展示名「运行状态」） */const STATUS_MAP: Record<string, string> = {
  online: '在线',
  offline: '离线',
  maintenance: '维护中',
  orphan: '孤儿',
}

/** 运行状态色（对齐原型 STATUS_COLOR，走皮肤 token） */
function statusColor(tokens: SkinTokens): Record<string, string> {
  return {
    online: tokens.colorSuccess,
    offline: tokens.colorError,
    maintenance: tokens.colorWarning,
    orphan: tokens.colorTextTertiary,
  }
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
  /**
   * 首页下钻深链参数（M05 §3.1 决策 91）：`resource_category` 决定首屏 Tab，
   * `subtype` / `app_code` 做客户端预筛，`import=1` 直接打开导入弹窗。
   *
   * 实现口径：**只在当前页数据上做客户端过滤**，不改后端列表接口契约
   * （子类字段各类型不同，且 MVP 分页从简，与既有 biz/status 客户端过滤同一模式）。
   * 用 `useResources(initialCategory)` 与 `useState(初始化函数)` 承接，避免在 effect 里
   * 同步 setState（react-hooks/set-state-in-effect）。
   */
  const [searchParams, setSearchParams] = useSearchParams()
  const deepLinkCategory = searchParams.get('resource_category') as ResourceCategory | null
  const deepLinkSubtype = searchParams.get('subtype')
  const deepLinkAppCode = searchParams.get('app_code')
  const hasDeepLinkFilter = Boolean(deepLinkSubtype || deepLinkAppCode)
  const deepLinkInitialCategory =
    deepLinkCategory && RESOURCE_TYPES.includes(deepLinkCategory) ? deepLinkCategory : undefined

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
  } = useResources(deepLinkInitialCategory)

  const { tokens } = useSkin()
  const [networkDomains, setNetworkDomains] = useState<NetworkDomain[]>([])
  const [businessDomains, setBusinessDomains] = useState<BusinessDomain[]>([])
  // 决策 92/96：应用字典（app_code → app_name 展示名解析，与业务字典正交两维）
  const [applicationDomains, setApplicationDomains] = useState<ApplicationDict[]>([])
  // 决策 103：云字典（部署级只读，cloud_code → cloud_name 展示名解析）
  const [cloudDicts, setCloudDicts] = useState<CloudDict[]>([])
  // 决策 105：服务字典（service_code → service_name 展示名解析，仅 application / generic_target 承载）
  const [serviceDicts, setServiceDicts] = useState<ServiceDict[]>([])
  // {v2026-09-28 决策 110} 平台字典（资源行 `platform_code` 一等字段的展示名解析：platform_code → platform_name）
  const [platformDicts, setPlatformDicts] = useState<PlatformDict[]>([])
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

  /** 深链预筛后的行（无深链参数时与 coveredList 完全一致） */
  const visibleList = useMemo(() => {
    let list = coveredList
    if (deepLinkAppCode) list = list.filter((r) => r.app_code === deepLinkAppCode)
    if (deepLinkSubtype) {
      const field = SUBTYPE_FIELD[category]
      list = list.filter((r) => String(r[field] ?? '') === deepLinkSubtype)
    }
    return list
  }, [coveredList, deepLinkAppCode, deepLinkSubtype, category])

  // 资源新增/编辑抽屉（T07-F4）：复用 create/edit 双模式，编辑态携带行 record
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create')
  const [editingRecord, setEditingRecord] = useState<ResourceListItem | null>(null)
  // 资源详情抽屉（T07-F6）：行点击 / 「详情」入口打开，展示详情 + 适用模板 + 标签管理
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailRecord, setDetailRecord] = useState<ResourceListItem | null>(null)
  // Excel 导入弹窗（T07-F5）：上传 + 模式选择 + 结果展示；导入记录面板入口
  // `import=1` 深链（决策 91）在首屏即展开，用初始化函数而非 effect 承接
  const [importOpen, setImportOpen] = useState(() => searchParams.get('import') === '1')
  // F-4：独立「下载模板」弹窗（列清单 + 模板演进提示 + 下载），与 Excel 导入动线分离
  const [templateOpen, setTemplateOpen] = useState(false)
  const [recordsOpen, setRecordsOpen] = useState(false)

  useEffect(() => {
    Promise.all([
      networkDomainApi.list({ page: 1, page_size: 100 }),
      businessDomainApi.list(),
      applicationDictApi.list(),
      cloudDictApi.list(),
      serviceDictApi.list(),
      platformDictApi.list(),
    ])
      .then(([nd, bd, ad, cd, sd, pd]) => {
        setNetworkDomains(nd.data?.list ?? [])
        setBusinessDomains(bd.data?.list ?? [])
        setApplicationDomains(ad.data?.list ?? [])
        setCloudDicts(cd.data?.list ?? [])
        setServiceDicts(sd.data?.list ?? [])
        setPlatformDicts(pd.data?.list ?? [])
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
  /** 应用编码 → app_name（§5.19 / 决策 92：应用列展示字典展示名，缺条目回退 app_code） */
  const resolveAppName = (code?: string) => {
    if (!code) return '-'
    return applicationDomains.find((a) => a.app_code === code)?.app_name ?? code
  }
  /** 应用是否停用（决策 92：停用应用以「应用名（已停用）」标识，存量保留历史值，§11.2） */
  const isAppDisabled = (code: string) => {
    const a = applicationDomains.find((d) => d.app_code === code)
    return !!a && a.status === 'disabled'
  }
  /** 云编码 → cloud_name（§5.20 / 决策 98：云列展示字典展示名，缺条目回退 cloud_code） */
  const resolveCloudName = (code?: string) => {
    if (!code) return '-'
    return cloudDicts.find((c) => c.cloud_code === code)?.cloud_name ?? code
  }
  /** 云是否停用（决策 98：停用条目以「云名（已停用）」标识，存量资源保留历史值） */
  const isCloudDisabled = (code: string) => {
    const c = cloudDicts.find((d) => d.cloud_code === code)
    return !!c && !c.enabled
  }
  /** 服务编码 → service_name（决策 105：服务列展示字典展示名，缺条目回退 service_code） */
  const resolveServiceName = (code?: string) => {
    if (!code) return '-'
    return serviceDicts.find((s) => s.service_code === code)?.service_name ?? code
  }
  /** 服务是否停用（决策 105：停用条目以「服务名（已停用）」标识，存量资源保留历史值） */
  const isServiceDisabled = (code: string) => {
    const s = serviceDicts.find((d) => d.service_code === code)
    return !!s && !s.enabled
  }
  /**
   * 平台展示名（{v2026-09-28 决策 110} / 契约快照 §11）：**资源行 `platform_code` 一等字段**为唯一权威，
   * 经 `GET /platform-dict` 解析 `platform_name`；字典缺条目回退显示 `platform_code`，
   * 停用条目标识「平台名（已停用）」（存量资源保留历史值）。留空显示 '-'。
   *
   * ⚠️ 停用**已废弃**的 `app_code → ApplicationDict.platform_code` 派生（决策 111 M:N 后恒为「-」，
   * 使 M:N 关系 UI 成「写入后不可见」的死功能）；资源行留空时的应用主平台兜底属**标签层**语义，
   * 不回写本字段，故此处不做兜底展示。
   */
  const resolvePlatformName = (code?: string) => {
    if (!code) return '-'
    return platformDicts.find((d) => d.platform_code === code)?.platform_name ?? code
  }
  /** 平台是否停用（停用条目以「平台名（已停用）」标识，存量资源保留历史值） */
  const isPlatformDisabled = (code: string) => {
    const p = platformDicts.find((d) => d.platform_code === code)
    return !!p && !p.enabled
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
  // T07-F5：Excel 导入统一进入 ImportModal（上传 + 模式选择 + 结果展示）；
  // 导入记录面板（recordsOpen）内点击上传时同步关闭，避免弹窗嵌套弹窗（02_Frontend_Standard §8）
  const openImportModal = () => {
    setRecordsOpen(false)
    setImportOpen(true)
  }
  // F-4：独立「下载模板」动线——打开模板列清单/下载弹窗（与 Excel 导入弹窗分离）；
  // 导入记录面板内点击下载模板时同步关闭，避免弹窗嵌套弹窗
  const openTemplateModal = () => {
    setRecordsOpen(false)
    setTemplateOpen(true)
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

  // 列集合对齐原型：共享列（云 / 网域 / 业务名称 / 应用名称 / 运行状态 / 采集状态 / 录入方式 / 操作）+ 各类型差异化列。
  // 网域列默认展示不可隐藏（§11.2）；业务 / 应用列分别展示字典展示名（biz_name / app_name）、
  // 停用加「（已停用）」标识（决策 92/96：业务与应用正交两维，应用列经 GET /application-dict 解析，
  // 缺条目回退 app_code）；「云」列为五类共享列（决策 103 scheme-B：值由所属网域派生、只读），展示 GET /cloud-dict 的 cloud_name，
  // 停用加「（已停用）」、缺条目回退 cloud_code、空值 '-'（决策 98）。运行状态列头以 hover 提示标注数据来源（决策 32）。采集状态列因后端
  // 列表不返回 is_monitored（决策 31-M1、M01 未实现）本阶段裁剪，仅保留「未监控」筛选。
  const buildColumns = (type: ResourceCategory): ColumnsType<ResourceListItem> => {
    const domainColumn: ColumnsType<ResourceListItem>[number] = {
      title: '网域',
      dataIndex: 'network_domain_id',
      key: 'network_domain_id',
      render: (value: string) => <Tag color="cyan">{domainNameOf(value)}</Tag>,
    }
    const businessColumn: ColumnsType<ResourceListItem>[number] = {
      title: '业务名称',
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
    // 决策 92/96 应用列：展示应用字典 app_name，缺条目回退 app_code，停用加「（已停用）」标识
    // （与业务列正交两维，参照原型 appColumn：Tag cyan / default）
    const appColumn: ColumnsType<ResourceListItem>[number] = {
      title: (
        <span>
          应用名称
          <Tooltip title="该资源归属的应用字典条目">
            <InfoCircleOutlined style={{ marginLeft: 4, color: 'rgba(0,0,0,0.35)', fontSize: 12 }} />
          </Tooltip>
        </span>
      ),
      dataIndex: 'app_code',
      key: 'app_code',
      width: 150,
      render: (value?: string) =>
        value ? (
          <Tag color={isAppDisabled(value) ? 'default' : 'cyan'}>
            {resolveAppName(value)}
            {isAppDisabled(value) ? '（已停用）' : ''}
          </Tag>
        ) : (
          '-'
        ),
    }
    // 决策 103「云」列：五类共享列，展示云字典 cloud_name（缺条目回退 cloud_code，
    // 停用条目「云名（已停用）」），样式与解析逻辑对齐既有「应用名称」列。
    // 红线④：cloud_type / carrier 仅为云字典描述属性，**禁止**独立成列或筛选维度。
    const cloudColumn: ColumnsType<ResourceListItem>[number] = {
      title: (
        <span>
          云
          <Tooltip title="云归属经所属网域派生（网域登记时确定），资源侧只读；此处展示为云名">
            <InfoCircleOutlined style={{ marginLeft: 4, color: 'rgba(0,0,0,0.35)', fontSize: 12 }} />
          </Tooltip>
        </span>
      ),
      dataIndex: 'cloud_code',
      key: 'cloud_code',
      width: 150,
      render: (value?: string) =>
        value ? (
          <Tag color={isCloudDisabled(value) ? 'default' : 'cyan'}>
            {resolveCloudName(value)}
            {isCloudDisabled(value) ? '（已停用）' : ''}
          </Tag>
        ) : (
          '-'
        ),
    }
    // 决策 105「所属服务」列：仅 application / generic_target 承载 service_code（其余三类不挂服务），
    // 展示服务字典 service_name（缺条目回退 service_code、停用「服务名（已停用）」、留空 '-'）。
    // 列头「所属服务」与 application Tab 的「服务名」（实例名）区分：前者是服务字典归属维度。
    const serviceColumn: ColumnsType<ResourceListItem>[number] = {
      title: (
        <span>
          所属服务
          <Tooltip title="该资源归属的服务字典条目（svc 标签取值）">
            <InfoCircleOutlined style={{ marginLeft: 4, color: 'rgba(0,0,0,0.35)', fontSize: 12 }} />
          </Tooltip>
        </span>
      ),
      dataIndex: 'service_code',
      key: 'service_code',
      width: 150,
      render: (value?: string) =>
        value ? (
          <Tag color={isServiceDisabled(value) ? 'default' : 'purple'}>
            {resolveServiceName(value)}
            {isServiceDisabled(value) ? '（已停用）' : ''}
          </Tag>
        ) : (
          '-'
        ),
    }
    // {v2026-09-28 决策 110}「平台」列：**读资源行 `platform_code` 一等字段**（登记期显式填写、可空），
    // 展示名经 GET /platform-dict 解析 platform_name（缺条目回退 platform_code、停用加「（已停用）」、留空 '-'）。
    // 不再经 app_code → 应用父级 platform_code 派生（决策 111 M:N 后该派生恒为「-」）。
    const platformColumn: ColumnsType<ResourceListItem>[number] = {
      title: (
        <span>
          平台
          <Tooltip title="资源登记时填写的平台归属；留空时按所属应用的主平台兜底">
            <InfoCircleOutlined style={{ marginLeft: 4, color: 'rgba(0,0,0,0.35)', fontSize: 12 }} />
          </Tooltip>
        </span>
      ),
      key: 'platform_code',
      width: 150,
      render: (_: unknown, record: ResourceListItem) => {
        const code = record.platform_code
        if (!code) return '-'
        const disabled = isPlatformDisabled(code)
        return (
          <Tag color={disabled ? 'default' : 'purple'}>
            {`${resolvePlatformName(code)}${disabled ? '（已停用）' : ''}`}
          </Tag>
        )
      },
    }
    const sourceColumn: ColumnsType<ResourceListItem>[number] = {
      title: '录入方式',
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
        <Badge color={statusColor(tokens)[value] ?? tokens.colorTextTertiary} text={STATUS_MAP[value] ?? value} />
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

    // F-13 列分组（M07 dev-feedback §13）：按「技术属性 / 位置」与「业务归属」两组归并，操作列不归组。
    // 实现方式：antd 列头分组（parent column 的 children）。固定列不参与分组：
    // - 主标识列（fixed:'left'）作为「技术属性」组首个子列 —— flatten 后仍为第 0 列，
    //   rc-table 的 stickyOffsets / hasGapFixed 均基于 flattenColumns 计算，分组不改变其结论，sticky 生效；
    // - 操作列（fixed:'right'）保持顶层、位于末尾 —— flatten 后仍为最后一列，right sticky 生效。
    // 「云」为经所属网域 cloud_code 派生的位置属性，归入技术 / 位置组（与 F-13 留痕一致，不放业务归属组）。
    // 空组不渲染：某组 children 为空时不输出该组。
    const GROUP_TECH = '技术属性 / 位置'
    const GROUP_BIZ = '业务归属'
    const groupColumns = (
      techChildren: ColumnsType<ResourceListItem>,
      bizChildren: ColumnsType<ResourceListItem>,
    ): ColumnsType<ResourceListItem> => {
      const groups: ColumnsType<ResourceListItem> = []
      if (techChildren.length) groups.push({ key: 'group_tech', title: GROUP_TECH, children: techChildren })
      if (bizChildren.length) groups.push({ key: 'group_biz', title: GROUP_BIZ, children: bizChildren })
      return groups
    }

    switch (type) {
      case 'host': {
        const identifier: ColumnsType<ResourceListItem>[number] = {
          title: (
            <span>
              实例名
              <Tooltip title="主机资源的实例名即主机名">
                <InfoCircleOutlined style={{ marginLeft: 4, color: 'rgba(0,0,0,0.35)', fontSize: 12 }} />
              </Tooltip>
            </span>
          ),
          key: 'name',
          // 决策 70 / F-38：原副行展示 `hostname`，其值与 `instance_name` 同源
          // （host.go `Hostname()` 即 `InstanceName`），视觉上重复且无信息增量；
          // 且本 Tab 已有独立「IP 地址」列 —— 直接删除副行，与 M08「实例名」列逐字对应。
          // 主标识列固定左侧（tablePresets 规则：主标识列 fixed:'left'），横向滚动不丢失。
          fixed: 'left',
          width: 180,
          render: (_: unknown, record: ResourceListItem) => <EllipsisText strong>{record.instance_name || '-'}</EllipsisText>,
        }
        // F-6：拆分原「应用 / 环境 / 集群」组合列——应用信息由共享 appColumn 承载，
        // 环境 / 集群独立成列（Tag 色沿用组合列口径 blue / purple），消除 app_code 重复展示
        const typeColumns: ColumnsType<ResourceListItem> = [
          { title: 'IP 地址', dataIndex: 'instance_ip', key: 'instance_ip', render: (v?: string) => v || '-' },
          { title: '操作系统', dataIndex: 'os_type', key: 'os_type', render: (v?: string) => v || '-' },
          {
            title: '环境',
            dataIndex: 'env',
            key: 'env',
            render: (v?: string) => (v ? <Tag color="blue">{v}</Tag> : '-'),
          },
          {
            title: '集群',
            dataIndex: 'cluster',
            key: 'cluster',
            render: (v?: string) => (v ? <Tag color="purple">{v}</Tag> : '-'),
          },
        ]
        return [
          ...groupColumns(
            [identifier, ...typeColumns, domainColumn, statusColumn, monitorColumn, sourceColumn, cloudColumn],
            [platformColumn, appColumn, businessColumn],
          ),
          actionColumn,
        ]
      }
      case 'database': {
        // 决策 70 / F-38：模型无名称字段，改绑 instance_ip（M07 §5.12 口径）
        // 主标识列固定左侧（tablePresets 规则），横向滚动不丢失；长 IP 截断 + 悬浮全文。
        const identifier: ColumnsType<ResourceListItem>[number] = {
          title: <InstanceNameTitle />,
          dataIndex: 'instance_ip',
          key: 'instance_name',
          fixed: 'left',
          width: 180,
          render: (v?: string) => <EllipsisText>{v || '-'}</EllipsisText>,
        }
        const typeColumns: ColumnsType<ResourceListItem> = [
          {
            title: '数据库类型',
            dataIndex: 'database_type',
            key: 'database_type',
            render: (v?: string) => (v ? <Tag color="green">{v}</Tag> : '-'),
          },
          { title: 'IP 地址', dataIndex: 'instance_ip', key: 'instance_ip', render: (v?: string) => v || '-' },
          { title: '端口', dataIndex: 'port', key: 'port', render: (v?: number) => v ?? '-' },
          { title: '版本', dataIndex: 'version', key: 'version', render: (v?: string) => v || '-' },
        ]
        return [
          ...groupColumns(
            [identifier, ...typeColumns, domainColumn, statusColumn, monitorColumn, sourceColumn, cloudColumn],
            [platformColumn, appColumn, businessColumn],
          ),
          actionColumn,
        ]
      }
      case 'middleware': {
        // 决策 70 / F-38：模型无名称字段，改绑 instance_ip（M07 §5.12 口径）
        // 主标识列固定左侧（tablePresets 规则），横向滚动不丢失；长 IP 截断 + 悬浮全文。
        const identifier: ColumnsType<ResourceListItem>[number] = {
          title: <InstanceNameTitle />,
          dataIndex: 'instance_ip',
          key: 'instance_name',
          fixed: 'left',
          width: 180,
          render: (v?: string) => <EllipsisText>{v || '-'}</EllipsisText>,
        }
        const typeColumns: ColumnsType<ResourceListItem> = [
          {
            title: '中间件类型',
            dataIndex: 'middleware_type',
            key: 'middleware_type',
            render: (v?: string) => (v ? <Tag color="geekblue">{v}</Tag> : '-'),
          },
          { title: 'IP 地址', dataIndex: 'instance_ip', key: 'instance_ip', render: (v?: string) => v || '-' },
          { title: '端口', dataIndex: 'port', key: 'port', render: (v?: number) => v ?? '-' },
          { title: '版本', dataIndex: 'version', key: 'version', render: (v?: string) => v || '-' },
        ]
        return [
          ...groupColumns(
            [identifier, ...typeColumns, domainColumn, statusColumn, monitorColumn, sourceColumn, cloudColumn],
            [platformColumn, appColumn, businessColumn],
          ),
          actionColumn,
        ]
      }
      case 'application': {
        const identifier: ColumnsType<ResourceListItem>[number] = {
          title: (
            <span>
              服务名
              <Tooltip title="本应用服务实例名，参与判重；与服务字典归属（所属服务）是两个概念">
                <InfoCircleOutlined style={{ marginLeft: 4, color: 'rgba(0,0,0,0.35)', fontSize: 12 }} />
              </Tooltip>
            </span>
          ),
          dataIndex: 'service_name',
          key: 'service_name',
          // 主标识列固定左侧（tablePresets 规则），横向滚动不丢失；长服务名截断 + 悬浮全文。
          fixed: 'left',
          width: 180,
          render: (v?: string) => <EllipsisText strong>{v || '-'}</EllipsisText>,
        }
        const typeColumns: ColumnsType<ResourceListItem> = [
          {
            // 健康检查 URL 为应用实际访问地址（业务健康检查用），不参与指标采集
            title: (
              <span>
                健康检查 URL
                <Tooltip title="应用的实际访问地址（业务健康检查用），不参与指标采集">
                  <InfoCircleOutlined style={{ marginLeft: 4, color: 'rgba(0,0,0,0.35)', fontSize: 12 }} />
                </Tooltip>
              </span>
            ),
            dataIndex: 'health_check_url',
            key: 'health_check_url',
            ellipsis: { showTitle: true },
            render: (v?: string) => v || '-',
          },
          { title: '协议', dataIndex: 'protocol', key: 'protocol', render: (v?: string) => v || '-' },
          {
            // 端点 + 端口共同构成应用采集地址（指向 exporter 指标端点）
            title: (
              <span>
                端点
                <Tooltip title="端点 + 端口构成采集地址，须指向 exporter 指标端点">
                  <InfoCircleOutlined style={{ marginLeft: 4, color: 'rgba(0,0,0,0.35)', fontSize: 12 }} />
                </Tooltip>
              </span>
            ),
            dataIndex: 'endpoint',
            key: 'endpoint',
            render: (v?: string) => v || '-',
          },
          {
            title: (
              <span>
                端口
                <Tooltip title="端点 + 端口构成采集地址，须指向 exporter 指标端点">
                  <InfoCircleOutlined style={{ marginLeft: 4, color: 'rgba(0,0,0,0.35)', fontSize: 12 }} />
                </Tooltip>
              </span>
            ),
            dataIndex: 'port',
            key: 'port',
            render: (v?: number) => v ?? '-',
          },
        ]
        return [
          ...groupColumns(
            [identifier, ...typeColumns, domainColumn, statusColumn, monitorColumn, sourceColumn, cloudColumn],
            // 决策 105：仅 application / generic_target 承载「所属服务」（host / database / middleware 不挂）
            [platformColumn, appColumn, serviceColumn, businessColumn],
          ),
          actionColumn,
        ]
      }
      case 'generic_target': {
        const identifier: ColumnsType<ResourceListItem>[number] = {
          title: '目标名称',
          dataIndex: 'target_name',
          key: 'target_name',
          // 主标识列固定左侧（tablePresets 规则），横向滚动不丢失；长目标名截断 + 悬浮全文。
          fixed: 'left',
          width: 180,
          render: (v?: string) => <EllipsisText strong>{v || '-'}</EllipsisText>,
        }
        const typeColumns: ColumnsType<ResourceListItem> = [
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
        ]
        return [
          ...groupColumns(
            [identifier, ...typeColumns, domainColumn, statusColumn, monitorColumn, sourceColumn, cloudColumn],
            // 决策 105：仅 application / generic_target 承载「所属服务」（host / database / middleware 不挂）
            [platformColumn, appColumn, serviceColumn, businessColumn],
          ),
          actionColumn,
        ]
      }
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
                <Button icon={<DownloadOutlined />} onClick={openTemplateModal}>
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

            {/* 下钻来源提示（决策 91）：从首页子类行 / 应用行跳转而来时说明筛选条件，
                并提供一键清除（清除后回落到本页自己的筛选条件，不做导航）。 */}
            {hasDeepLinkFilter && (
              <div data-testid="deep-link-hint" style={{ marginBottom: 12 }}>
                <Alert
                  type="info"
                  showIcon
                  message={
                    <span>
                      已按首页下钻条件预筛选：
                      {deepLinkAppCode ? ` 应用 ${deepLinkAppCode}` : ''}
                      {deepLinkSubtype ? ` 子类 ${deepLinkSubtype}` : ''}
                      （共 {visibleList.length} 条）
                    </span>
                  }
                  action={
                    <Button size="small" type="link" onClick={() => setSearchParams({})}>
                      清除
                    </Button>
                  }
                />
              </div>
            )}

            <Table<ResourceListItem>
              rowKey="resource_id"
              dataSource={visibleList}
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
                      <Button icon={<DownloadOutlined />} onClick={openTemplateModal}>
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
      {/* T07-F5：Excel 导入弹窗（上传 + mode + 结果/错误行）；导入成功后回刷列表 */}
      <ImportModal
        open={importOpen}
        category={category}
        onCancel={() => setImportOpen(false)}
        onSuccess={reload}
      />
      {/* F-4/F-7：模板下载弹窗（用户语言三问 + 当前业务/应用可选值直显 + 演进提示 + 下载），与 Excel 导入动线分离 */}
      <TemplateDownloadModal
        open={templateOpen}
        category={category}
        onCancel={() => setTemplateOpen(false)}
        businessDomains={businessDomains}
        applicationDomains={applicationDomains}
      />
      {/* T07-F5：导入记录面板（列表筛选/分页/详情；空态引导打开 ImportModal） */}
      <Modal
        open={recordsOpen}
        title="导入记录"
        width={1000}
        onCancel={() => setRecordsOpen(false)}
        footer={null}
        destroyOnHidden
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

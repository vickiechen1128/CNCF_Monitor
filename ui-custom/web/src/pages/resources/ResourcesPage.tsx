import { useEffect, useMemo, useRef, useState } from 'react'
import type { HTMLAttributes } from 'react'
import config from 'antd/locale/zh_CN'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { MainLayout } from '../../layouts/MainLayout'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { TABLE_PAGINATION } from '../../components/tablePresets'
import { ResizableHeaderCell } from '../../components/ResizableHeaderCell'
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfigProvider,
  Dropdown,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Divider,
  message,
  theme,
} from 'antd'
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { networkDomainApi } from '../../api/domain'
import {
  appPlatformRelApi,
  businessDomainApi,
  resourceApi,
  applicationDictApi,
  cloudDictApi,
  platformDictApi,
} from '../../api/resources'
import type { ResourceReferenceJob, ResourceReferenceResponse } from '../../api/resources'
import type { NetworkDomain } from '../../types/domain'
import type {
  AppPlatformRel,
  ApplicationDict,
  BusinessDomain,
  CloudDict,
  PlatformDict,
  ResourceCategory,
} from '../../types/resource'
import type { CoverageState } from '../../types/query'
import { MonitorStatusBadge } from '../../components/MonitorStatusBadge'
import { EllipsisText } from '../../components/EllipsisText'
import { useResources } from './useResources'
import type { ResourceListItem } from './useResources'
import { useResourceCoverage } from './useResourceCoverage'
import {
  COLUMN_GROUP_ORDER,
  RESOURCE_COLUMN_META,
  defaultColumnWidth,
  isDefaultVisibleColumnKeys,
  loadVisibleColumnKeys,
  orderColumnKeys,
  resetVisibleColumnKeys,
  saveVisibleColumnKeys,
} from './resourceColumnPrefs'
import type { ResourceColumnWidths } from './resourceColumnPrefs'
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

/**
 * 删除资源二次确认内容（B 方案知情确认，dev-feedback §15 F-21）：回显引用该资源的采集 Job
 * 数与名单，并提供「查看引用 Job」跳转（/scrape-jobs）。无引用时仅提示不可恢复。
 */
function DeleteResourceConfirm({
  displayName,
  total,
  jobs,
  onViewReferences,
}: {
  displayName: string
  total: number
  jobs: ResourceReferenceJob[]
  onViewReferences: () => void
}) {
  if (total === 0) {
    return <p>确认删除资源「{displayName}」？删除后不可恢复。</p>
  }
  return (
    <div>
      <Alert
        type="warning"
        showIcon
        message={`该资源正被 ${total} 个采集 Job 引用，删除后这些 Job 将停止采集该实例`}
        style={{ marginBottom: 12 }}
      />
      <div style={{ marginBottom: 8 }}>引用该资源的采集 Job：</div>
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        {jobs.map((j) => (
          <li key={j.job_name}>
            {j.job_name}
            {!j.enabled && <span style={{ color: 'rgba(0,0,0,0.45)' }}>（已停用）</span>}
            <span style={{ color: 'rgba(0,0,0,0.45)' }}> · 网域 {j.network_domain_id}</span>
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 12 }}>
        <Button type="link" size="small" onClick={onViewReferences}>
          查看引用 Job
        </Button>
      </div>
    </div>
  )
}

/** 六类资源类别（Module_07 §5.1 / 决策 D19；含接口服务） */
const RESOURCE_TYPES: ResourceCategory[] = ['host', 'database', 'middleware', 'application', 'interface_service', 'generic_target']

/** 资源类别展示名（对齐原型 RESOURCE_TYPE_MAP） */
const RESOURCE_TYPE_MAP: Record<ResourceCategory, string> = {
  host: '主机',
  database: '数据库',
  middleware: '中间件',
  application: '应用服务',
  generic_target: '其他监控目标',
  interface_service: '接口服务',
}

/** 子类取值字段（决策 91 首页 L1 各类型卡的子类口径）：
 * host=os_type / database=database_type / middleware=middleware_type /
 * generic_target=exporter_type；application 用 service_name、interface_service 用 api_name
 * （二者均不设子类，仅供深链兜底）。
 */
const SUBTYPE_FIELD: Record<ResourceCategory, keyof ResourceListItem> = {
  host: 'os_type',
  database: 'database_type',
  middleware: 'middleware_type',
  application: 'service_name',
  generic_target: 'exporter_type',
  interface_service: 'api_name',
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
    record.api_name ||
    record.resource_id ||
    '-'
  )
}

/**
 * 资源管理列表页（Module_07 §11.1 页面状态矩阵，L3 任务 T07-F3）。
 * 覆盖：五类 Tab（主机/数据库/中间件/应用服务/其他监控目标）切换按 resource_category 请求列表、
 * 网域/平台/应用/服务/业务/运行状态/采集状态（未监控）/关键字筛选（全部走后端，PRD §11.1；
 * F-18 补平台→应用→服务三维，服务筛选仅 application / generic_target 出现）、分页（默认 50）、
 * 加载骨架屏 / 空态「暂无资源」+引导 / 接口错误 Alert+重新加载 / 权限不足空态。
 * 操作：删除（先调 GET /resources/:resource_id/referenced-by 预检引用关系，再 modal.confirm（App.useApp）
 * 二次确认；B 方案知情确认，dev-feedback §15 F-21，调 DELETE /resources/:resource_id）。
 * 其余入口（新增/编辑抽屉 T07-F4、下载模板/Excel 导入 T07-F5、详情抽屉 T07-F6）
 * 本任务仅占位，接入见对应任务。
 */
export function ResourcesPage() {
  /**
   * 首页下钻深链参数（M05 §3.1 决策 91）：`resource_category` 决定首屏 Tab，
   * `subtype` / `app_code` / `cloud` 做客户端预筛，`import=1` 直接打开导入弹窗。
   *
   * 实现口径：**只在当前页数据上做客户端过滤**，不改后端列表接口契约
   * （子类字段各类型不同，且 MVP 分页从简，与既有 biz/status 客户端过滤同一模式）。
   * 用 `useResources(initialCategory)` 与 `useState(初始化函数)` 承接，避免在 effect 里
   * 同步 setState（react-hooks/set-state-in-effect）。
   *
   * `cloud`（design-proposal §2.1 第 1~3 条）：云卡口径仅主机，故无 `resource_category`
   * 时默认 Tab 落 `host`；过滤按 item 的 `cloud_code`（后端网域派生，五类均有）比对。
   */
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  // B 方案知情确认（dev-feedback §15 F-21）：删除二次确认弹窗经 App.useApp().modal.confirm
  // 消费 App 上下文（渲染在 React 树内，随 RTL cleanup 卸载，避免静态 Modal.confirm 泄漏到 document.body）。
  const { modal } = App.useApp()
  const deepLinkCategory = searchParams.get('resource_category') as ResourceCategory | null
  const deepLinkSubtype = searchParams.get('subtype')
  const deepLinkAppCode = searchParams.get('app_code')
  const deepLinkCloud = searchParams.get('cloud')
  const hasDeepLinkFilter = Boolean(deepLinkSubtype || deepLinkAppCode || deepLinkCloud)
  const deepLinkInitialCategory =
    deepLinkCategory && RESOURCE_TYPES.includes(deepLinkCategory) ? deepLinkCategory : undefined

  const {
    category,
    setCategory,
    data,
    loading,
    error,
    permissionDenied,
    filters,
    setFilters,
    page,
    pageSize,
    onPageSizeChange,
    reload,
    // 云卡深链（§2.1 第 2 条）不带 resource_category：云口径仅主机，默认 Tab 落 host
  } = useResources(deepLinkInitialCategory ?? 'host')

  const { tokens } = useSkin()
  const [networkDomains, setNetworkDomains] = useState<NetworkDomain[]>([])
  const [businessDomains, setBusinessDomains] = useState<BusinessDomain[]>([])
  // 决策 92/96：应用字典（app_code → app_name 展示名解析，与业务字典正交两维）
  const [applicationDomains, setApplicationDomains] = useState<ApplicationDict[]>([])
  // 决策 103：云字典（部署级只读，cloud_code → cloud_name 展示名解析）
  const [cloudDicts, setCloudDicts] = useState<CloudDict[]>([])
  // {v2026-09-28 决策 110} 平台字典（资源行 `platform_code` 一等字段的展示名解析：platform_code → platform_name）
  const [platformDicts, setPlatformDicts] = useState<PlatformDict[]>([])
  // F-18 / 决策 111：应用↔平台 M:N 关联，仅用于「应用」筛选器按所选平台**级联过滤**
  // （与资源表单三级级联同源同数据）。加载失败静默降级为「不按平台过滤」，不阻塞筛选。
  const [appPlatformRels, setAppPlatformRels] = useState<AppPlatformRel[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)
  // 决策 47-3：资源列表「采集状态」三态 badge 数据源（M02 coverage 聚合，Map by resource_id）
  const {
    coverageByResource,
    loading: coverageLoading,
    error: coverageError,
  } = useResourceCoverage(category)
  // 决策 47-3：三态筛选（全部/采集中/已下发未采到/未监控），前端按 coverage.monitor_state 过滤
  const [monitorState, setMonitorState] = useState<CoverageState | undefined>()
  // 决策 47-3：三态筛选后的行。F-18 起 biz / status 已下沉后端，
  // 该层仅叠加采集状态（coverage 属 M02，M07 无服务端筛选口径）。
  const coveredList = useMemo(() => {
    if (!monitorState) return data.list
    return data.list.filter(
      (r) => (coverageByResource[r.resource_id]?.monitor_state ?? 'not_monitored') === monitorState,
    )
  }, [data.list, monitorState, coverageByResource])

  /** 深链预筛后的行（无深链参数时与 coveredList 完全一致） */
  const visibleList = useMemo(() => {
    let list = coveredList
    if (deepLinkAppCode) list = list.filter((r) => r.app_code === deepLinkAppCode)
    // 云卡下钻（§2.1 第 3 条）：cloud_code 由后端按所属网域派生，缺失按空串参与比对
    if (deepLinkCloud) list = list.filter((r) => (r.cloud_code ?? '') === deepLinkCloud)
    if (deepLinkSubtype) {
      const field = SUBTYPE_FIELD[category]
      list = list.filter((r) => String(r[field] ?? '') === deepLinkSubtype)
    }
    return list
  }, [coveredList, deepLinkAppCode, deepLinkCloud, deepLinkSubtype, category])

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

  /**
   * F-17「列设置」：按 `resource_category` 分区的可见列偏好（纯前端视图态，不上传后端）。
   *
   * 五类 Tab 各自一份，初值一次性从 localStorage 读出（`loadVisibleColumnKeys` 内部对
   * 不可用 / 脏数据静默回退默认列集）；切Tab 只换读取对象，不重新读盘，实现「切换 Tab 各自恢复」。
   */
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<Record<ResourceCategory, string[]>>(() => {
    const init = {} as Record<ResourceCategory, string[]>
    for (const t of RESOURCE_TYPES) init[t] = loadVisibleColumnKeys(t)
    return init
  })

  /**
   * 列宽（拖动表头调整）：**纯前端会话态**，按 `resource_category` 分区保存在内存中。
   * 不落 localStorage、不上传后端，刷新页面即恢复默认；未拖过的列不在对象里，
   * 渲染时回落 `buildColumns` 的 width 或 `defaultColumnWidth`。
   */
  const [columnWidths, setColumnWidths] = useState<Record<ResourceCategory, ResourceColumnWidths>>(() => {
    const init = {} as Record<ResourceCategory, ResourceColumnWidths>
    for (const t of RESOURCE_TYPES) init[t] = {}
    return init
  })

  /**
   * 表格容器实测宽度：列宽改为固定布局后，`scroll.x` 取「所有可见列宽之和」与
   * 「容器宽度」的较大值——列少时表格仍铺满容器，列多时出现横向滚动条。
   * jsdom 无 ResizeObserver / getBoundingClientRect 返回 0 时回落为列宽之和。
   */
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const [tableContainerWidth, setTableContainerWidth] = useState(0)
  useEffect(() => {
    const el = tableContainerRef.current
    if (!el) return
    const update = () => setTableContainerWidth(el.getBoundingClientRect().width)
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  /**
   * F-17：「列设置」浮层展开状态（**受控**，H-1）。
   *
   * 不受控时依赖 `rc-dropdown` 内部对 `popupRender` 路径的短路才恰好不关闭，
   * 属赌 antd 内部实现；显式受控后行为确定，连勾多列不会被迫反复展开。
   */
  const [columnSettingsOpen, setColumnSettingsOpen] = useState(false)

  // 列设置浮层的视觉 token：popupRender 自定义内容没有 `.ant-dropdown-menu`，
  // 而 antd 5 的白底/圆角/阴影都定义在 Menu 上 → 不补背景浮层就是透明的，
  // 表格内容会直接透出来（用户可见缺陷）。走 theme token 以兼容皮肤/暗色。
  const { token } = theme.useToken()

  useEffect(() => {
    Promise.all([
      networkDomainApi.list({ page: 1, page_size: 100 }),
      businessDomainApi.list(),
      applicationDictApi.list(),
      cloudDictApi.list(),
      platformDictApi.list(),
    ])
      .then(([nd, bd, ad, cd, pd]) => {
        setNetworkDomains(nd.data?.list ?? [])
        setBusinessDomains(bd.data?.list ?? [])
        setApplicationDomains(ad.data?.list ?? [])
        setCloudDicts(cd.data?.list ?? [])
        setPlatformDicts(pd.data?.list ?? [])
      })
      .catch(() => {
        // 下拉字典加载失败不阻塞列表展示
      })
    // F-18 / 决策 111：应用↔平台关联仅用于「应用」筛选器的级联收敛度。
    // 加载失败时**静默降级为「不按平台过滤」**（应用下拉列出全部启用应用），与资源表单级联
    // 同一降级口径。降级方向是「放宽」而非「收紧」——`filterAppOptions` 以
    // `appPlatformRels.length === 0` 判定「关联数据不可用」，故失败态（rels 为空）
    // 自动落到放宽路径，不会让用户选了平台后下拉**一个选项都没有**且无任何提示
    // （frontend-reviewer M-2）；有关联数据时仍正常按平台收敛。
    appPlatformRelApi
      .list()
      .then((r) => {
        // 数据缺失（如接口返回异常结构）同样按「无关联数据」处理，保持降级口径一致
        setAppPlatformRels(Array.isArray(r.data?.list) ? r.data.list : [])
      })
      .catch(() => {
        // 忽略：应用筛选器退化为全量启用应用（不按平台过滤）
      })
  }, [])

  /**
   * F-18：「应用」筛选下拉的级联选项——启用应用 ∩ 所选平台关联集合。
   *
   * 与资源表单三级级联同源（`app_platform_rel` 为平台→应用归属的唯一权威，
   * 决策 111 M:N）；未选平台时不按平台过滤（保持「先选平台」非硬前置），
   * 与表单 `appCodesOnSelectedPlatform` 口径一致。
   */
  const filterAppOptions = useMemo(() => {
    const platformCode = filters.platform_code
    if (!platformCode) return applicationDomains.filter((d) => d.status === 'enabled')
    const relAppCodes = new Set(
      appPlatformRels.filter((r) => r.platform_code === platformCode).map((r) => r.app_code),
    )
    // 关联数据不可用（加载失败，或加载成功但一条关联都没有）→ 放宽为全部启用应用。
    // 若此时仍按平台收敛，会让用户选了平台后应用下拉**一个选项都没有**且无任何提示
    // （frontend-reviewer M-2）。故只要 `appPlatformRels` 为空就走放宽路径——
    // 「该平台确无关联」与「关联数据不可用」在 UI 上无区别，放宽是唯一不失真的选择；
    // 一旦有关联数据（length > 0）即正常按平台收敛。
    if (appPlatformRels.length === 0) return applicationDomains.filter((d) => d.status === 'enabled')
    return applicationDomains.filter((d) => d.status === 'enabled' && relAppCodes.has(d.app_code))
  }, [applicationDomains, appPlatformRels, filters.platform_code])

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
      // B 方案（dev-feedback §15 F-21）：删除静默放行，不再返回 403；引用信息在确认弹窗预检回显。
      message.error(err instanceof Error ? err.message : '删除失败，请稍后重试')
    } finally {
      setDeletingId(null)
    }
  }

  // B 方案知情确认（dev-feedback §15 F-21）：点击「删除」先调 referencedBy 预检引用关系，
  // 再弹二次确认；弹窗回显「该资源正被 N 个采集 Job 引用」+ 引用名单 + 「查看引用 Job」跳转
  // （/scrape-jobs）。无引用时仅提示不可恢复。引用查询失败不阻断删除，仅不展示引用提示。
  const handleDeleteClick = async (record: ResourceListItem) => {
    let ref: ResourceReferenceResponse | null
    try {
      const res = await resourceApi.referencedBy(record.resource_id)
      ref = res.data ?? null
    } catch {
      ref = null
    }
    const total = ref?.total ?? 0
    const jobs = ref?.jobs ?? []
    modal.confirm({
      title: '删除资源',
      icon: <ExclamationCircleOutlined />,
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => handleDelete(record),
      content: (
        <DeleteResourceConfirm
          displayName={resourceDisplayName(record)}
          total={total}
          jobs={jobs}
          onViewReferences={() => navigate('/scrape-jobs')}
        />
      ),
    })
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
          <Button
            type="link"
            size="small"
            danger
            icon={<DeleteOutlined />}
            loading={deletingId === record.resource_id}
            onClick={() => handleDeleteClick(record)}
          >
            删除
          </Button>
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

    // 列序约定（M07 dev-feedback §13 F-13 撤销列头分组后的替代口径）：
    // 原按「技术属性 / 位置」与「业务归属」两组归并，现改为**平铺单层列**，但保留原分组的列序语义——
    // 技术属性 / 位置列在前（主标识 → 类型专属列 → 网域 → 运行状态 → 采集状态 → 录入方式 → 云），
    // 业务归属列在后（平台 → 应用名称 → 业务名称），即「应用名称在业务名称之前」。
    // 撤销理由：antd 父列分组把表头变两行却一列未减，与 tablePresets.ts「列数 ≤ 8，超出字段下沉详情 Drawer」
    // 正面冲突；scroll.x='max-content' 横向滚动后组标题与下属列不同视口，分组语义归零；组名语义含混。
    // 替代出口为 F-17 列显隐配置（另轮实施）。固定列不参与任何分组：
    // 主标识列 fixed:'left' 为第 0 列、操作列 fixed:'right' 为末列，sticky 结论与分组无关。

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
          width: 300,
          render: (_: unknown, record: ResourceListItem) => <EllipsisText strong maxWidth="100%">{record.instance_name || '-'}</EllipsisText>,
        }
        // F-6：拆分原「应用 / 环境 / 集群」组合列——应用信息由共享 appColumn 承载，
        // 环境 / 集群独立成列（Tag 色沿用组合列口径 blue / purple），消除 app_code 重复展示
        const typeColumns: ColumnsType<ResourceListItem> = [
          { title: 'IP 地址', dataIndex: 'instance_ip', key: 'instance_ip', render: (v?: string) => v || '-' },
          // {T01-P5} 实例级采集端口覆盖：0/缺省 = 未指定，展示 '-'（不展示 0，提案 §9）
          { title: '采集端口', dataIndex: 'scrape_port', key: 'scrape_port', render: (v?: number) => (v ? v : '-') },
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
          identifier,
          ...typeColumns,
          domainColumn,
          statusColumn,
          monitorColumn,
          sourceColumn,
          cloudColumn,
          platformColumn,
          appColumn,
          businessColumn,
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
          width: 300,
          render: (v?: string) => <EllipsisText maxWidth="100%">{v || '-'}</EllipsisText>,
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
          // {T01-P5} 实例级采集端口覆盖：0/缺省 = 未指定，展示 '-'（不展示 0，提案 §9）
          { title: '采集端口', dataIndex: 'scrape_port', key: 'scrape_port', render: (v?: number) => (v ? v : '-') },
          { title: '版本', dataIndex: 'version', key: 'version', render: (v?: string) => v || '-' },
        ]
        return [
          identifier,
          ...typeColumns,
          domainColumn,
          statusColumn,
          monitorColumn,
          sourceColumn,
          cloudColumn,
          platformColumn,
          appColumn,
          businessColumn,
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
          width: 300,
          render: (v?: string) => <EllipsisText maxWidth="100%">{v || '-'}</EllipsisText>,
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
          // {T01-P5} 实例级采集端口覆盖：0/缺省 = 未指定，展示 '-'（不展示 0，提案 §9）
          { title: '采集端口', dataIndex: 'scrape_port', key: 'scrape_port', render: (v?: number) => (v ? v : '-') },
          { title: '版本', dataIndex: 'version', key: 'version', render: (v?: string) => v || '-' },
        ]
        return [
          identifier,
          ...typeColumns,
          domainColumn,
          statusColumn,
          monitorColumn,
          sourceColumn,
          cloudColumn,
          platformColumn,
          appColumn,
          businessColumn,
          actionColumn,
        ]
      }
      case 'application': {
        const identifier: ColumnsType<ResourceListItem>[number] = {
          title: (
            <span>
              服务名
              <Tooltip title="本应用服务实例名，参与判重">
                <InfoCircleOutlined style={{ marginLeft: 4, color: 'rgba(0,0,0,0.35)', fontSize: 12 }} />
              </Tooltip>
            </span>
          ),
          dataIndex: 'service_name',
          key: 'service_name',
          // 主标识列固定左侧（tablePresets 规则），横向滚动不丢失；长服务名截断 + 悬浮全文。
          fixed: 'left',
          width: 300,
          render: (v?: string) => <EllipsisText strong maxWidth="100%">{v || '-'}</EllipsisText>,
        }
        const typeColumns: ColumnsType<ResourceListItem> = [
          {
            title: (
              <span>
                健康检查 URL
                <Tooltip title="必填，作为 blackbox 拨测目标地址">
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
          // {T01-P5} 实例级采集端口覆盖：0/缺省 = 未指定，展示 '-'（不展示 0，提案 §9）
          { title: '采集端口', dataIndex: 'scrape_port', key: 'scrape_port', render: (v?: number) => (v ? v : '-') },
        ]
        return [
          identifier,
          ...typeColumns,
          domainColumn,
          statusColumn,
          monitorColumn,
          sourceColumn,
          cloudColumn,
          platformColumn,
          appColumn,
          businessColumn,
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
          width: 300,
          render: (v?: string) => <EllipsisText strong maxWidth="100%">{v || '-'}</EllipsisText>,
        }
        const typeColumns: ColumnsType<ResourceListItem> = [
          { title: 'Exporter 类型', dataIndex: 'exporter_type', key: 'exporter_type', render: (v?: string) => v || '-' },
          { title: 'IP 地址', dataIndex: 'instance_ip', key: 'instance_ip', render: (v?: string) => v || '-' },
          { title: '端口', dataIndex: 'port', key: 'port', render: (v?: number) => v ?? '-' },
          // {T01-P5} 实例级采集端口覆盖：0/缺省 = 未指定，展示 '-'（不展示 0，提案 §9）
          { title: '采集端口', dataIndex: 'scrape_port', key: 'scrape_port', render: (v?: number) => (v ? v : '-') },
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
          identifier,
          ...typeColumns,
          domainColumn,
          statusColumn,
          monitorColumn,
          sourceColumn,
          cloudColumn,
          platformColumn,
          appColumn,
          businessColumn,
          actionColumn,
        ]
      }
      case 'interface_service': {
        // 主标识列 = 接口名（api_name），固定左侧（tablePresets 规则），长文本截断 + 悬浮全文。
        const identifier: ColumnsType<ResourceListItem>[number] = {
          title: '接口名',
          dataIndex: 'api_name',
          key: 'api_name',
          fixed: 'left',
          width: 300,
          render: (v?: string) => <EllipsisText strong maxWidth="100%">{v || '-'}</EllipsisText>,
        }
        const typeColumns: ColumnsType<ResourceListItem> = [
          {
            // 接口地址为完整 URL（含 ? 查询参数），拨测目标地址直接取该值；长 URL 截断 + 悬浮全文
            title: '接口地址',
            dataIndex: 'api_url',
            key: 'api_url',
            ellipsis: { showTitle: true },
            render: (v?: string) => v || '-',
          },
        ]
        return [
          identifier,
          ...typeColumns,
          domainColumn,
          statusColumn,
          monitorColumn,
          sourceColumn,
          cloudColumn,
          platformColumn,
          appColumn,
          businessColumn,
          actionColumn,
        ]
      }
    }
  }

  /**
   * F-17：当前 Tab 实际渲染的列 = `buildColumns(category)` 按可见 key 过滤。
   *
   * 固定列（主标识 `fixed:'left'` / 操作 `fixed:'right'`）由 `orderColumnKeys` 强制并入，
   * 即便偏好数据异常也不会把固定列挤出表头——sticky 结论不依赖用户偏好。
   *
   * 不做 `useMemo`：`buildColumns` 闭包捕获字典 / coverage / skin token 等异步数据，
   * 记忆化会把这些依赖冻在首帧（采集状态、云/ 应用名等渲染不更新）。
   * 代价仅是每次渲染重建十几列定义，与改前 `columns={buildColumns(category)}` 的开销同量级。
   *
   * 但 Set 本身提到回调外构建一次复用（frontend-reviewer M-3）——它无副作用、不捕获异步数据，
   * 与「不要给 buildColumns加 useMemo」是两回事。
   */
  const visibleColumnKeySet = new Set(visibleColumnKeys[category])
  const visibleColumns = buildColumns(category).filter((c) =>
    visibleColumnKeySet.has(String(c.key)),
  )

  /** 列宽解析：用户拖过的宽度 → `buildColumns` 的列级 width → 默认宽度表 */
  const columnWidthOf = (key: string, columnWidth?: number | string): number => {
    const persisted = columnWidths[category][key]
    if (typeof persisted === 'number') return persisted
    if (typeof columnWidth === 'number') return columnWidth
    return defaultColumnWidth(key)
  }

  /** 拖动列宽：只更新当前 Tab 的内存态（不落库，刷新即恢复默认） */
  const handleColumnResize = (key: string, width: number) => {
    setColumnWidths((prev) => ({
      ...prev,
      [category]: { ...prev[category], [key]: width },
    }))
  }

  /**
   * 注入可拖动表头。每列都必须有确定的 width：固定布局（`scroll.x` 为数字）下
   * 无 width 的列会被浏览器按内容重新分配，拖动其他列时该列会跟着漂移。
   */
  const resizableColumns = visibleColumns.map((column) => {
    const key = String(column.key)
    const width = columnWidthOf(key, column.width)
    return {
      ...column,
      width,
      onHeaderCell: () =>
        ({
          width,
          'data-column-key': key,
          onColumnResize: (next: number) => handleColumnResize(key, next),
        }) as unknown as HTMLAttributes<HTMLTableCellElement>,
    }
  })

  /**
   * 表格总宽 = 可见列宽之和与容器宽度取大：
   * - 列少 → 铺满容器（固定布局会把富余宽度按比例分给各列）；
   * - 列多 → 出现横向滚动条，固定列 sticky 照常生效。
   */
  const totalColumnWidth = resizableColumns.reduce(
    (sum, column) => sum + (typeof column.width === 'number' ? column.width : 0),
    0,
  )
  const tableScrollX = Math.max(totalColumnWidth, Math.round(tableContainerWidth), 600)

  /** F-17：列设置勾选变更 → 归一化（并入固定列）→ 更新状态 + 按 Tab 分区落库 */
  const handleVisibleColumnKeysChange = (next: string[]) => {
    const normalized = orderColumnKeys(category, next)
    setVisibleColumnKeys((prev) => ({ ...prev, [category]: normalized }))
    saveVisibleColumnKeys(category, normalized)
  }

  /**
   * F-17 附加：恢复当前 Tab 的默认列集。
   *
   * 用户把列取消到极简后，若无此入口只能手动逐个勾回 P0 高频列（host / generic_target
   * 各需勾 5 次）。落库路径与 `handleVisibleColumnKeysChange` 一致（复用归一化 + 分区存储），
   * 故恢复后刷新与切 Tab 均可正确恢复。
   */
  const handleResetColumnKeys = () => {
    const defaults = resetVisibleColumnKeys(category)
    setVisibleColumnKeys((prev) => ({ ...prev, [category]: defaults }))
  }

  /** 「列设置」入口按钮：显示当前 Tab 已选列数，便于用户感知偏好已生效 */
  const columnSettingsLabel = `列设置（${visibleColumnKeys[category].length}/${RESOURCE_COLUMN_META[category].length}）`

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
              {/* F-18 / 决策 110：平台筛选（四层模型查询侧首级）。选项取平台字典启用条目，
                  展示 platform_name、回退 platform_code（与「平台」列同一解析口径）。 */}
              <FilterItem label="平台" width={240}>
                <Select
                  placeholder="全部平台"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  style={{ width: 180 }}
                  value={filters.platform_code}
                  // 切换平台时清空已选应用：应用下拉按平台级联，跨平台后原选应用可能已不在候选内
                  onChange={(v) => setFilters({ ...filters, platform_code: v, app_code: undefined })}
                >
                  {platformDicts
                    .filter((d) => d.enabled)
                    .map((d) => (
                      <Select.Option key={d.platform_code} value={d.platform_code} label={d.platform_name}>
                        {d.platform_name}
                      </Select.Option>
                    ))}
                </Select>
              </FilterItem>
              {/* F-18 / 决策 92 + 111：应用筛选，按所选平台级联（数据源 app_platform_rel，
                  与资源表单三级级联同源）。未选平台时列出全部启用应用。 */}
              <FilterItem label="应用" width={240}>
                <Select
                  placeholder="全部应用"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  style={{ width: 180 }}
                  value={filters.app_code}
                  onChange={(v) => setFilters({ ...filters, app_code: v })}
                >
                  {filterAppOptions.map((d) => (
                    <Select.Option key={d.app_code} value={d.app_code} label={`${d.app_name} (${d.app_code})`}>
                      {d.app_name} ({d.app_code})
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
              {/* F-17「列设置」：收敛 tablePresets.ts「列数 ≤ 8」超标宽表。与筛选器同区
                  （FilterBar 内），不塞进表格浮层。偏好按 resource_category 分区持久化，
                  切 Tab 各自恢复；主标识列与操作列 disabled，不可取消勾选。 */}
              <FilterItem label="列" width={260}>
                {/*
                  受控 open（frontend-reviewer H-1）：`rc-dropdown` 的 `onPopupClick` 对浮层内
                  任意元素的冒泡点击**无条件** `setTriggerVisible(false)`（Dropdown.js:61-67
                  经 :123 绑到浮层根节点）。当前 `popupRender` 路径因 antd `OverrideProvider`
                  的 `onMenuClick` 短路（依赖 menu.selectable/multiple，popupRender 无 menu）
                  才恰好不关闭——**属依赖内部实现，antd 升级即可能回归为「一点就关」**。
                  F-17 的全部 UX 价值建立在「能连续勾选多列」上（generic_target 需勾 11 列），
                  故显式受控 + stopPropagation 兜底，不依赖该短路。
                */}
                <Dropdown
                  trigger={['click']}
                  open={columnSettingsOpen}
                  onOpenChange={setColumnSettingsOpen}
                  popupRender={() => (
                    // 阻断冒泡，避免点击 Checkbox / 按钮触发浮层关闭
                    <div
                      style={{
                        padding: 8,
                        minWidth: 200,
                        maxHeight: 420,
                        overflowY: 'auto',
                        // antd 5 背景色挂在 .ant-dropdown-menu 上，popupRender 自定义
                        // 内容必须自带白底/圆角/阴影，否则浮层透明遮不住下方表格
                        background: token.colorBgElevated,
                        borderRadius: token.borderRadiusLG,
                        boxShadow: token.boxShadowSecondary,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox.Group
                        aria-label="列显示设置"
                        value={visibleColumnKeys[category]}
                        onChange={handleVisibleColumnKeysChange}
                      >
                        {COLUMN_GROUP_ORDER.map((group) => {
                          const metas = RESOURCE_COLUMN_META[category].filter((m) => m.group === group)
                          if (metas.length === 0) return null
                          // 固定列（主标识 / 操作）不可取消勾选
                          const groupLocked = group === '固定列'
                          return (
                            // role="group" + aria-label：让屏幕阅读器能读出分组归属——
                            // 这正是 F-17 保留 F-13 语义分组认知的核心价值（frontend-reviewer L-4）
                            <div key={group} role="group" aria-label={group} style={{ marginBottom: 8 }}>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {group}
                              </Text>
                              {metas.map((m) => (
                                <div key={m.key}>
                                  <Checkbox value={m.key} disabled={groupLocked}>
                                    {m.label}
                                  </Checkbox>
                                </div>
                              ))}
                            </div>
                          )
                        })}
                      </Checkbox.Group>
                      {/* F-17 附加：一键恢复默认列集，避免取消到极简后需手动逐个勾回。
                          已是默认列集时禁用，避免无意义点击。 */}
                      <Divider style={{ margin: '8px 0' }} />
                      <Button
                        type="link"
                        size="small"
                        icon={<ReloadOutlined />}
                        disabled={isDefaultVisibleColumnKeys(category, visibleColumnKeys[category])}
                        onClick={handleResetColumnKeys}
                        style={{ paddingInline: 0 }}
                      >
                        恢复默认列
                      </Button>
                    </div>
                  )}
                >
                  <Button icon={<SettingOutlined />}>{columnSettingsLabel}</Button>
                </Dropdown>
              </FilterItem>
            </FilterBar>

            {/*
              F-18 遗留风险的**显式化**：采集状态（`monitor_state`）是 M02 coverage API 的派生字段，
              M07 资源表**无该列**，故这一维筛选仍在前端按当页过滤——分页`total` 来自后端统计，
              不随该筛选变化。此前该限制完全静默（用户会以为看到的是全量筛选结果），
              这里显式提示，避免误读。其余五维（业务 / 运行状态 / 平台 / 应用 / 服务）已全部下沉后端，
              分页总数一致。
            */}
            {monitorState && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message="「采集状态」为前端过滤"
                description={
                  <Text style={{ fontSize: 12 }}>
                    采集状态来自 M02 覆盖聚合（M07 资源表无此列），仅过滤当前页；分页总数仍为未按此条件过滤的总数。
                    其余筛选条件均已由服务端过滤。
                  </Text>
                }
              />
            )}

            <Tabs
              activeKey={category}
              onChange={(key) => {
                setCategory(key as ResourceCategory)
              }}
              items={RESOURCE_TYPES.map((type) => ({ key: type, label: RESOURCE_TYPE_MAP[type] }))}
              style={{ marginBottom: 16 }}
            />

            {/* 下钻来源提示（决策 91）：从首页子类行 / 应用行 / 云卡跳转而来时说明筛选条件，
                并提供一键清除（清除后回落到本页自己的筛选条件，不做导航）。
                云名展示名经云字典解析（缺条目回落 cloud_code，§2.1 第 4 条）。 */}
            {hasDeepLinkFilter && (
              <div data-testid="deep-link-hint" style={{ marginBottom: 12 }}>
                <Alert
                  type="info"
                  showIcon
                  message={
                    <span>
                      已按首页下钻条件预筛选：
                      {deepLinkCloud
                        ? ` 云 ${resolveCloudName(deepLinkCloud ?? undefined)}（${deepLinkCloud}）`
                        : ''}
                      {deepLinkAppCode ? ` 应用 ${deepLinkAppCode}` : ''}
                      {deepLinkSubtype ? ` 子类 ${deepLinkSubtype}` : ''}
                      （共 {visibleList.length} 条）
                    </span>
                  }
                  /* 与「采集状态」同源的当页限制（§2.1 第 5 条）：下钻条件一律为前端过滤，
                     分页 total 仍来自后端统计，不随该条件变化——此前该限制完全静默，
                     用户会以为看到的是全量筛选结果。 */
                  description={
                    <Text style={{ fontSize: 12 }}>
                      该条件为前端过滤，仅作用于当前页；分页总数为未按此条件过滤的总数。
                    </Text>
                  }
                  action={
                    <Button size="small" type="link" onClick={() => setSearchParams({})}>
                      清除
                    </Button>
                  }
                />
              </div>
            )}

            {/* 列宽拖动需要固定布局：scroll.x 取「可见列宽之和」与容器宽度的较大值。
                容器宽度由 ResizeObserver 实测，列少时铺满、列多时横向滚动。 */}
            <div ref={tableContainerRef}>
              <Table<ResourceListItem>
                rowKey="resource_id"
                dataSource={visibleList}
                loading={loading || coverageLoading}
                columns={resizableColumns}
                size="small"
                scroll={{ x: tableScrollX }}
                components={{ header: { cell: ResizableHeaderCell } }}
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
            </div>
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

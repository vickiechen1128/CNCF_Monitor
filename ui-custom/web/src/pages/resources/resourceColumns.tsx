/**
 * 资源列表列定义（Module_07 §11.2；F-13 列序口径 / F-17 列显隐 / 决策 47-3）。
 *
 * 从 `ResourcesPage.tsx` 原样迁出（T07-R2，行为等价）：列序、列 key、title、width、
 * fixed、render、Tooltip 文案、Tag 颜色与空值兜底均保持迁移前逐字一致。
 * 页面只负责以 `ResourceColumnContext` 注入皮肤 token、字典解析器、采集覆盖数据与行操作回调。
 *
 * 文件后缀为 .tsx：列 title / render 含 JSX。本模块只导出列工厂（非组件），
 * 关闭 react-refresh 规则以适配仓库 `max-warnings 0`（与 `resourceMeta.ts` 单独成 .ts 同理）。
 */
/* eslint-disable react-refresh/only-export-components */
import { Badge, Button, Space, Tag, Tooltip, Typography } from 'antd'
import { DeleteOutlined, EditOutlined, InfoCircleOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import type { ResourceCategory } from '../../types/resource'
import type { CoverageItem } from '../../types/query'
import type { SkinTokens } from '../../skins'
import { MonitorStatusBadge } from '../../components/MonitorStatusBadge'
import { EllipsisText } from '../../components/EllipsisText'
import type { ResourceListItem } from './useResources'
import { SOURCE_TYPE_MAP, STATUS_MAP, statusColor } from './resourceMeta'

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
 * 列工厂依赖的页面上下文：与原 `buildColumns` 闭包捕获值一一对应。
 *
 * 不在此处做任何默认值填充或记忆化——字典 / coverage / 皮肤 token 都是异步数据，
 * 由调用方每次渲染传入最新值（见 `ResourcesPage` 中「不做 useMemo」的说明）。
 */
export interface ResourceColumnContext {
  /** 当前皮肤 token（运行状态色 `statusColor`） */
  tokens: SkinTokens
  /** resource_id → M02 coverage item（采集状态列） */
  coverageByResource: Record<string, CoverageItem>
  /** coverage 加载错误：非空时采集状态列降级为 '-' */
  coverageError: string | null
  /** 网域 ID → 展示名，未匹配兜底展示 ID */
  domainNameOf: (id: string) => string
  /** 业务编码 → biz_name，缺条目回退编码 */
  resolveBizName: (code?: string) => string
  /** 业务是否停用 */
  isBizDisabled: (code: string) => boolean
  /** 应用编码 → app_name，缺条目回退 app_code */
  resolveAppName: (code?: string) => string
  /** 应用是否停用 */
  isAppDisabled: (code: string) => boolean
  /** 云编码 → cloud_name，缺条目回退 cloud_code */
  resolveCloudName: (code?: string) => string
  /** 云是否停用 */
  isCloudDisabled: (code: string) => boolean
  /** 平台编码 → platform_name，缺条目回退 platform_code */
  resolvePlatformName: (code?: string) => string
  /** 平台是否停用 */
  isPlatformDisabled: (code: string) => boolean
  /** 行内「详情」入口 */
  onDetail: (record: ResourceListItem) => void
  /** 行内「编辑」入口 */
  onEdit: (record: ResourceListItem) => void
  /** 行内「删除」入口（页面内先做引用预检再二次确认） */
  onDelete: (record: ResourceListItem) => void
  /** 正在删除的资源 ID，用于删除按钮 loading */
  deletingId: string | null
}

// 列集合对齐原型：共享列（云 / 网域 / 业务名称 / 应用名称 / 运行状态 / 采集状态 / 录入方式 / 操作）+ 各类型差异化列。
// 网域列默认展示不可隐藏（§11.2）；业务 / 应用列分别展示字典展示名（biz_name / app_name）、
// 停用加「（已停用）」标识（决策 92/96：业务与应用正交两维，应用列经 GET /application-dict 解析，
// 缺条目回退 app_code）；「云」列为五类共享列（决策 103 scheme-B：值由所属网域派生、只读），展示 GET /cloud-dict 的 cloud_name，
// 停用加「（已停用）」、缺条目回退 cloud_code、空值 '-'（决策 98）。运行状态列头以 hover 提示标注数据来源（决策 32）。采集状态列因后端
// 列表不返回 is_monitored（决策 31-M1、M01 未实现）本阶段裁剪，仅保留「未监控」筛选。
export function buildResourceColumns(
  type: ResourceCategory,
  ctx: ResourceColumnContext,
): ColumnsType<ResourceListItem> {
  const {
    tokens,
    coverageByResource,
    coverageError,
    domainNameOf,
    resolveBizName,
    isBizDisabled,
    resolveAppName,
    isAppDisabled,
    resolveCloudName,
    isCloudDisabled,
    resolvePlatformName,
    isPlatformDisabled,
    onDetail,
    onEdit,
    onDelete,
    deletingId,
  } = ctx

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
        <Button type="link" size="small" icon={<InfoCircleOutlined />} onClick={() => onDetail(record)}>
          详情
        </Button>
        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => onEdit(record)}>
          编辑
        </Button>
        <Button
          type="link"
          size="small"
          danger
          icon={<DeleteOutlined />}
          loading={deletingId === record.resource_id}
          onClick={() => onDelete(record)}
        >
          删除
        </Button>
      </Space>
    ),
  }
  // 决策 47-3：采集状态四态 badge 列（数据源 M02 coverage，按 resource_id 合并；coverage 失败降级为 '-'）
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

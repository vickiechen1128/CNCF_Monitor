import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  App,
  Badge,
  AutoComplete,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Drawer,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { TableProps } from 'antd'
import {
  ApiOutlined,
  ClusterOutlined,
  DeleteOutlined,
  DownOutlined,
  DownloadOutlined,
  InfoCircleFilled,
  InfoCircleOutlined,
  LockOutlined,
  PlusOutlined,
  SettingOutlined,
  UploadOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { Callout } from '../components/Callout'
import { FilterBar, FilterItem } from '../components/FilterBar'
import { EllipsisText } from '../components/EllipsisText'
import { ReviewNote } from '../components/ReviewNote'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../components/tablePresets'
import {
  ENV_VALUES,
  OS_OPTIONS,
  DATABASE_TYPE_OPTIONS,
  IMPORT_TEMPLATE_COLUMNS,
  LABEL_SOURCE_MAP,
  LABEL_SOURCE_PRIORITY,
  MIDDLEWARE_TYPE_OPTIONS,
  PROTOCOL_OPTIONS,
  PROTECTED_PROMETHEUS_LABELS,
  RESOURCE_TYPE_MAP,
  SOURCE_TYPE_MAP,
  STATUS_MAP,
  STATUS_MAPPING_RULES,
  STATUS_VALUES,
  isApplicationResource,
  isGenericTargetResource,
  isHostResource,
  isDatabaseResource,
  isMiddlewareResource,
  mockApplicationDict,
  mockBusinessDomains,
  mockLabelTemplates,
  mockNetworkDomains,
  mockResourceLabels,
  mockResources,
  resolveCollectionStatus,
  isAppDisabled,
  isBizDisabled,
  resolveAppName,
  resolveBizName,
  // {v2.24} 决策 52：网域归属来源解析链（显式指定 > 冲突告警 > IP 推导 > 默认兜底；blackbox 例外 = 发起侧）
  DOMAIN_SOURCE_LABELS,
  resolveDomainFromIP,
  resolveDomainAttribution,
  // {v2.33} 决策 81：网域字段可达性引导（链路说明 + IP 推导预览）与 K8s 集群级端点预设
  domainReachabilityText,
  previewDomainByIP,
  K8S_ENDPOINT_PRESETS,
  // {v2.34} 决策 83：「其他监控目标」登记对象预设（去 exporter 化）+ 技术判别值反查中文名
  DEVICE_ENDPOINT_PRESETS,
  endpointTypeLabel,
} from '../mocks/module-07'
import type {
  AppProtocol,
  CollectionStatus,
  DomainAttributionSource,
  Env,
  ImportError,
  Resource,
  ResourceLabel,
  ResourceStatus,
  ResourceCategory,
} from '../mocks/module-07'

const { Title, Text } = Typography
const { Option } = Select

// {v2.13} 五大类（决策 D19）：新增 database——此前本地数组漏加，Tabs 只渲染 4 类
const RESOURCE_TYPES: ResourceCategory[] = ['host', 'database', 'middleware', 'application', 'generic_target']

const STATUS_COLOR: Record<ResourceStatus, string> = {
  online: '#00B578',
  offline: '#FF4C3A',
  maintenance: '#FA8C16',
  orphan: '#86909C',
}

// {v2.22} 决策 47-3：采集状态三态——采集中 / 已下发未采到 / 未监控。
// {v2.25} 2026-09-02 口径修订：选中关系取 DB 当前值、不感知 M09 下发时序，
// 「已下发未采到」含变更未确认下发情形；「待采集 vs 已下发未采到」细分归 M01 Job 回显（M01 §5.10）。
// 异常驱动展示：仅「已下发未采到」高饱和并附提醒（已选中但未采集到数据）。
// 数据 = M01 选中关系（is_monitored 只读映射）+ M02 健康度/覆盖率 API（聚合调用，禁止逐行查询 TQ-6）。
const COLLECTION_STATUS_META: Record<CollectionStatus, { label: string; color: string; tooltip: string; anomaly?: boolean }> = {
  up: {
    label: '采集中',
    color: 'green',
    tooltip: '已被采集 Job 纳入监控，且当前采集到数据',
  },
  down: {
    label: '已下发未采到',
    color: '#FF4C3A',
    tooltip: '已选中但未采集到数据（含变更未确认下发情形），请检查变更下发状态、采集器安装与网络连通',
    anomaly: true,
  },
  unmonitored: {
    label: '未监控',
    color: 'default',
    tooltip: '未被任何采集 Job 选中，未纳入监控',
  },
}

// 采集状态的 Badge 语义色（《前端标准》§8：状态语义统一用 Badge 语义色 + 文字标签，颜色不得作为唯一语义）
const COLLECTION_BADGE_STATUS: Record<CollectionStatus, 'success' | 'error' | 'default'> = {
  up: 'success',
  down: 'error',
  unmonitored: 'default',
}

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
const CUSTOM_LABELS_RE = /^([A-Za-z_][A-Za-z0-9_]*=[^;]+)(;([A-Za-z_][A-Za-z0-9_]*=[^;]+))*$/

/** Excel 导入结果 mock 演示（PRD 7.2 / 7.3，含重复检测与网域校验错误示例） */
const IMPORT_RESULT_DEMO: Record<ResourceCategory, { total: number; success: number; failed: number; errors: ImportError[] }> = {
  host: {
    total: 3,
    success: 1,
    failed: 2,
    errors: [
      { row: 2, resource_category: 'host', field: 'instance_ip', value: '999.999.999.999', reason: 'IP 格式不正确' },
      { row: 3, resource_category: 'host', field: 'instance_ip:port', value: '10.0.1.11:9100', reason: '重复检测：instance_ip:port 已存在' },
    ],
  },
  middleware: {
    total: 2,
    success: 1,
    failed: 1,
    errors: [
      { row: 2, resource_category: 'middleware', field: 'network_domain', value: 'unknown-domain', reason: '网域不存在：network_domain 必须对应已存在的 NetworkDomain.id' },
    ],
  },
  // {v2.13} 数据库产品线导入示例（决策 D19）
  database: {
    total: 2,
    success: 1,
    failed: 1,
    errors: [
      { row: 2, resource_category: 'database', field: 'database_type', value: 'oracle-xe', reason: 'database_type 必须是 mysql/redis/mongodb/dm8/postgresql/oracle/sqlserver 之一' },
    ],
  },
  application: {
    total: 3,
    success: 1,
    failed: 2,
    errors: [
      // {v2.19} 业务未登记校验（决策 13/14/17）：报错给可执行指引（5.16.1）——字典由平台配置文件预置、热加载生效，无自助登记入口
      { row: 2, resource_category: 'application', field: 'biz_code', value: 'settlement', reason: '业务 settlement 未登记，请联系平台管理员在业务分组字典配置（platform/config/business_domains.yaml）中添加后重新导入' },
      { row: 3, resource_category: 'application', field: 'endpoint', value: '10.0.3.11:9100', reason: '重复检测：service_name+endpoint 已存在' },
    ],
  },
  generic_target: {
    total: 2,
    success: 1,
    failed: 1,
    errors: [{ row: 1, resource_category: 'generic_target', field: 'custom_labels', value: 'device_type=snmp', reason: 'custom_labels 必须符合 key=value;key2=value2 格式' }],
  },
}

/** Label key 校验（PRD 5.3）：小写字母数字下划线、禁止 __ 开头、长度 ≤128、禁止 Prometheus 内置 label */
function validateLabelKey(key: string): string | null {
  if (!key) return null
  if (!/^[a-z0-9_]+$/.test(key)) return 'key 只能包含小写字母、数字、下划线'
  if (key.startsWith('__')) return '禁止以 __ 开头'
  if (key.length > 128) return 'key 长度不能超过 128 字符'
  if (PROTECTED_PROMETHEUS_LABELS.includes(key)) return `禁止覆盖 Prometheus 内置 label（${key}）`
  return null
}

function nowStr(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

/**
 * 表单分组小标题（对齐《前端标准》§8：「>6 个字段或需分组」的表单用 Drawer + 分组小标题）。
 * 资源新增 / 编辑表单字段数在 12 ~ 14 项之间，故统一使用 720px Drawer 并分组呈现。
 */
function FormSection({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          paddingLeft: 10,
          borderLeft: '3px solid #0ECDEB',
          marginBottom: 12,
        }}
      >
        <Text strong style={{ fontSize: 13.5 }}>
          {title}
        </Text>
        {desc && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {desc}
          </Text>
        )}
      </div>
      {children}
    </div>
  )
}

// {v2.2} 联动：按资源类别 + 标签 key 查找模板中对应的映射来源（用于 system 标签标注「来自 XX 模板 · app_name→app」）
function findTemplateSource(resourceType: ResourceCategory, labelKey: string): { templateName: string; sourceField: string } | null {
  const tpl =
    mockLabelTemplates.find((t) => t.resource_category === resourceType && t.is_default) ??
    mockLabelTemplates.find((t) => t.resource_category === resourceType)
  if (!tpl) return null
  const mapping = tpl.mappings.find((m) => m.target_label === labelKey)
  if (!mapping) return null
  return { templateName: tpl.name, sourceField: mapping.source_field }
}

// {v2.2} 联动：该标签 key 是否被当前资源类别的模板映射为生成目标（用于新增标签时引导走模板）
function isTemplateMappedLabel(resourceType: ResourceCategory, labelKey: string): boolean {
  return mockLabelTemplates.some(
    (t) => t.resource_category === resourceType && t.mappings.some((m) => m.target_label === labelKey)
  )
}

export default function ResourcesPage() {
  const { message, modal } = App.useApp()
  const navigate = useNavigate()
  const [activeType, setActiveType] = useState<ResourceCategory>('host')
  const [search, setSearch] = useState('')
  // {v2.10} 网域作为资源列表筛选器（非全局上下文），默认全部网域，可切换单个网域
  const [filterDomain, setFilterDomain] = useState<string>('all')
  // {v2.17} 业务作为资源列表筛选器（网域与业务是两个正交维度，资源双归属）
  const [filterBusiness, setFilterBusiness] = useState<string>('all')
  // {v2.22} 决策 47-3（修订 31-M1）：采集状态筛选器（全部 / 采集中 / 已下发未采到 / 未监控）。三态由 is_monitored（M01 只读）+ 健康度（M02 聚合 API）解析，M07 不计算/不写回
  const [filterCollection, setFilterCollection] = useState<string>('all')
  const [resources, setResources] = useState<Resource[]>(mockResources)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null)
  const [labels, setLabels] = useState<ResourceLabel[]>([])
  const [newLabelKey, setNewLabelKey] = useState('')
  const [newLabelValue, setNewLabelValue] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [editingResource, setEditingResource] = useState<Resource | null>(null)
  const [templateModalOpen, setTemplateModalOpen] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [resourceForm] = Form.useForm()
  // {v2.33} 决策 81：instance_ip 实时驱动网域 ip_cidrs 推导预览（可达性引导）
  const watchedInstanceIP = Form.useWatch('instance_ip', resourceForm) as string | undefined
  // {v2.33} 网域显式选择值：推导命中且与当前选择不一致时提供「采用」快捷采纳
  const watchedDomainId = Form.useWatch('network_domain_id', resourceForm) as string | undefined
  // {v2.35} 决策 84：「其他监控目标」表单首问「登记对象」的当前值（非持久字段，驱动 K8s 集群级 / 标准端点表单分流）
  const watchedDevicePreset = Form.useWatch('device_preset', resourceForm) as string | undefined

  // 表单当前类型：编辑取记录类型，新增取入口落到的 activeType
  const formType: ResourceCategory = editingResource?.resource_category ?? activeType
  // {v2.35} 决策 84：K8s 集群级端点分流由表单首问「登记对象 = K8s 集群（集群级端点）」驱动
  //   （决策 81 的双入口动线收编为表单内首问；新增入口收敛为 5 项、与列表 Tab 1:1）
  const k8sMode = formType === 'generic_target' && watchedDevicePreset === 'k8s_cluster'
  // {v2.33} 网域可达性推导预览：instance_ip 类采集端点（host / database / middleware / generic_target）参与；
  // application 采集端点是 endpoint（IP:Port）、本原型不做拆分解析，故不展示预览。
  const domainPreview = useMemo(
    () => (formType === 'application' ? { kind: 'empty' as const } : previewDomainByIP(watchedInstanceIP)),
    [watchedInstanceIP, formType]
  )

  const filteredData = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return resources.filter((item) => {
      if (item.resource_category !== activeType) return false
      if (filterDomain !== 'all' && item.network_domain_id !== filterDomain) return false
      if (filterBusiness !== 'all' && item.biz_code !== filterBusiness) return false
      // {v2.22} 决策 47-3（修订 31-M1）：采集状态三态筛选 = resolveCollectionStatus（is_monitored + 健康度）
      if (filterCollection !== 'all' && resolveCollectionStatus(item) !== filterCollection) return false
      if (!keyword) return true
      const texts: (string | undefined)[] = [
        item.instance_name,
        item.hostname,
        item.instance_ip,
        item.app_code,
        item.app_code ? resolveAppName(item.app_code) : undefined,
        resolveBizName(item.biz_code),
        item.cluster,
        item.env,
        item.owner,
      ]
      if (isDatabaseResource(item)) texts.push(item.database_type)
      if (isMiddlewareResource(item)) texts.push(item.middleware_type)
      if (isApplicationResource(item)) texts.push(item.service_name)
      if (isGenericTargetResource(item)) texts.push(item.target_name, item.exporter_type)
      return texts.some((t) => (t ?? '').toLowerCase().includes(keyword))
    })
  }, [resources, activeType, search, filterDomain, filterBusiness, filterCollection])

  // ---------- 详情抽屉：标签管理 ----------
  const handleOpenDetail = (record: Resource) => {
    setSelectedResource(record)
    const list = mockResourceLabels[record.resource_id] || [
      {
        label_id: `system-${record.resource_id}-instance`,
        resource_id: record.resource_id,
        label_key: 'instance',
        label_value: `${record.instance_ip || record.hostname || '-'}:9100`,
        source: 'system',
        is_editable: false,
        created_at: record.created_at,
        updated_at: record.updated_at,
      },
    ]
    setLabels([...list].sort((a, b) => LABEL_SOURCE_PRIORITY[b.source] - LABEL_SOURCE_PRIORITY[a.source]))
    setNewLabelKey('')
    setNewLabelValue('')
    setDrawerOpen(true)
  }

  const handleCloseDetail = () => {
    setDrawerOpen(false)
    setSelectedResource(null)
    setLabels([])
    setNewLabelKey('')
    setNewLabelValue('')
  }

  const handleLabelChange = (labelId: string, value: string) => {
    setLabels((prev) => prev.map((item) => (item.label_id === labelId ? { ...item, label_value: value, updated_at: nowStr() } : item)))
  }

  const keyError = validateLabelKey(newLabelKey)
  const cmdbConflict = labels.some((l) => l.source === 'cmdb' && l.label_key === newLabelKey)

  const handleAddLabel = () => {
    if (!selectedResource) return
    // {v2.8} 双场景治理：静态资源标签由 CMDB / Excel 治理，平台只读，不提供实例级打标
    if (selectedResource.resource_category !== 'application') {
      message.warning('静态资源标签由 CMDB / Excel 治理，平台只读，不提供实例级打标入口')
      return
    }
    if (keyError) {
      message.error(keyError)
      return
    }
    // {v2.2} 类型级变更引导：key 已被模板映射为生成目标时，引导走模板而非实例级手工覆盖
    const templateMapped = isTemplateMappedLabel(selectedResource.resource_category, newLabelKey.trim())
    if (templateMapped) {
      modal.confirm({
        title: '该标签由标签模板生成',
        content: `「${newLabelKey.trim()}」由当前资源类别的标签模板映射生成（如需修改请前往标签模板管理），确认仍要手动添加吗？`,
        okText: '仍要添加',
        cancelText: '前往标签模板',
        onCancel: () => {
          navigate('/label-templates')
        },
        onOk: () => {
          doAddUserLabel()
        },
      })
      return
    }
    if (cmdbConflict) {
      message.warning('该 key 将由 CMDB 覆盖，建议更换 key')
    }
    doAddUserLabel()
  }

  const doAddUserLabel = () => {
    if (!selectedResource) return
    const now = nowStr()
    const label: ResourceLabel = {
      label_id: `user-${Date.now()}`,
      resource_id: selectedResource.resource_id,
      label_key: newLabelKey,
      label_value: newLabelValue || '-',
      source: 'user',
      is_editable: true,
      created_at: now,
      updated_at: now,
    }
    setLabels((prev) => [...prev, label])
    setNewLabelKey('')
    setNewLabelValue('')
    message.success('标签已添加')
  }

  const handleDeleteLabel = (label: ResourceLabel) => {
    if (!label.is_editable) return
    setLabels((prev) => prev.filter((l) => l.label_id !== label.label_id))
    message.success('标签已删除')
  }

  // ---------- 新增 / 编辑资源 ----------
  // {v2.36} 决策 85：新增入口回归单一「新增资源」按钮，抽屉表单形态跟随当前资源类型 Tab（5 类 1:1）——
  //   K8s 集群不占类型入口（K8s 集群非资源类型，决策 77/84），登记动线收编在
  //   「其他监控目标」表单首问「登记对象」的 K8s 集群（集群级端点）子动线（决策 81/84）。
  type AddEntry = 'host' | 'database' | 'middleware' | 'application' | 'generic_target'

  /**
   * K8s 集群组件预设联动：选择 API Server / kube-state-metrics / etcd 后仅写入 exporter_type 判别值；
   * {v2.35} 决策 84：端口 / 路径 / 协议不再随表单带出（采集参数归 M01 默认采集配置，表单与详情不展示）。
   */
  const applyK8sPreset = (key: string) => {
    const preset = K8S_ENDPOINT_PRESETS.find((p) => p.key === key)
    if (!preset) return
    resourceForm.setFieldsValue({ exporter_type: preset.exporter_type })
  }

  /**
   * {v2.35} 决策 84：「其他监控目标」表单首问「登记对象」联动——
   * 选 K8s 集群（集群级端点）切集群表单（默认 API Server 判别值）；选其余端点类型写入 exporter_type 判别值
   * （供 M01 推导 monitor_type）。采集参数（端口 / 路径 / 协议）由 M01 默认采集配置按端点类型决定，
   * 本表单不再出现（决策 83 折中保留的「高级采集设置」已删除，消除与 M01 的双头维护）。
   */
  const applyDevicePreset = (key: string) => {
    if (key === 'k8s_cluster') {
      resourceForm.setFieldsValue({
        k8s_component: K8S_ENDPOINT_PRESETS[0].key,
        exporter_type: K8S_ENDPOINT_PRESETS[0].exporter_type,
      })
      return
    }
    const preset = DEVICE_ENDPOINT_PRESETS.find((p) => p.key === key)
    if (!preset) return
    resourceForm.setFieldsValue({ exporter_type: preset.exporter_type })
  }

  const openAdd = (entry: AddEntry) => {
    setEditingResource(null)
    // {v2.36} 决策 85：单一新增按钮、抽屉表单形态 = 当前 Tab；K8s 集群分流在「其他监控目标」表单首问
    setActiveType(entry)
    resourceForm.resetFields()
    resourceForm.setFieldsValue({
      // {v2.24} 决策 52：网域可留空，保存时按归属解析链自动推导（IP 网段推导 → 默认兜底）；blackbox 拨测取发起侧
      env: 'prod',
      status: 'online',
    })
    if (entry === 'generic_target') {
      // {v2.35} 决策 84：默认选中首个登记对象（网络设备 SNMP），仅写入 exporter_type 判别值；
      // K8s 集群（集群级端点）由用户在表单首问主动选择切换
      resourceForm.setFieldsValue({ device_preset: DEVICE_ENDPOINT_PRESETS[0].key })
      applyDevicePreset(DEVICE_ENDPOINT_PRESETS[0].key)
    }
    setEditOpen(true)
  }

  const openEditModal = (record: Resource) => {
    setEditingResource(record)
    resourceForm.resetFields()
    resourceForm.setFieldsValue({ ...record })
    // {v2.35} 决策 84：按 exporter_type 判别值反查「登记对象」——
    //   命中 K8s 组件预设 → 首问设为 K8s 集群（集群级端点），编辑态同样切集群表单形态；
    //   命中标准端点预设 → 反查端点类型；都未命中（早期登记 / Excel 导入的非标端点、存量拨测目标）
    //   不强制重选、不覆盖原判别值，表单首问留空
    if (record.resource_category === 'generic_target') {
      const k8sMatched = K8S_ENDPOINT_PRESETS.find((p) => p.exporter_type === record.exporter_type)
      const deviceMatched = DEVICE_ENDPOINT_PRESETS.find((p) => p.exporter_type && p.exporter_type === record.exporter_type)
      if (k8sMatched) {
        resourceForm.setFieldsValue({ device_preset: 'k8s_cluster', k8s_component: k8sMatched.key })
      } else if (deviceMatched) {
        resourceForm.setFieldsValue({ device_preset: deviceMatched.key })
      }
    }
    setEditOpen(true)
  }

  const handleDeleteResource = (record: Resource) => {
    modal.confirm({
      title: '删除资源',
      content: `确认删除资源「${record.instance_name || record.resource_id}」？删除后不可恢复。`,
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: () => {
        setResources((prev) => prev.filter((r) => r.resource_id !== record.resource_id))
        message.success('资源已删除')
      },
    })
  }

  // {v2.24} 决策 52：网域留空时按归属解析链自动推导——Blackbox 拨测取发起侧（不推导，落入所选/默认），
  // 其余资源用 IP + 网域已登记网段最长前缀推导（resolveDomainFromIP），均未匹配归默认兜底。
  const resolveNewDomainId = (type: ResourceCategory, values: Record<string, unknown>): string => {
    const explicitDomain = values.network_domain_id as string | undefined
    if (explicitDomain) return explicitDomain
    const isBlackbox =
      type === 'generic_target' && (values.exporter_type as string | undefined) === 'blackbox_exporter'
    if (isBlackbox) return 'default'
    return resolveDomainFromIP(values.instance_ip as string | undefined).domain_id
  }

  const buildNewResource = (type: ResourceCategory, values: Record<string, unknown>): Resource => {
    const base = {
      network_domain_id: resolveNewDomainId(type, values),
      // {v2.18} 业务必填：来自业务分组字典下拉（决策 13/14/17/21），存不可变编码 biz_code
      biz_code: values.biz_code as string | undefined,
      source_type: 'manual' as const,
      // 决策 92：应用归属存不可变编码 app_code（应用字典下拉，展示名由字典解析）
      app_code: values.app_code as string | undefined,
      env: values.env as Env | undefined,
      cluster: values.cluster as string | undefined,
      owner: values.owner as string | undefined,
      status: (values.status as ResourceStatus) || 'online',
      // {v2.22} 决策 47-3：新建资源 is_monitored 默认 false——新资源尚未被任何 Job 选中，采集状态应展示「未监控」（真实由 M01 注册采集后置 true，M07 只读）
      is_monitored: false,
      created_at: nowStr(),
      updated_at: nowStr(),
    }
    switch (type) {
      case 'host':
        return {
          resource_id: `res-host-${Date.now()}`,
          resource_category: 'host' as const,
          instance_name: values.instance_name as string,
          hostname: values.hostname as string,
          instance_ip: values.instance_ip as string,
          os_type: values.os_type as string | undefined,
          os_version: values.os_version as string | undefined,
          ...base,
        }
      case 'database':
        // {v2.13} 数据库资源（PRD 5.7.1，决策 D19）
        return {
          resource_id: `res-db-${Date.now()}`,
          resource_category: 'database' as const,
          instance_name: values.instance_name as string | undefined,
          database_type: values.database_type as string,
          instance_ip: values.instance_ip as string,
          port: values.port as number,
          version: values.version as string | undefined,
          connection_string: values.connection_string as string | undefined,
          ...base,
        }
      case 'middleware':
        return {
          resource_id: `res-mw-${Date.now()}`,
          resource_category: 'middleware' as const,
          instance_name: values.instance_name as string | undefined,
          middleware_type: values.middleware_type as string,
          instance_ip: values.instance_ip as string,
          port: values.port as number,
          version: values.version as string | undefined,
          connection_string: values.connection_string as string | undefined,
          ...base,
        }
      case 'application':
        return {
          resource_id: `res-app-${Date.now()}`,
          resource_category: 'application' as const,
          instance_name: values.instance_name as string | undefined,
          service_name: values.service_name as string,
          health_check_url: values.health_check_url as string | undefined,
          protocol: values.protocol as AppProtocol | undefined,
          endpoint: values.endpoint as string | undefined,
          port: values.port as number | undefined,
          ...base,
        }
      case 'generic_target':
        // {v2.35} 决策 84：port / metrics_path / scheme 不再随 M07 表单采集——
        //   采集参数归 M01 默认采集配置（ExporterTemplate / CITypeExporterMapping），M09 生成配置时按解析链取值；
        //   新资源不落这三项，exporter_type 判别值仍随表提交（供 M01 推导 monitor_type）
        return {
          resource_id: `res-gen-${Date.now()}`,
          resource_category: 'generic_target' as const,
          instance_name: values.instance_name as string | undefined,
          target_name: values.target_name as string,
          instance_ip: values.instance_ip as string,
          custom_labels: values.custom_labels as string | undefined,
          exporter_type: values.exporter_type as string | undefined,
          ...base,
        }
    }
  }

  const buildEditedResource = (record: Resource, values: Record<string, unknown>): Resource => {
    const common = {
      // {v2.24} 决策 52：网域留空同样按归属解析链推导（同新增动线）
      network_domain_id: resolveNewDomainId(record.resource_category, values),
      // {v2.18} 业务必填：来自业务分组字典下拉（决策 13/14/17/21），存不可变编码 biz_code
      biz_code: values.biz_code as string | undefined,
      // 决策 92：应用归属存不可变编码 app_code（应用字典下拉，展示名由字典解析）
      app_code: values.app_code as string | undefined,
      env: values.env as Env | undefined,
      cluster: values.cluster as string | undefined,
      owner: values.owner as string | undefined,
      status: (values.status as ResourceStatus) || 'online',
      updated_at: nowStr(),
    }
    switch (record.resource_category) {
      case 'host':
        return {
          ...record,
          ...common,
          hostname: values.hostname as string,
          instance_ip: values.instance_ip as string,
          os_type: values.os_type as string | undefined,
          os_version: values.os_version as string | undefined,
        }
      case 'database':
        // {v2.13} 数据库资源编辑（PRD 5.7.1，决策 D19）
        return {
          ...record,
          ...common,
          database_type: values.database_type as string,
          instance_ip: values.instance_ip as string,
          port: values.port as number,
          version: values.version as string | undefined,
          connection_string: values.connection_string as string | undefined,
        }
      case 'middleware':
        return {
          ...record,
          ...common,
          middleware_type: values.middleware_type as string,
          instance_ip: values.instance_ip as string,
          port: values.port as number,
          version: values.version as string | undefined,
          connection_string: values.connection_string as string | undefined,
        }
      case 'application':
        return {
          ...record,
          ...common,
          service_name: values.service_name as string,
          health_check_url: values.health_check_url as string | undefined,
          protocol: values.protocol as AppProtocol | undefined,
          endpoint: values.endpoint as string | undefined,
          port: values.port as number | undefined,
        }
      case 'generic_target':
        // {v2.35} 决策 84：port / metrics_path / scheme 编辑态也不再从表单覆盖——存量值随 ...record 原样保留（只读、不再展示）
        return {
          ...record,
          ...common,
          target_name: values.target_name as string,
          instance_ip: values.instance_ip as string,
          custom_labels: values.custom_labels as string | undefined,
          exporter_type: values.exporter_type as string | undefined,
        }
    }
  }

  const handleSaveResource = () => {
    resourceForm.validateFields().then((values) => {
      if (editingResource) {
        const updated = buildEditedResource(editingResource, values)
        setResources((prev) => prev.map((r) => (r.resource_id === editingResource.resource_id ? updated : r)))
        message.success('资源已更新')
      } else {
        const created = buildNewResource(activeType, values)
        setResources((prev) => [...prev, created])
        message.success('资源已新增')
      }
      setEditOpen(false)
      setEditingResource(null)
      resourceForm.resetFields()
    })
  }

  // ---------- 表单字段渲染（按资源类别，PRD 5.6~5.9） ----------
  const renderTypeFields = (type: ResourceCategory) => {
    switch (type) {
      case 'host':
        return (
          <>
            {/* {v2.33} 决策 81「登记主机」入口引导：OS 层 node_exporter :9100；K8s 节点的 K8s 维度指标走集群入口 Job 动态发现，此处不重复登记 */}
            {!editingResource && (
              <Callout tone="info" icon={<InfoCircleFilled />} title="登记主机（OS 层监控 · node_exporter :9100）" style={{ marginBottom: 16 }}>
                本入口逐台登记主机的 <Text strong>操作系统层</Text> 监控，采集端口固定 node_exporter <Text code style={{ fontSize: 12 }}>:9100</Text>。
                若该机是 K8s 节点，其 K8s 维度指标（kubelet / cAdvisor / Pod）<Text strong>已由「其他监控目标」中登记的 K8s 集群端点对应的采集 Job（kubernetes_sd）动态发现</Text>，
                本条记录只管 OS 层、无需重复登记。网域按 <Text code style={{ fontSize: 12 }}>:9100</Text> 可达侧（通常为管理网）选择。
              </Callout>
            )}
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="实例名" name="instance_name" rules={[{ required: true, message: '请输入实例名' }]} extra="主机模板必填，生成 hostname 标签">
                  <Input placeholder="如 prod-web-01" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="主机名" name="hostname" rules={[{ required: true, message: '请输入主机名' }]} extra="主机场景下默认与实例名一致">
                  <Input placeholder="如 prod-web-01.volc" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  label="管理 IP"
                  name="instance_ip"
                  rules={[
                    { required: true, message: '请输入管理 IP' },
                    { pattern: IPV4_RE, message: 'IPv4 格式不正确' },
                  ]}
                  extra="采集端点 IP：node_exporter :9100 在哪个 IP 可达就填哪个（K8s 双网卡节点填管理网可达侧 IP），用于按网段推导网域"
                >
                  <Input placeholder="如 10.0.1.11" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="操作系统"
                  name="os_type"
                  rules={[{ required: true, message: '请选择操作系统' }]}
                  extra="必填；内置字典选择（可搜索/自定义），采集实例定位依赖它，越界拼写将无法匹配采集候选"
                >
                  <AutoComplete
                    options={OS_OPTIONS}
                    placeholder="选择或输入（如 Ubuntu / CentOS / Windows Server）"
                    allowClear
                    filterOption={(inputValue, option) =>
                      String(option?.value ?? '').toLowerCase().includes(inputValue.toLowerCase())
                    }
                  />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item label="系统版本" name="os_version">
              <Input placeholder="如 7.9" />
            </Form.Item>
          </>
        )
      case 'database':
        // {v2.13} 数据库资源表单（PRD 5.7.1，决策 D19）
        return (
          <>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="实例名" name="instance_name">
                  <Input placeholder="如 mysql-order-01" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="数据库类型" name="database_type" rules={[{ required: true, message: '请选择数据库类型' }]}>
                  <Select placeholder="请选择">
                    {DATABASE_TYPE_OPTIONS.map((t) => (
                      <Option key={t} value={t}>
                        {t}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  label="服务 IP"
                  name="instance_ip"
                  rules={[
                    { required: true, message: '请输入服务 IP' },
                    { pattern: IPV4_RE, message: 'IPv4 格式不正确' },
                  ]}
                >
                  <Input placeholder="如 10.0.2.12" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="服务端口"
                  name="port"
                  rules={[
                    { required: true, message: '请输入服务端口' },
                    { type: 'number', min: 1, max: 65535, message: '端口范围 1~65535' },
                  ]}
                >
                  <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="如 3306" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="版本" name="version">
                  <Input placeholder="如 8.0" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="连接串" name="connection_string">
                  <Input placeholder="如 mysql://user:****@10.0.2.12:3306/order" />
                </Form.Item>
              </Col>
            </Row>
          </>
        )
      case 'middleware':
        return (
          <>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="实例名" name="instance_name">
                  <Input placeholder="如 kafka-01" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="中间件类型" name="middleware_type" rules={[{ required: true, message: '请选择中间件类型' }]}>
                  <Select placeholder="请选择">
                    {MIDDLEWARE_TYPE_OPTIONS.map((t) => (
                      <Option key={t} value={t}>
                        {t}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  label="服务 IP"
                  name="instance_ip"
                  rules={[
                    { required: true, message: '请输入服务 IP' },
                    { pattern: IPV4_RE, message: 'IPv4 格式不正确' },
                  ]}
                >
                  <Input placeholder="如 10.0.2.11" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="服务端口"
                  name="port"
                  rules={[
                    { required: true, message: '请输入服务端口' },
                    { type: 'number', min: 1, max: 65535, message: '端口范围 1~65535' },
                  ]}
                >
                  <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="如 6379" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="版本" name="version">
                  <Input placeholder="如 7.2" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="连接串" name="connection_string" extra="敏感信息可加密存储">
                  <Input placeholder="敏感信息可加密存储" />
                </Form.Item>
              </Col>
            </Row>
          </>
        )
      case 'application':
        return (
          <>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="服务名" name="service_name" rules={[{ required: true, message: '请输入服务名' }]}>
                  <Input placeholder="如 order-service" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="协议" name="protocol">
                  <Select placeholder="请选择" allowClear>
                    {PROTOCOL_OPTIONS.map((p) => (
                      <Option key={p} value={p}>
                        {p}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              label="健康检查 URL"
              name="health_check_url"
              rules={[{ type: 'url', message: 'URL 格式不正确' }]}
              extra="作为资源字段由本模块维护；拨测任务的配置由「监控策略」模块负责"
            >
              <Input placeholder="如 http://ip:9100/-/healthy" />
            </Form.Item>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="业务指标端点" name="endpoint">
                  <Input placeholder="如 10.0.3.11:9100" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="服务端口"
                  name="port"
                  rules={[{ type: 'number', min: 1, max: 65535, message: '端口范围 1~65535' }]}
                >
                  <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="如 9100" />
                </Form.Item>
              </Col>
            </Row>
          </>
        )
      case 'generic_target':
        // {v2.35} 决策 84：兜底类「其他监控目标」表单统一为首问「登记对象」分流（决策 81 双入口收编）——
        //   K8s 集群（集群级端点）/ 网络设备（SNMP）/ GPU 服务器（DCGM）/ 自定义 HTTP 端点；
        //   exporter_type 是隐藏的端点子类型判别值（供采集侧推导 monitor_type，决策 77/83）；
        //   port / metrics_path / scheme 等采集参数归 M01 默认采集配置（ExporterTemplate / CITypeExporterMapping），
        //   本表单与详情抽屉不再出现（决策 83 折中保留的「高级采集设置」删除，消除与 M01 双头维护）。
        return (
          <>
            {k8sMode ? (
              <Callout tone="info" icon={<ClusterOutlined />} title="登记 K8s 集群（仅集群级端点）" style={{ marginBottom: 16 }}>
                选择集群组件（API Server / kube-state-metrics / etcd）登记为集群级监控目标。
                <Text strong> 集群内节点、Pod、容器指标由该网域的 K8s 采集 Job（kubernetes_sd）动态发现，无需逐台登记。</Text>
                网域请选<Text strong>集群所在网络可达区域</Text>（overlay 集群通常独立建域）；节点 OS 层监控请切换到「主机」Tab 新增资源登记。
              </Callout>
            ) : (
              <Callout tone="info" icon={<ApiOutlined />} title="登记其他监控目标" style={{ marginBottom: 16 }}>
                登记主机、数据库、中间件、应用服务之外，可通过 HTTP 端点暴露指标的对象（网络设备 / 硬件 / 自定义指标端点）。
                采集端口、采集路径、协议等技术参数由平台「默认采集配置」统一决定，无需在此填写。
              </Callout>
            )}
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  label="登记对象"
                  name="device_preset"
                  rules={editingResource ? [] : [{ required: true, message: '请选择登记对象' }]}
                  extra={k8sMode ? '已切换为 K8s 集群（集群级端点）登记' : '选择登记对象；K8s 集群端点请选「K8s 集群」'}
                >
                  <Select
                    placeholder="选择登记对象"
                    onChange={(v) => applyDevicePreset(v)}
                    options={[
                      ...DEVICE_ENDPOINT_PRESETS.map((p) => ({ value: p.key, label: p.label })),
                      { value: 'k8s_cluster', label: 'K8s 集群（集群级端点）' },
                    ]}
                  />
                </Form.Item>
              </Col>
              {k8sMode && (
                <Col span={12}>
                  <Form.Item label="集群组件" name="k8s_component" rules={[{ required: true, message: '请选择集群组件' }]} extra="用于识别端点子类型（采集侧据此推导监控类型）">
                    <Select
                      placeholder="选择集群级组件"
                      onChange={(v) => applyK8sPreset(v)}
                      options={K8S_ENDPOINT_PRESETS.map((p) => ({ value: p.key, label: p.label }))}
                    />
                  </Form.Item>
                </Col>
              )}
              <Col span={12}>
                <Form.Item label="目标名称" name="target_name" rules={[{ required: true, message: '请输入目标名称' }]} extra={k8sMode ? '建议「集群名-组件」命名' : undefined}>
                  <Input placeholder={k8sMode ? '如 prod-k8s-apiserver' : '如 核心交换-01'} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  label="端点 IP / 域名"
                  name="instance_ip"
                  rules={[{ required: true, message: '请输入端点 IP 或域名' }]}
                  extra={k8sMode ? '集群组件实际可达地址（API Server 常为 VIP / LB / 节点 IP），据此推导集群网域' : '该对象的指标在哪个 IP / 域名上可达，平台据此推导网域'}
                >
                  <Input placeholder={k8sMode ? '如 172.20.0.10' : '如 172.16.0.1'} />
                </Form.Item>
              </Col>
            </Row>
            {/* {v2.35} 决策 84：端口 / 采集路径 / 协议等采集参数不再出现在本表单——
                由 M01 默认采集配置统一承载（解析链：Job 覆盖 → CITypeExporterMapping → ExporterTemplate），
                实例偏差正规出口 = M01 映射端口编辑（MVP）/ Resource.scrape_port（{v0.2}），M07 不做第二配置点 */}
            <Form.Item
              label="自定义标签"
              name="custom_labels"
              rules={[{ pattern: CUSTOM_LABELS_RE, message: '格式：key1=value1;key2=value2' }]}
              extra="支持 key1=value1;key2=value2 格式"
            >
              <Input placeholder="如 device_type=snmp_switch;vendor=h3c" />
            </Form.Item>
            {/* exporter_type 是对用户隐藏的端点子类型判别值（登记对象预设写入，供采集侧推导 monitor_type），随表隐藏提交 */}
            <Form.Item name="exporter_type" hidden>
              <Input />
            </Form.Item>
          </>
        )
    }
  }

  const renderCommonFields = () => {
    const appClusterRequired = ['application', 'database', 'middleware'].includes(formType)
    // {v2.33} K8s 集群入口 cluster 必填（决策 77 集群诉求四归属：分组维度 → cluster 字段 / 标签）
    const clusterRequired = appClusterRequired || k8sMode
    // {v2.40} 决策 95：generic_target 的 app_code / biz_code 二选一必填（至少填一个）
    const genAtLeastOne = formType === 'generic_target'
    // {v2.33} 决策 81：网域字段可达性引导——用用户语言提问，不问拓扑 / 行政归属
    const domainQuestion = k8sMode
      ? '该集群端点从哪条链路够得着？（overlay 集群通常独立建域；节点 / Pod 由该域 Job 自动发现）'
      : formType === 'host'
        ? '这台机器的采集端口（:9100）从哪条链路够得着？通常选管理网可达侧网域。'
        : '这个目标的采集端口从哪条链路够得着？平台能直连选「中心直连域」，需经隔离区中转选对应「采集节点域」。'
    return (
    <>
      <Row gutter={16}>
        <Col span={12}>
          {/* 决策 92：应用归属 = 应用字典下拉，存不可变编码 app_code；停用条目不可新选，存量资源编辑时保留历史值 */}
          <Form.Item
            label="应用"
            name="app_code"
            rules={
              appClusterRequired
                ? [{ required: true, message: '请选择应用' }]
                : genAtLeastOne
                  ? [
                      {
                        validator: (_, value) =>
                          value || resourceForm.getFieldValue('biz_code')
                            ? Promise.resolve()
                            : Promise.reject(new Error('业务与应用至少填一个')),
                      },
                    ]
                  : []
            }
            extra={
              genAtLeastOne
                ? '与其他监控目标：业务与应用二选一必填（决策 95），为空时不注入 app 标签'
                : appClusterRequired
                  ? '应用服务 / 数据库 / 中间件必填（决策 92）；多库 / 多 schema 分属多应用为 {v0.2+}，MVP 每次仅选一个主应用'
                  : '主机：可空后补，为空时不注入 app 标签'
            }
          >
            <Select placeholder="请选择应用" showSearch allowClear optionFilterProp="label">
              {(() => {
                const enabledOptions = mockApplicationDict
                  .filter((d) => d.status === 'enabled')
                  .map((d) => (
                    <Option key={d.app_code} value={d.app_code}>
                      {d.app_name}（{d.app_code}）
                    </Option>
                  ))
                // 编辑存量资源：其应用已停用 / 已不在字典时保留历史值展示（不可新选，但不清空）
                const current = editingResource?.app_code
                if (current && !mockApplicationDict.some((d) => d.app_code === current && d.status === 'enabled')) {
                  return [
                    ...enabledOptions,
                    <Option key={current} value={current}>
                      {resolveAppName(current)}（已停用）
                    </Option>,
                  ]
                }
                return enabledOptions
              })()}
            </Select>
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item label="环境" name="env" rules={[{ required: true, message: '请选择环境' }]} extra="映射为 env 标签">
            <Select placeholder="请选择">
              {ENV_VALUES.map((v) => (
                <Option key={v} value={v}>
                  {v}
                </Option>
              ))}
            </Select>
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item
            label="集群"
            name="cluster"
            rules={clusterRequired ? [{ required: true, message: '请输入集群' }] : []}
            extra={
              k8sMode
                ? 'K8s 集群入口必填：集群名作为 cluster 标签，用于按集群分组、与该集群动态发现的节点 / Pod 指标归并'
                : '应用服务 / 数据库 / 中间件必填；主机场景下子应用编码为空时取 VPC；主机与其他监控目标可空'
            }
          >
            <Input placeholder={k8sMode ? '如 prod-k8s（集群名，作为 cluster 标签）' : '如 k8s-prod'} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item label="负责人" name="owner" extra="MVP 用户填写；后续版本优先取自 CMDB 维护人">
            <Input placeholder="负责人姓名" />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item
            label="网域"
            name="network_domain_id"
            extra={
              <Space direction="vertical" size={3} style={{ marginTop: 2, width: '100%' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {domainQuestion}
                </Text>
                {/* {v2.33} instance_ip 实时 ip_cidrs 推导预览（仅辅助、不替代显式选择） */}
                {domainPreview.kind === 'unique' && (
                  <Text style={{ fontSize: 12, color: '#722ED1' }}>
                    <InfoCircleOutlined style={{ marginRight: 4 }} />
                    按当前 IP {watchedInstanceIP} 推导归属：{domainPreview.domain.name}（命中 {domainPreview.cidr}，最长前缀优先）
                    {watchedDomainId !== domainPreview.domain.id && (
                      <Button
                        type="link"
                        size="small"
                        style={{ padding: 0, height: 'auto', fontSize: 12, marginLeft: 6 }}
                        onClick={() => resourceForm.setFieldValue('network_domain_id', domainPreview.domain.id)}
                      >
                        采用
                      </Button>
                    )}
                  </Text>
                )}
                {domainPreview.kind === 'ambiguous' && (
                  <Text style={{ fontSize: 12, color: '#FA8C16' }}>
                    <WarningOutlined style={{ marginRight: 4 }} />
                    当前 IP 同时命中多个网域（
                    {domainPreview.hits.map((h) => `${h.domain.name} ${h.cidr}`).join('、')}
                    ），地址段跨域重叠、无法自动判定，请人工选择。
                  </Text>
                )}
                {domainPreview.kind === 'none' && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    当前 IP 未命中任何已登记网段，保存时将归入默认网域兜底；也可人工指定。
                  </Text>
                )}
                <Text type="secondary" style={{ fontSize: 12 }}>
                  可留空：留空按归属解析链自动推导（显式指定 &gt; 冲突告警 &gt; 按 IP 与网域网段最长前缀推导 &gt; 默认兜底）；Blackbox 拨测目标取发起侧、不推导。
                </Text>
              </Space>
            }
          >
            <Select
              placeholder="留空则由平台按归属自动推导"
              allowClear
              showSearch
              optionFilterProp="label"
              optionLabelProp="label"
              popupMatchSelectWidth={340}
            >
              {mockNetworkDomains.map((d) => (
                <Option key={d.id} value={d.id} label={`${d.name}（${d.id}）`}>
                  <div style={{ lineHeight: 1.3, padding: '2px 0' }}>
                    <div>
                      {d.name}（{d.id}）
                    </div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {domainReachabilityText(d)}
                    </Text>
                  </div>
                </Option>
              ))}
            </Select>
          </Form.Item>
        </Col>
        <Col span={12}>
          {/* {v2.18} 业务下拉：业务分组字典由配置预置（决策 13/14/17）；biz 标签只承载不可变编码 biz_code；停用条目不可选用 */}
          {/* {v2.40} 决策 93：biz_code 必填按类型分化——application 必填、host/db/middleware 可空后补、generic_target 与 app 二选一 */}
          <Form.Item
            label="业务"
            name="biz_code"
            rules={
              formType === 'application'
                ? [{ required: true, message: '请选择业务' }]
                : genAtLeastOne
                  ? [
                      {
                        validator: (_, value) =>
                          value || resourceForm.getFieldValue('app_code')
                            ? Promise.resolve()
                            : Promise.reject(new Error('业务与应用至少填一个')),
                      },
                    ]
                  : []
            }
            extra={
              formType === 'application'
                ? '应用上线后必填；业务归属由业务分组字典维护，用于按业务聚合监控（编码不可变）'
                : genAtLeastOne
                  ? '与其他监控目标：业务与应用二选一必填（决策 95）；有业务归属填业务，否则填应用'
                  : '可空后补（决策 93）：静态资源登记时承载应用，业务待应用上线后再补，为空不注入 biz 标签'
            }
          >
            <Select placeholder="请选择业务" showSearch optionFilterProp="label">
              {mockBusinessDomains
                .filter((d) => d.status === 'enabled')
                .map((d) => (
                  <Option key={d.biz_code} value={d.biz_code}>
                    {d.biz_name}（{d.biz_code}）
                  </Option>
                ))}
            </Select>
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item label="运行状态" name="status" rules={[{ required: true, message: '请选择运行状态' }]} extra="孤儿状态为后续版本预留，不在表单选项中">
            <Select placeholder="请选择">
              {STATUS_VALUES.map((s) => (
                <Option key={s} value={s}>
                  {STATUS_MAP[s]}
                </Option>
              ))}
            </Select>
          </Form.Item>
        </Col>
      </Row>
    </>
    )
  }

  // ---------- 表格列（按资源类别固定展示，PRD 3.1） ----------
  //
  // {v2.32} 列数治理（对齐《前端标准》§9：列表只展示扫读所需关键列、建议 ≤8 列，其余字段下沉详情 Drawer）：
  //   五类 Tab 统一为 **8 列**结构，保证跨类型扫读节奏一致 ——
  //   主标识（fixed left）/ 类型或身份 / 网域 / 归属来源 / 业务 / 运行状态 / 采集状态 / 操作（fixed right）
  //   下沉详情 Drawer 的字段：端口 / 版本 / 操作系统 / 应用·环境·集群 / 健康检查 URL / 协议 / 端点 /
  //   采集路径 / 自定义标签 / 数据来源 / 负责人 / CMDB 预留字段 —— 资源详情 Drawer 已逐项完整承载。
  //   类型字段（数据库类型 / 中间件类型 / 端点类型）随主标识行内 Tag 呈现，不单独占列。
  // {v2.25} 「采集状态」列口径：数据 = M01 选中关系（is_monitored 只读映射，取 DB 当前值、不感知 M09 下发时序）
  //   + M02 健康度 / 覆盖率聚合 API（按 resource_id 回连，列表级聚合调用、禁止逐行查询 TQ-6）。
  const getColumns = (type: ResourceCategory): TableProps<Resource>['columns'] => {
    /** 主标识列：单行呈现（§9 禁止行内多行文本块），可带一个行内类型 Tag */
    const identityColumn = (title: string, cell: (r: Resource) => ReactNode) => ({
      title,
      key: 'identity',
      fixed: 'left' as const,
      width: 230,
      render: (_: unknown, record: Resource) => <Space size={6}>{cell(record)}</Space>,
    })
    /** {v2.23} IP 地址列：主标识之后的第一扫读列（采集目标地址） */
    const ipColumn = {
      title: 'IP 地址',
      dataIndex: 'instance_ip',
      key: 'instance_ip',
      width: 140,
      render: (value?: string) => (value ? <Text style={{ fontSize: 12 }}>{value}</Text> : '-'),
    }
    const domainColumn = {
      title: '网域',
      dataIndex: 'network_domain_id',
      key: 'network_domain_id',
      width: 130,
      render: (value: string) => <Tag color="cyan">{value}</Tag>,
    }
    // {v2.24} 决策 52：归属来源列——标注网域归属由哪条解析路径确定（显式指定 / 冲突 / 网段推导 / 默认兜底 / 发起侧），列头 hover 提示解析链
    const domainSourceColumn = {
      title: (
        <span>
          <Tooltip title="网域归属解析链：显式指定 > 冲突告警 > 按 IP 与网域网段推导 > 默认兜底；Blackbox 拨测取发起侧（采集 Job）网域、不参与推导">
            归属来源
            <InfoCircleOutlined style={{ marginLeft: 4, color: 'rgba(0,0,0,0.35)', fontSize: 12 }} />
          </Tooltip>
        </span>
      ),
      key: 'domain_source',
      width: 110,
      render: (_: unknown, record: Resource) => {
        const att = resolveDomainAttribution(record)
        const color: Record<DomainAttributionSource, string> = {
          explicit: 'blue',
          conflict: 'red',
          ip_derived: 'purple',
          default: 'default',
          blackbox: 'green',
        }
        return (
          <Tooltip title={att.hint}>
            <Tag color={color[att.source]}>{DOMAIN_SOURCE_LABELS[att.source]}</Tag>
          </Tooltip>
        )
      },
    }
    // {v2.18} 业务列：展示业务字典 biz_name，停用业务加「已停用」标识（网域与业务双归属正交维度，决策 13/14/17/21）
    const businessColumn = {
      title: '业务',
      dataIndex: 'biz_code',
      key: 'biz_code',
      width: 140,
      render: (value?: string) =>
        value ? (
          <Tag color={isBizDisabled(value) ? 'default' : 'geekblue'}>
            {resolveBizName(value)}
            {isBizDisabled(value) ? '（已停用）' : ''}
          </Tag>
        ) : '-',
    }
    // {v2.40} 决策 92/96 应用列：展示应用字典 app_name，缺条目回退 app_code，停用加「已停用」标识（与业务列正交，M:N 两维）
    const appColumn = {
      title: '应用',
      dataIndex: 'app_code',
      key: 'app_code',
      width: 150,
      render: (value?: string) =>
        value ? (
          <Tag color={isAppDisabled(value) ? 'default' : 'cyan'}>
            {resolveAppName(value)}
            {isAppDisabled(value) ? '（已停用）' : ''}
          </Tag>
        ) : '-',
    }
    const statusColumn = {
      // {v2.21} 决策 32：「状态」更名「运行状态」；数据来源（CMDB / Excel / 手动）非 M07 自身功能，以列头 hover 隐藏提示标注、不占列宽
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
      width: 110,
      render: (value: ResourceStatus) => <Badge color={STATUS_COLOR[value]} text={STATUS_MAP[value]} />,
    }
    // {v2.22} 决策 47-3（修订 31-M1）：采集状态三态——采集中 / 已下发未采到 / 未监控。
    // 状态语义统一用 Badge 语义色 + 文字（《前端标准》§8：颜色不得作为唯一语义）；异常驱动：仅「已下发未采到」高饱和。
    const monitoredColumn = {
      title: (
        <span>
          <Tooltip title="采集状态数据来源：选中关系由「监控策略」模块（M01）维护、健康度由「查询中心」（M02）聚合计算，本模块只读展示">
            采集状态
            <InfoCircleOutlined style={{ marginLeft: 4, color: 'rgba(0,0,0,0.35)', fontSize: 12 }} />
          </Tooltip>
        </span>
      ),
      key: 'collection_status',
      width: 130,
      render: (_: unknown, record: Resource) => {
        const status = resolveCollectionStatus(record)
        const meta = COLLECTION_STATUS_META[status]
        const badge = <Badge status={COLLECTION_BADGE_STATUS[status]} text={meta.label} />
        return meta.anomaly ? (
          <Tooltip title={meta.tooltip}>
            <span>{badge}</span>
          </Tooltip>
        ) : (
          badge
        )
      },
    }
    // 操作层次（《前端标准》§8/§9）：主操作 = 品牌色文字 + 加粗、且全行唯一（「详情」）；
    // 次要操作 = 灰色文字；低频操作（删除）收进「更多」菜单，避免行内出现多个同级入口。
    const actionColumn = {
      title: '操作',
      key: 'actions',
      fixed: 'right' as const,
      width: 168,
      render: (_: unknown, record: Resource) => (
        <Space size={12}>
          <Button
            type="link"
            size="small"
            style={{ color: '#0ECDEB', fontWeight: 600, padding: 0 }}
            onClick={(e) => {
              e.stopPropagation()
              handleOpenDetail(record)
            }}
          >
            详情
          </Button>
          <Button
            type="link"
            size="small"
            style={{ color: '#4E5969', padding: 0 }}
            onClick={(e) => {
              e.stopPropagation()
              openEditModal(record)
            }}
          >
            编辑
          </Button>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'delete',
                  danger: true,
                  icon: <DeleteOutlined />,
                  label: '删除',
                },
              ],
              onClick: ({ domEvent }) => {
                domEvent.stopPropagation()
                handleDeleteResource(record)
              },
            }}
            trigger={['click']}
          >
            <Button
              type="link"
              size="small"
              style={{ color: '#4E5969', padding: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              更多 <DownOutlined style={{ fontSize: 10 }} />
            </Button>
          </Dropdown>
        </Space>
      ),
    }

    switch (type) {
      case 'host': {
        // 9 列：实例名·主机名 / IP 地址 / 网域 / 归属来源 / 业务 / 应用 / 运行状态 / 采集状态 / 操作
        // 下沉详情：操作系统、系统版本、应用·环境·集群、数据来源、负责人
        const cols: TableProps<Resource>['columns'] = [
          identityColumn('实例名 / 主机名', (record) =>
            isHostResource(record) ? (
              <>
                <Text strong>{record.instance_name}</Text>
                <EllipsisText type="secondary" maxWidth={110}>
                  {record.hostname}
                </EllipsisText>
              </>
            ) : null
          ),
          ipColumn,
          domainColumn,
          domainSourceColumn,
          businessColumn,
          appColumn,
          statusColumn,
          monitoredColumn,
          actionColumn,
        ]
        return cols
      }
      case 'database': {
        // {v2.13} 数据库资源列表列（PRD 5.7.1，决策 D19）
        // 9 列：实例名（含数据库类型 Tag）/ IP 地址 / 网域 / 归属来源 / 业务 / 应用 / 运行状态 / 采集状态 / 操作
        // 下沉详情：端口、版本、连接串、应用·环境·集群、数据来源、负责人
        const cols: TableProps<Resource>['columns'] = [
          identityColumn('实例名', (record) =>
            isDatabaseResource(record) ? (
              <>
                <Text strong>{record.instance_name || record.resource_id}</Text>
                <Tag color="green">{record.database_type}</Tag>
              </>
            ) : null
          ),
          ipColumn,
          domainColumn,
          domainSourceColumn,
          businessColumn,
          appColumn,
          statusColumn,
          monitoredColumn,
          actionColumn,
        ]
        return cols
      }
      case 'middleware': {
        // 9 列：实例名（含中间件类型 Tag）/ IP 地址 / 网域 / 归属来源 / 业务 / 应用 / 运行状态 / 采集状态 / 操作
        // 下沉详情：端口、版本、连接串、应用·环境·集群、数据来源、负责人
        const cols: TableProps<Resource>['columns'] = [
          identityColumn('实例名', (record) =>
            isMiddlewareResource(record) ? (
              <>
                <Text strong>{record.instance_name || record.resource_id}</Text>
                <Tag color="geekblue">{record.middleware_type}</Tag>
              </>
            ) : null
          ),
          ipColumn,
          domainColumn,
          domainSourceColumn,
          businessColumn,
          appColumn,
          statusColumn,
          monitoredColumn,
          actionColumn,
        ]
        return cols
      }
      case 'application': {
        // 9 列：服务名 / 端点 / 网域 / 归属来源 / 业务 / 应用 / 运行状态 / 采集状态 / 操作
        // 下沉详情：健康检查 URL、协议、端口、应用·环境·集群、数据来源、负责人
        const cols: TableProps<Resource>['columns'] = [
          identityColumn('服务名', (record) =>
            isApplicationResource(record) ? <Text strong>{record.service_name}</Text> : null
          ),
          {
            title: '端点',
            key: 'endpoint',
            width: 190,
            render: (_: unknown, record: Resource) =>
              isApplicationResource(record) ? (
                <EllipsisText maxWidth={180}>{record.endpoint || '-'}</EllipsisText>
              ) : (
                '-'
              ),
          },
          domainColumn,
          domainSourceColumn,
          businessColumn,
          appColumn,
          statusColumn,
          monitoredColumn,
          actionColumn,
        ]
        return cols
      }
      case 'generic_target': {
        // 9 列：目标名称（含端点类型 Tag）/ IP 地址 / 网域 / 归属来源 / 业务 / 应用 / 运行状态 / 采集状态 / 操作
        // 下沉详情：端口、采集路径、协议、自定义标签、数据来源、负责人
        const cols: TableProps<Resource>['columns'] = [
          identityColumn('目标名称', (record) =>
            isGenericTargetResource(record) ? (
              <>
                <Text strong>{record.target_name}</Text>
                {record.exporter_type && <Tag>{endpointTypeLabel(record.exporter_type)}</Tag>}
              </>
            ) : null
          ),
          ipColumn,
          domainColumn,
          domainSourceColumn,
          businessColumn,
          appColumn,
          statusColumn,
          monitoredColumn,
          actionColumn,
        ]
        return cols
      }
    }
  }

  // ---------- 详情抽屉：类型字段 / CMDB 字段 ----------
  const typeFieldItems = (r: Resource) => {
    if (isHostResource(r)) {
      return [
        { key: 'os_type', label: '操作系统', children: r.os_type || '-' },
        { key: 'os_version', label: '系统版本', children: r.os_version || '-' },
      ]
    }
    if (isDatabaseResource(r)) {
      // {v2.13} 数据库资源详情（PRD 5.7.1，决策 D19）
      return [
        { key: 'database_type', label: '数据库类型', children: r.database_type },
        { key: 'port', label: '端口', children: r.port },
        { key: 'version', label: '版本', children: r.version || '-' },
        {
          key: 'connection_string',
          label: '连接串',
          children: r.connection_string ? <Text code style={{ fontSize: 12 }}>{r.connection_string}</Text> : '-',
        },
      ]
    }
    if (isMiddlewareResource(r)) {
      return [
        { key: 'middleware_type', label: '中间件类型', children: r.middleware_type },
        { key: 'port', label: '端口', children: r.port },
        { key: 'version', label: '版本', children: r.version || '-' },
        {
          key: 'connection_string',
          label: '连接串',
          children: r.connection_string ? <Text code style={{ fontSize: 12 }}>{r.connection_string}</Text> : '-',
        },
      ]
    }
    if (isApplicationResource(r)) {
      return [
        { key: 'service_name', label: '服务名', children: r.service_name },
        { key: 'health_check_url', label: '健康检查 URL', children: r.health_check_url || '-' },
        { key: 'protocol', label: '协议', children: r.protocol || '-' },
        { key: 'endpoint', label: '端点', children: r.endpoint || '-' },
        { key: 'port', label: '端口', children: r.port ?? '-' },
      ]
    }
    return [
      { key: 'target_name', label: '目标名称', children: r.target_name },
      { key: 'exporter_type', label: '端点类型', children: endpointTypeLabel(r.exporter_type) },
      // {v2.35} 决策 84：port / metrics_path / scheme 采集参数归 M01 默认采集配置，详情抽屉不再展示
      {
        key: 'custom_labels',
        label: '自定义标签',
        children: r.custom_labels ? <Text code style={{ fontSize: 12 }}>{r.custom_labels}</Text> : '-',
      },
    ]
  }

  const importResult = IMPORT_RESULT_DEMO[activeType]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>资源管理</Title>
        <Text type="secondary">管理主机、数据库、中间件、应用及其他监控目标（监控对象管理）</Text>
      </div>

      {/* 模块边界说明（用户语言，技术细节见 MainLayout 全局折叠区） */}
      <Callout
        tone="info"
        icon={<InfoCircleFilled />}
        title="本页只维护监控对象数据"
        style={{ marginBottom: 16 }}
      >
        本页维护监控对象（资源）、资源标签与标签模板的数据，<Text strong>不生成采集配置、不配置采集任务、不下发配置</Text>。
        采集策略由「监控策略」模块负责，配置生成与下发由「配置中心」模块负责。
      </Callout>

      <ReviewNote title="设计说明（面向产品 / 技术评审）" style={{ margin: '0 0 16px' }}>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <li>{'{v2.22} 决策 47-3（修订 31-M1）'}：采集状态三态——采集中 / 已下发未采到 / 未监控，只读展示并提供三态筛选。数据 = M01 选中关系（is_monitored 只读映射）+ M02 健康度/覆盖率 API（按 resource_id 回连，列表级聚合调用，禁止逐行查询 TQ-6）；M07 不直连时序数据、不据此计算 / 不写回，is_monitored 与 status 维度独立。{'{v2.25}'} 口径修订：选中关系不感知 M09 下发时序，「已下发未采到」含变更未确认下发情形，「待采集」细分归 M01 Job 回显。</li>
          <li>
            <Text strong>{'{v2.33}'} K8s 双域登记动线分流（决策 81；{'{v2.35}'} 决策 84 收编为表单首问）</Text>：「新增资源」曾改为双入口下拉——
            <Text strong>登记主机</Text>（→ host，OS 层 node_exporter <Text code style={{ fontSize: 12 }}>:9100</Text>）与
            <Text strong>登记 K8s 集群</Text>（→ generic_target 集群级端点：API Server / kube-state-metrics / etcd）语义互斥、置顶并各带链路说明；
            集群入口明示「节点 / Pod / 容器由该域 K8s 采集 Job（kubernetes_sd）动态发现、无需逐台登记」，主机入口注明「K8s 节点 K8s 维度指标已由集群 Job 覆盖、只管 OS 层」。
            从入口消除「K8s 节点算集群域还是主机域」的二选一；不改数据模型与接口契约。
          </li>
          <li>
            <Text strong>{'{v2.34}'} 其他监控目标定位收窄与 M07/M01 字段边界（决策 83）</Text>：
            <Text code style={{ fontSize: 12 }}>generic_target</Text> 展示名由「通用目标」改为<Text strong>「其他监控目标」</Text>（内部枚举值不变），定位为兜底类——
            ① 网络设备与硬件（SNMP 交换机 / GPU 服务器等）② K8s 集群级端点（{'{v2.35}'} 起走「其他监控目标」表单首问「登记对象」）③ 自定义 HTTP 指标端点；容器 / Pod / K8s 节点仍由 K8s Job 动态发现、不登记。
            标准入口表单<Text strong>去 exporter 化</Text>：只填端点地址 + 选择「端点类型」预设（网络设备 SNMP 9116·/snmp / GPU 服务器 DCGM 9400 / 自定义 HTTP 9100），
            端口 / 采集路径 / 协议折叠进「高级采集设置（一般无需修改）」，自定义类型默认展开；
            <Text code style={{ fontSize: 12 }}>exporter_type</Text> 收窄为对用户隐藏的端点子类型判别值（随表提交），供 M01 推导
            <Text code style={{ fontSize: 12 }}>monitor_type</Text>：snmp_exporter→snmp 为 MVP 唯一完整映射；
            k8s_apiserver / k8s_kube_state_metrics / k8s_etcd 为 {'{v0.2}'} 三枚举（M01 PRD v3.42 已落地、M01 原型待同步）。
            边界：采集器软件登记 / 默认参数模板归 M01（ExporterTemplate 与默认采集配置），M07 不重复维护；Oracle 等数据库统一归 database 类（不再双入口）；
            拨测 URL 由 M01 blackbox Job 的 blackbox_targets 承载、存量拨测资源不迁移。不改数据模型与接口契约。
          </li>
          <li>
            <Text strong>{'{v2.35}'} 新增入口收敛与采集参数归位（决策 84）</Text>：
            「新增资源」下拉由 6 项收敛为 <Text strong>5 项</Text>、与列表 Tab 1:1——「登记 K8s 集群」不再占类型入口（K8s 集群是部署形态而非资源类型），收编为「其他监控目标」表单首问「登记对象」（网络设备 / GPU 服务器 / 自定义 HTTP 端点 / K8s 集群）；
            表单与详情抽屉删除「高级采集设置」（端口 / 采集路径 / 协议）——采集参数由平台默认采集配置统一承载，M07 不做第二配置点，实例偏差走默认采集配置的端口编辑（MVP）/ 实例级端口覆盖（{'{v0.2}'}）。不改数据模型与接口契约。
          </li>
          <li>
            <Text strong>{'{v2.36}'} 新增入口回归单按钮（决策 85，用户拍板保持原设计风格）</Text>：
            「新增资源」由下拉恢复为<Text strong>单一按钮</Text>，点击后按<Text strong>当前资源类型 Tab</Text>打开对应表单（5 类 Tab 1:1，切换 Tab 再点按钮即登记不同类型）；
            决策 84 的实质保持不变——K8s 集群不占类型入口、经「其他监控目标」表单首问「登记对象」分流（网络设备 / GPU 服务器 / 自定义 HTTP 端点 / K8s 集群），端口 / 采集路径 / 协议等采集参数仍不在 M07 表单与详情出现。不改数据模型与接口契约。
          </li>
          <li>
            <Text strong>{'{v2.33}'} 网域字段可达性引导（决策 81，对齐 M06 决策 73 用户语言）</Text>：
            表单网域字段以「采集端口从哪条链路够得着？」提问，下拉选项第二行标注链路说明（中心直连：平台直接采集 / 采集节点域：经该域节点中转）；
            填 <Text code style={{ fontSize: 12 }}>instance_ip</Text> 后实时给出 <Text code style={{ fontSize: 12 }}>ip_cidrs</Text> 推导预览——
            唯一命中显示「推导归属：XX 域（命中网段）+ 采用」、同前缀跨域命中提示「命中多个网域、请人工选择」（mock 中两集群共用 10.244.0.0/16 演示歧义）、无命中提示默认兜底；预览仅辅助、不替代显式选择。
          </li>
          <li>采集成功 / 目标状态数据归 M01 / M02：本页展示的是三态聚合结果（采集中 / 已下发未采到 / 未监控）；目标明细（up / down / scrape 详情）在 M02 目标状态页查看，选中关系在 M01 实例选择器查看。</li>
          <li>标签来源口径：模板映射生成 = 「系统」标签；手工添加 = 「用户」标签；CMDB 字段（v0.4+）= 「CMDB」标签。</li>
          <li>
            <Text strong>{'{v2.32}'} 列表列数治理（对齐《前端标准》§9「列表建议 ≤8 列、其余下沉详情 Drawer」）</Text>：
            五类 Tab 统一收敛为 <Text strong>8 列</Text> —— 主标识（fixed left）/ 类型或身份 / 网域 / 归属来源 / 业务 / 运行状态 / 采集状态 / 操作（fixed right）。
            原列表曾达 11 ~ 14 列（主机 11、数据库 / 中间件 / 应用 12、其他监控目标 14）。
            下沉详情 Drawer 的字段：端口 / 版本 / 操作系统 / 应用·环境·集群 / 健康检查 URL / 协议 / 端点 / 采集路径 / 自定义标签 / 数据来源 / 负责人 / CMDB 预留字段；
            类型字段（数据库类型 / 中间件类型 / 端点类型）改为随主标识行内 Tag 呈现、不单独占列。
            配套：状态语义统一 Badge 语义色 + 文字（不再用彩色 Tag 承载状态）、主标识列 fixed left、操作列 fixed right。
          </li>
          <li>
            <Text strong>{'{v2.32}'} 操作层次（对齐《前端标准》§8/§9）</Text>：主操作 = 品牌色加粗文字「详情」且全行唯一；
            次要操作「编辑」为灰色文字；低频且破坏性的「删除」收进「更多」菜单，避免同行出现多个同级入口。
          </li>
          <li>{'{v2.21} 决策 32'}：运行状态数据来源（CMDB 同步 / Excel 导入 / 用户手动维护）以列头 hover 提示标注、不占列宽。{'运行状态用户语言按 PRD §10 术语表收敛为「运行中 / 已停止 / 维护中」（此前 mock 误用「在线 / 离线」）。'}</li>
          <li>
            <Text strong>{'{v2.40} 业务与应用正交两维建模（决策 93/94/95/96）'}</Text>：业务（biz）与应用（app）为 <Text strong>M:N 正交两维</Text>——biz 回答「服务谁」（业务域聚合），app 回答「属于哪个应用」（应用实例级聚合）。
            决策 93：<Text code style={{ fontSize: 12 }}>biz_code</Text> 必填按类型分化（application 必填、host/database/middleware 可空后补、generic_target 与 app 二选一）；
            决策 94：database/middleware 多 schema 分属多应用为 {'{v0.2+}'}，MVP 维持 1 实例 = 1 主 app_code；
            决策 95：generic_target 的《应用》《业务》<Text strong>至少填一个</Text>；
            决策 96：应用字典不设父级 biz_code。决策 92（应用双层编码 / 字典红线）不动。
          </li>
          <li>列显隐配置为 P1 占位，MVP 版本列表列固定展示，可在「列设置」查看后续规划。</li>
          <li>Excel 导入：状态中文值按内置状态映射转换（本页只读展示，配置入口 P2）；枚举列（env / protocol / scheme）要求与字典一致，否则报错。</li>
          <li>{'{v2.20} 决策 29'}：目标状态 offline 后，配置中心（Module_09）下一配置生成周期即将其从 targets/*.json 移除、不触发采集器 reload，批量下线动线为真。</li>
          <li>
            <Text strong>{'{v2.32}'} K8s 集群归属注记（决策 77）</Text>：K8s 集群<Text strong>不设第六资源类型</Text>——五大类按采集形态分类，集群属部署形态。
            集群诉求四归属：网络边界 → 独立建网域；分组维度 → <Text code style={{ fontSize: 12 }}>cluster</Text> 字段 / 标签；发现源 → M04 KubernetesProvider；集群健康监控 → 其他监控目标 + M01 <Text code style={{ fontSize: 12 }}>monitor_type</Text> 三枚举（k8s_apiserver / k8s_kube_state_metrics / k8s_etcd，{'{v0.2}'}，决策 83）。
            「集群清单」按集群视图（展示层）承接，MVP 不做。
          </li>
        </ul>
      </ReviewNote>

      <Card className="page-card">
        <Row gutter={[16, 16]} align="middle" style={{ marginBottom: 16 }}>
          <Col>
            <Space wrap>
              {/* {v2.36} 决策 85：回归单一「新增资源」按钮——抽屉表单形态跟随当前资源类型 Tab（5 类 1:1）；
                  K8s 集群登记仍收编在「其他监控目标」表单首问「登记对象」（决策 84 实质不变）。 */}
              <Button
                type="primary"
                icon={<PlusOutlined />}
                style={{ backgroundColor: '#0ECDEB' }}
                onClick={() => openAdd(activeType as AddEntry)}
              >
                新增资源
              </Button>
              <Button icon={<UploadOutlined />} onClick={() => setImportModalOpen(true)}>
                Excel 导入
              </Button>
              <Button icon={<DownloadOutlined />} onClick={() => setTemplateModalOpen(true)}>
                下载模板
              </Button>
              {/* 列显隐配置占位（后续版本开放）：列表列显示/隐藏由用户勾选 */}
              <Tooltip title="列显隐配置：可勾选显示/隐藏列表列（含中间件类型、网域、来源等），后续版本开放">
                <Button
                  icon={<SettingOutlined />}
                  onClick={() => message.info('列显隐配置后续版本开放')}
                >
                  列设置
                </Button>
              </Tooltip>
            </Space>
          </Col>
        </Row>

        <FilterBar>
          <FilterItem label="网域" width={240}>
            <Select
              placeholder="全部网域"
              allowClear
              value={filterDomain === 'all' ? undefined : filterDomain}
              onChange={(v) => setFilterDomain(v ?? 'all')}
              style={{ width: 180 }}
              options={mockNetworkDomains.map((d) => ({ value: d.id, label: `${d.name} (${d.id})` }))}
            />
          </FilterItem>
          <FilterItem label="业务" width={240}>
            <Select
              placeholder="全部业务"
              allowClear
              value={filterBusiness === 'all' ? undefined : filterBusiness}
              onChange={(v) => setFilterBusiness(v ?? 'all')}
              style={{ width: 180 }}
              options={mockBusinessDomains
                .filter((d) => d.status === 'enabled')
                .map((d) => ({ value: d.biz_code, label: `${d.biz_name} (${d.biz_code})` }))}
            />
          </FilterItem>
          {/* {v2.22} 决策 47-3（修订 31-M1）：采集状态三态筛选——采集中 / 已下发未采到 / 未监控，由 is_monitored + 健康度解析 */}
          <FilterItem label="采集状态" width={240}>
            <Select
              placeholder="全部"
              allowClear
              value={filterCollection === 'all' ? undefined : filterCollection}
              onChange={(v) => setFilterCollection(v ?? 'all')}
              style={{ width: 180 }}
              options={[
                { value: 'all', label: '全部' },
                { value: 'up', label: '采集中' },
                { value: 'down', label: '已下发未采到' },
                { value: 'unmonitored', label: '未监控' },
              ]}
            />
          </FilterItem>
          <FilterItem label="搜索" width={340}>
            <Input.Search
              placeholder="搜索实例名 / IP / 应用"
              allowClear
              onSearch={(value) => setSearch(value)}
              style={{ width: 280 }}
            />
          </FilterItem>
        </FilterBar>

        {/* {v2.22} 决策 47-3（修订 31-M1）：采集状态概览横幅——把原塞在 CI Tab 标签右侧的状态计数抽出来，
            独立成当前类型下可点击筛选的徽标行：采集中 / 已下发未采到（异常高饱和）/ 未监控；点击某态即在当前 CI 内联动筛选，
            Tab 标签因此回归「类型 (总数)」简洁样式。 */}
        <Row align="middle" gutter={12} style={{ marginBottom: 12 }}>
          <Col>
            <Text type="secondary" style={{ fontSize: 13, marginRight: 4 }}>
              采集状态概览：
            </Text>
          </Col>
          <Col>
            <Space size={8} wrap>
              <Tag
                color={filterCollection === 'up' ? 'blue' : 'green'}
                style={{ cursor: 'pointer', marginInlineEnd: 0 }}
                onClick={() =>
                  setFilterCollection((prev) => (prev === 'up' ? 'all' : 'up'))
                }
              >
                采集中 {resources.filter((r) => r.resource_category === activeType && resolveCollectionStatus(r) === 'up').length}
              </Tag>
              <Tag
                color={filterCollection === 'down' ? 'blue' : '#FF4C3A'}
                style={{ cursor: 'pointer', marginInlineEnd: 0, fontWeight: filterCollection === 'down' ? 600 : 400 }}
                onClick={() =>
                  setFilterCollection((prev) => (prev === 'down' ? 'all' : 'down'))
                }
              >
                已下发未采到 {resources.filter((r) => r.resource_category === activeType && resolveCollectionStatus(r) === 'down').length}
              </Tag>
              <Tag
                color={filterCollection === 'unmonitored' ? 'blue' : 'default'}
                style={{ cursor: 'pointer', marginInlineEnd: 0 }}
                onClick={() =>
                  setFilterCollection((prev) => (prev === 'unmonitored' ? 'all' : 'unmonitored'))
                }
              >
                未监控 {resources.filter((r) => r.resource_category === activeType && resolveCollectionStatus(r) === 'unmonitored').length}
              </Tag>
            </Space>
          </Col>
          <Col flex="auto">
            <Text type="secondary" style={{ fontSize: 12 }}>
              点击某一状态即在当前 CI 内筛选；「已下发未采到」为异常（含变更未确认下发情形），需检查变更下发状态、采集器安装与网络连通。
            </Text>
          </Col>
        </Row>

        <Tabs
          activeKey={activeType}
          onChange={(key) => setActiveType(key as ResourceCategory)}
          items={RESOURCE_TYPES.map((type) => {
            const total = resources.filter((r) => r.resource_category === type).length
            // {v2.22} 决策 47-3（修订 31-M1）：Tab 只保留类型与总数；该类型采集状态计数移入下方「采集状态概览」横幅（可点击筛选）
            return {
              key: type,
              label: `${RESOURCE_TYPE_MAP[type]} (${total})`,
            }
          })}
          style={{ marginBottom: 16 }}
        />

        <Table
          rowKey="resource_id"
          dataSource={filteredData}
          columns={getColumns(activeType)}
          size="small"
          scroll={TABLE_SCROLL_X}
          pagination={TABLE_PAGINATION}
          locale={{
            emptyText:
              filterCollection !== 'all'
                ? `当前类型下暂无「${COLLECTION_STATUS_META[filterCollection as CollectionStatus]?.label ?? '采集状态'}」资源`
                : undefined,
          }}
          onRow={(record) => ({
            onClick: () => handleOpenDetail(record),
            style: { cursor: 'pointer' },
          })}
        />
      </Card>

      {/* 详情抽屉 + 标签管理（PRD 3.3 / 5.3）；{v2.32} 宽度对齐《前端标准》§8「结构化详情 Drawer ≥720px」 */}
      <Drawer
        title="资源详情"
        width={720}
        open={drawerOpen}
        onClose={handleCloseDetail}
        extra={
          <Button onClick={handleCloseDetail}>关闭</Button>
        }
      >
        {selectedResource && (
          <>
            <Space size={[8, 8]} wrap style={{ marginBottom: 16 }}>
              {/* {v2.32} 数据来源 / 网域 / 归属来源已下沉到「基础信息」逐项呈现（避免同一信息两处重复） */}
              <Tag>{RESOURCE_TYPE_MAP[selectedResource.resource_category]}</Tag>
              <Text code style={{ fontSize: 12 }}>
                {selectedResource.resource_id}
              </Text>
            </Space>
            <Descriptions
              column={2}
              size="small"
              title="基础信息"
              items={[
                { key: 'instance_name', label: '实例名', children: selectedResource.instance_name || '-' },
                { key: 'hostname', label: '主机名', children: selectedResource.hostname || '-' },
                { key: 'instance_ip', label: 'IP 地址', children: selectedResource.instance_ip || '-' },
                // {v2.18}/{v2.22} 业务：展示 biz_name，停用业务加「（已停用）」标识（决策 21/22/48）
                {
                  key: 'biz_code',
                  label: '业务',
                  children: selectedResource.biz_code
                    ? isBizDisabled(selectedResource.biz_code)
                      ? `${resolveBizName(selectedResource.biz_code)}（已停用）`
                      : resolveBizName(selectedResource.biz_code)
                    : '-',
                },
                // 决策 92：应用展示字典应用名（缺条目回退显示编码），停用加「（已停用）」标识
                {
                  key: 'app_code',
                  label: '应用',
                  children: selectedResource.app_code
                    ? isAppDisabled(selectedResource.app_code)
                      ? `${resolveAppName(selectedResource.app_code)}（已停用）`
                      : resolveAppName(selectedResource.app_code)
                    : '-',
                },
                // {v2.3} 适用模板：该资源类别默认模板（模板按 resource_category 隐式关联）
                {
                  key: 'apply_template',
                  label: '适用模板',
                  children: (() => {
                    const tpl = mockLabelTemplates.find(
                      (t) => t.resource_category === selectedResource.resource_category && t.is_default
                    )
                    return tpl ? (
                      <Typography.Link
                        style={{ fontSize: 12 }}
                        onClick={(e) => {
                          e.preventDefault()
                          navigate('/label-templates')
                        }}
                      >
                        {tpl.name}（{tpl.template_id}）
                      </Typography.Link>
                    ) : (
                      '-'
                    )
                  })(),
                },
                { key: 'env', label: '环境', children: selectedResource.env || '-' },
                { key: 'cluster', label: '集群', children: selectedResource.cluster || '-' },
                { key: 'owner', label: '负责人', children: selectedResource.owner || '-' },
                // {v2.32} 列数治理配套：列表下沉的「数据来源 / 网域 / 采集状态」在详情 Drawer 完整承载
                {
                  key: 'source_type',
                  label: '数据来源',
                  children: SOURCE_TYPE_MAP[selectedResource.source_type] || selectedResource.source_type,
                },
                {
                  key: 'network_domain',
                  label: '网域',
                  children: (
                    <Space size={6} wrap>
                      <Tag color="cyan">{selectedResource.network_domain_id}</Tag>
                      <Tooltip title={resolveDomainAttribution(selectedResource).hint}>
                        <Tag color="purple">归属来源：{DOMAIN_SOURCE_LABELS[resolveDomainAttribution(selectedResource).source]}</Tag>
                      </Tooltip>
                    </Space>
                  ),
                },
                {
                  key: 'collection_status',
                  label: '采集状态',
                  children: (
                    <Tooltip title={COLLECTION_STATUS_META[resolveCollectionStatus(selectedResource)].tooltip}>
                      <span>
                        <Badge
                          status={COLLECTION_BADGE_STATUS[resolveCollectionStatus(selectedResource)]}
                          text={COLLECTION_STATUS_META[resolveCollectionStatus(selectedResource)].label}
                        />
                      </span>
                    </Tooltip>
                  ),
                },
                {
                  key: 'status',
                  label: '运行状态',
                  children: <Badge color={STATUS_COLOR[selectedResource.status]} text={STATUS_MAP[selectedResource.status]} />,
                },
                { key: 'created_at', label: '创建时间', children: selectedResource.created_at },
                { key: 'updated_at', label: '更新时间', children: selectedResource.updated_at },
              ]}
            />
            <Descriptions
              column={2}
              size="small"
              title="类型字段"
              style={{ marginTop: 16 }}
              items={typeFieldItems(selectedResource)}
            />
            <Descriptions
              column={2}
              size="small"
              title="CMDB 字段（后续版本接入 CMDB 后同步）"
              style={{ marginTop: 16 }}
              items={[
                { key: 'cmdb_ci_id', label: 'cmdb_ci_id（后续版本）', children: selectedResource.cmdb_ci_id || '-' },
                { key: 'cmdb_business_path', label: 'cmdb_business_path（后续版本）', children: selectedResource.cmdb_business_path || '-' },
                { key: 'cmdb_module_path', label: 'cmdb_module_path（后续版本）', children: selectedResource.cmdb_module_path || '-' },
                { key: 'cmdb_maintainer', label: 'cmdb_maintainer（后续版本）', children: selectedResource.cmdb_maintainer || '-' },
              ]}
            />
            <Divider />
            {/* {v2.8} 双场景治理：标题按资源类别区分（静态资源只读 / 应用服务可编辑） */}
            <Title level={5}>
              {selectedResource?.resource_category === 'application' ? '自定义标签（非必须）' : '自定义标签（静态资源只读）'}
            </Title>
            {/* {v2.6} 统一口径：标签来源 vs 模板映射字段来源的对应关系，消除「系统/用户/CMDB」与「资源字段/组合字段/CMDB 字段」的歧义 */}
            <div style={{ marginBottom: 12, padding: 12, background: '#F7F8FA', borderRadius: 6 }}>
              <Text strong style={{ fontSize: 13 }}>标签口径说明</Text>
              <Space direction="vertical" size={6} style={{ width: '100%', marginTop: 8 }}>
                  <Space wrap size={[4, 4]}>
                    <Tag color="default">系统</Tag>
                    <Text style={{ fontSize: 12 }}>= 由标签模板生成（MVP 字段来源：平台资源字段 / 组合字段），只读；改值请前往标签模板管理</Text>
                  </Space>
                  <Space wrap size={[4, 4]}>
                    <Tag color="cyan">用户</Tag>
                    <Text style={{ fontSize: 12 }}>= 实例级自定义标签（含其他监控目标 custom_labels 透传）；仅应用服务资源可编辑 / 删除</Text>
                  </Space>
                  <Space wrap size={[4, 4]}>
                    <Tag>CMDB（v0.4+）</Tag>
                    <Text style={{ fontSize: 12 }}>= 后续版本由 CMDB 同步，MVP 仅占位展示，对应模板映射的「CMDB 字段」来源</Text>
                  </Space>
                  <Space wrap size={[4, 4]}>
                    <Tag color="blue">双场景</Tag>
                    <Text style={{ fontSize: 12 }}>=
                      {selectedResource?.resource_category === 'application'
                        ? '业务类型资源：标签由平台治理，开放自定义标签（如核心链路、负责人）'
                        : '静态资源（主机 / 中间件 / 其他监控目标）：标签由 CMDB / Excel 治理，平台只读，不提供实例级打标入口'}
                    </Text>
                  </Space>
                  <Text style={{ fontSize: 12, color: '#86909C' }}>
                    {'冲突优先级：CMDB > 用户 > 系统（系统标签为生成基线，不可被覆盖）。大多数场景下标签模板已自动生成所需标签，仅当个别应用服务实例需要额外标签时使用。'}
                  </Text>
              </Space>
            </div>
            {/* 批量标签编辑占位（后续版本开放） */}
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
              批量标签编辑（后续版本开放）：按资源类别或筛选条件批量增删改标签。
            </Text>
            {selectedResource?.resource_category !== 'application' ? (
              // {v2.8} 双场景治理：静态资源只读，不渲染添加输入（数据治理在 CMDB / Excel 侧）
              <Text style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
                静态资源标签由 CMDB / Excel 治理，平台只读。主机、中间件、其他监控目标资源的标签由 CMDB 同步（MVP 阶段由 Excel 导入带入），数据治理在 CMDB 侧完成，本平台不引导二次打标。如需修改标签，请前往 CMDB 或更新导入数据。
              </Text>
            ) : (
            <Space direction="vertical" style={{ width: '100%', marginBottom: 12 }}>
              <Row gutter={12} align="middle">
                <Col span={9}>
                  <Input
                    placeholder="label key，如 team"
                    value={newLabelKey}
                    status={keyError ? 'error' : undefined}
                    onChange={(e) => setNewLabelKey(e.target.value)}
                  />
                </Col>
                <Col span={9}>
                  <Input
                    placeholder="label value"
                    value={newLabelValue}
                    onChange={(e) => setNewLabelValue(e.target.value)}
                  />
                </Col>
                <Col span={6}>
                  <Button type="primary" icon={<PlusOutlined />} block style={{ backgroundColor: '#0ECDEB' }} onClick={handleAddLabel}>
                    添加自定义标签
                  </Button>
                </Col>
              </Row>
              <Text type="secondary" style={{ fontSize: 12 }}>
                key 规则：小写字母/数字/下划线；禁止 __ 开头；长度 ≤128；禁止覆盖 Prometheus 内置标签（如 instance/job/scheme 等）。
              </Text>
              {(keyError || cmdbConflict) && (
                <div>
                  {keyError && <Text type="danger" style={{ fontSize: 12 }}>{keyError}</Text>}
                  {!keyError && cmdbConflict && (
                    <Text style={{ color: '#FA8C16', fontSize: 12 }}>该 key 将由 CMDB 覆盖，建议更换 key</Text>
                  )}
                </div>
              )}
            </Space>
            )}
            <Space direction="vertical" style={{ width: '100%' }}>
              {labels.map((label) => {
                const tplSource = label.source === 'system' ? findTemplateSource(selectedResource?.resource_category ?? 'host', label.label_key) : null
                return (
                  <Card
                    key={label.label_id}
                    size="small"
                    styles={{ body: { padding: 12 } }}
                    style={{
                      borderLeft: `4px solid ${
                        label.source === 'cmdb' ? '#1481FD' : label.source === 'user' ? '#0ECDEB' : '#86909C'
                      }`,
                    }}
                  >
                    <Row gutter={16} align="middle">
                      <Col span={6}>
                        <Text strong>{label.label_key}</Text>
                        <div>
                          {/* {v2.6} cmdb 来源降级为 v0.4+ 占位展示（MVP 未接入 CMDB） */}
                          <Tag color={label.source === 'cmdb' ? 'default' : label.source === 'user' ? 'cyan' : 'default'}>
                            {label.source === 'cmdb' ? 'CMDB · v0.4+ 预留' : LABEL_SOURCE_MAP[label.source]}
                          </Tag>
                          {/* {v2.8} 静态资源整体只读：即使 user 来源（Excel 带入）也显示锁定 */}
                          {(!label.is_editable || selectedResource?.resource_category !== 'application') && (
                            <LockOutlined style={{ color: '#86909C', marginLeft: 4 }} />
                          )}
                        </div>
                        {/* {v2.2} 联动标注：来源模板/映射 或 来源说明 */}
                        {label.source === 'system' && tplSource && (
                          <Text
                            type="secondary"
                            style={{ fontSize: 11, cursor: 'pointer' }}
                            onClick={() => navigate('/label-templates')}
                          >
                            <Tooltip title="前往标签模板管理">
                              来自 {tplSource.templateName} · {tplSource.sourceField}→{label.label_key}
                            </Tooltip>
                          </Text>
                        )}
                        {label.source === 'system' && !tplSource && (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            来自标签模板
                          </Text>
                        )}
                        {label.source === 'user' && (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {/* {v2.8} 双场景：application = 资源自定义（实例级）；静态资源 = Excel / CMDB 带入（只读） */}
                            {selectedResource?.resource_category === 'application'
                              ? '资源自定义（实例级）'
                              : 'Excel / CMDB 带入（只读）'}
                          </Text>
                        )}
                        {label.source === 'cmdb' && (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            CMDB 同步（v0.4+ 接入后生效，MVP 仅占位展示）
                          </Text>
                        )}
                      </Col>
                      <Col span={12}>
                        <Input
                          value={label.label_value}
                          disabled={!label.is_editable || selectedResource?.resource_category !== 'application'}
                          onChange={(e) => handleLabelChange(label.label_id, e.target.value)}
                          suffix={
                            label.conflict_hint ? (
                              <Tooltip title={label.conflict_hint}>
                                <InfoCircleOutlined style={{ color: '#FA8C16' }} />
                              </Tooltip>
                            ) : null
                          }
                        />
                      </Col>
                      <Col span={6} style={{ textAlign: 'right' }}>
                        {label.is_editable && selectedResource?.resource_category === 'application' ? (
                          <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => handleDeleteLabel(label)}>
                            删除
                          </Button>
                        ) : (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            只读
                          </Text>
                        )}
                      </Col>
                    </Row>
                  </Card>
                )
              })}
            </Space>
          </>
        )}
      </Drawer>

      {/* 新增 / 编辑资源（PRD 5.6~5.9 按类型渲染字段；{v2.32} 字段 12~14 项 → 720px Drawer + 分组，对齐《前端标准》§8） */}
      <Drawer
        title={`${editingResource ? '编辑资源' : '新增资源'} - ${k8sMode ? 'K8s 集群（集群级端点）' : RESOURCE_TYPE_MAP[editingResource?.resource_category ?? activeType]}`}
        width={720}
        open={editOpen}
        onClose={() => {
          setEditOpen(false)
          setEditingResource(null)
          resourceForm.resetFields()
        }}
        extra={
          <Space>
            <Button
              onClick={() => {
                setEditOpen(false)
                setEditingResource(null)
                resourceForm.resetFields()
              }}
            >
              取消
            </Button>
            <Button type="primary" style={{ backgroundColor: '#0ECDEB' }} onClick={handleSaveResource}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={resourceForm} layout="vertical" style={{ marginTop: 8 }}>
          {/* {v2.32} 分组呈现（《前端标准》§8）：类型专属字段 / 归属与状态两类语义分区，避免 12~14 字段平铺 */}
          <FormSection
            title="资源信息"
            desc={k8sMode ? '集群级端点（generic_target）：API Server / kube-state-metrics / etcd，节点·Pod·容器自动发现' : `${RESOURCE_TYPE_MAP[editingResource?.resource_category ?? activeType]}类型固定字段`}
          >
            {renderTypeFields(editingResource?.resource_category ?? activeType)}
          </FormSection>
          <FormSection title="归属与状态" desc="应用·环境·集群、网域与业务归属、运行状态">
            {renderCommonFields()}
          </FormSection>
        </Form>
      </Drawer>

      {/* 下载模板（PRD 7.1） */}
      <Modal
        title={`下载模板 - ${RESOURCE_TYPE_MAP[activeType]}`}
        open={templateModalOpen}
        onCancel={() => setTemplateModalOpen(false)}
        footer={
          <Button type="primary" style={{ backgroundColor: '#0ECDEB' }} onClick={() => setTemplateModalOpen(false)}>
            关闭
          </Button>
        }
        width={560}
      >
        <Text style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
          <Text strong>固定列模板：</Text>按资源类别提供固定列模板；网域列可留空——留空时平台按归属解析链自动推导（显式指定 &gt; 冲突告警 &gt; 按 IP 与网域网段最长前缀推导 &gt; 默认网域兜底）；Blackbox 拨测目标取发起侧网域、不推导。{/* {v2.19} 模板由后端生成静态 xlsx，内置「取值说明 sheet」列出合法值清单（5.16.1）；{v2.24} 决策 52：网域可留空推导 */}
        </Text>
        <Table
          size="small"
          rowKey="column"
          pagination={false}
          dataSource={IMPORT_TEMPLATE_COLUMNS[activeType].map((c, i) => ({ order: i + 1, column: c }))}
          columns={[
            { title: '列顺序', dataIndex: 'order', key: 'order', width: 80 },
            { title: '列名', dataIndex: 'column', key: 'column', render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
          ]}
        />
        <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
          custom_labels 列支持 key1=value1;key2=value2 格式；status 支持中文状态值（见导入弹窗状态映射）。
        </Text>
        <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
          模板为后端静态生成 xlsx，内置取值说明 sheet 列出各列合法值；biz_code 必填，仅可填已登记字典条目（含兜底 infra）；app_code 须为应用字典已登记且未停用的条目（设备类资源可空）。
        </Text>
        {/* {v2.19} 下载模板由后端生成静态 xlsx + 「取值说明 sheet」（5.16.1）；dataValidation 下拉挪 v0.2+。原灰色长说明已精简。 */}
      </Modal>

      {/* Excel 导入结果（PRD 7.2 / 7.3） */}
      <Modal
        title={`Excel 导入结果 - ${RESOURCE_TYPE_MAP[activeType]}`}
        open={importModalOpen}
        onCancel={() => setImportModalOpen(false)}
        footer={
          <Button type="primary" style={{ backgroundColor: '#0ECDEB' }} onClick={() => setImportModalOpen(false)}>
            关闭
          </Button>
        }
        width={720}
      >
        <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
          状态映射字典：
        </Text>
        <Space wrap size={[8, 8]} style={{ marginBottom: 12 }}>
          {STATUS_MAPPING_RULES.map((rule) => (
            <Tag key={rule.target}>
              {rule.source.join(' / ')} → {STATUS_MAP[rule.target]}
            </Tag>
          ))}
        </Space>
        <Text style={{ fontSize: 12, color: '#86909C', display: 'block', marginBottom: 12 }}>
          导入校验项：必填字段（含 biz_code 必填） · 网域存在性（可留空，留空时按归属解析链推导） · 业务存在性（仅限启用条目，不可自由文本） · 应用存在性（应用字典启用条目；设备类资源可空） · IP 格式 · 端口 1~65535 · URL 格式 · env / protocol / scheme / 状态枚举 · 重复检测（instance_ip:port / service_name） · custom_labels 格式 key=value;key2=value2
        </Text>
        {/* {v2.24} 决策 52：导入阶段网域归属来源说明（Color 区分来源类别） */}
        <Text style={{ fontSize: 12, color: '#722ED1', display: 'block', marginBottom: 12 }}>
          网域归属推导：网域列留空行将按资源 IP 与网域已登记网段最长前缀匹配自动归属（来源标注「网段推导」），无匹配归默认网域（「默认兜底」）；Blackbox 拨测目标取发起侧网域（「发起侧指定」），不参与推导。
        </Text>
        <Text style={{ fontSize: 12, color: '#00B0F0', display: 'block', marginBottom: 12 }}>
          导入按行增量更新，不会删除资源，Excel 中已消失的行不会被自动清理。如需停止采集某批资源，请将目标行的「运行状态」改为「已停止」后重新导入，已停止资源将不再被采集。
        </Text>
        <Row gutter={16} style={{ marginBottom: 12 }}>
          <Col span={8}>
            <Card size="small">
              <Text type="secondary">总数</Text>
              <div><Text strong style={{ fontSize: 20 }}>{importResult.total}</Text></div>
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small">
              <Text type="secondary">成功</Text>
              <div><Text strong style={{ fontSize: 20, color: '#00B578' }}>{importResult.success}</Text></div>
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small">
              <Text type="secondary">失败</Text>
              <div><Text strong style={{ fontSize: 20, color: importResult.failed > 0 ? '#FF4C3A' : '#86909C' }}>{importResult.failed}</Text></div>
            </Card>
          </Col>
        </Row>
        <Table
          size="small"
          rowKey={(r) => `${r.row}-${r.field}`}
          pagination={false}
          dataSource={importResult.errors}
          locale={{ emptyText: '导入无错误' }}
          columns={[
            { title: '行号', dataIndex: 'row', key: 'row', width: 70 },
            { title: '字段', dataIndex: 'field', key: 'field', width: 140 },
            {
              title: '值',
              dataIndex: 'value',
              key: 'value',
              render: (v: string) => (v ? <Text code style={{ fontSize: 12 }}>{v}</Text> : '(空)'),
            },
            { title: '原因', dataIndex: 'reason', key: 'reason' },
          ]}
        />
      </Modal>
    </MainLayout>
  )
}

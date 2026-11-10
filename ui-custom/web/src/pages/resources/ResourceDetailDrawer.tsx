import { useEffect, useState } from 'react'
import { Badge, Button, Descriptions, Drawer, Tag, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import { cloudDictApi, platformDictApi } from '../../api/resources'
import { zoneTypeApi } from '../../api/domain'
import type { NetworkDomain, ZoneType } from '../../types/domain'
import type { BusinessDomain, CloudDict, PlatformDict } from '../../types/resource'
import type { ResourceListItem } from './useResources'
import { RESOURCE_TYPE_MAP, STATUS_MAP, statusColor, SOURCE_TYPE_MAP } from './resourceMeta'
import { useSkin } from '../../skinContext'
import { useResourceLabels } from './useResourceLabels'
import { ResourceLabelsTab } from './ResourceLabelsTab'

const { Text, Link } = Typography

/**
 * 资源详情抽屉（Module_07 §3.3/§5.3/§11.1，L3 任务 T07-F6；T07-R8 拆分标签区）。
 * 参见 docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md
 * - 详情基础属性置顶展示（资源 ID / 网域 / 业务 biz_name / 运行状态 / 来源，§5.4 网域置顶）；
 * - 「适用模板」行展示该类型默认模板名 + ID（labelTemplateApi.list({resource_category, is_default}) 取首条），
 *   点击跳转标签模板页（/label-templates）；
 * - 标签卡状态与增删改动线收敛到 useResourceLabels，标签区展示收敛到 ResourceLabelsTab
 *   （system 标注「来自 XX 模板 · source_map」、user 标注「手动添加」、cmdb 以「v0.4+ 预留」占位）。
 */

interface ResourceDetailDrawerProps {
  open: boolean
  /** 选中资源行（ResourcesPage 传入；关闭后保留引用供 Drawer 过渡动画） */
  record: ResourceListItem | null
  /** M06 网域清单（父页面已加载，用于网域 ID → 展示名） */
  networkDomains: NetworkDomain[]
  /** 业务分组字典（父页面已加载，用于 biz_code → biz_name / 停用标识） */
  businessDomains: BusinessDomain[]
  onCancel: () => void
}

/**
 * 资源详情抽屉（Module_07 §11.1 页面状态矩阵）。
 * 打开抽屉时抓取：标签全量 + 适用模板（useResourceLabels），以及详情展示只读字典
 * （云 / 网络分区 / 平台）。标签卡状态矩阵见 ResourceLabelsTab。
 */
export function ResourceDetailDrawer({ open, record, networkDomains, businessDomains, onCancel }: ResourceDetailDrawerProps) {
  const navigate = useNavigate()
  // 决策 103 scheme-B：云字典（部署级只读，cloud_code → cloud_name 展示名解析；
  // 云的取值由所属网域派生，此处仅做展示名解析）
  const [cloudDicts, setCloudDicts] = useState<CloudDict[]>([])
  // 决策 101：M06 zone_type 字典（网络分区展示名解析，互联网区 / 政务外网区）
  const [zoneTypes, setZoneTypes] = useState<ZoneType[]>([])
  // {v2026-09-28 决策 110} 平台字典（资源行 `platform_code` 一等字段的展示名解析：platform_code → platform_name）
  const [platformDicts, setPlatformDicts] = useState<PlatformDict[]>([])

  const { tokens } = useSkin()
  const isApplication = record?.resource_category === 'application'
  const labelsTab = useResourceLabels(open, record)

  /** 网域 ID → 展示名（M06 网域清单），未匹配兜底展示 ID */
  const domainNameOf = (id: string) => networkDomains.find((d) => d.id === id)?.name ?? id
  /** 业务编码 → biz_name（§11.2 业务列展示 biz_name） */
  const resolveBizName = (code?: string) => {
    if (!code) return '-'
    return businessDomains.find((b) => b.code === code)?.name ?? code
  }
  /** 业务是否停用（停用业务以「业务名（已停用）」标识，存量保留历史值，§11.2） */
  const isBizDisabled = (code: string) => {
    const b = businessDomains.find((d) => d.code === code)
    return !!b && !b.enabled
  }
  /** 云编码 → cloud_name（§5.20 / 决策 103：详情展示字典展示名，缺条目回退 cloud_code） */
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
   * 网络分区展示名（决策 101）：分区唯一权威 = 所属网域 `zone_type`，
   * 展示名走 M06 zone_type 字典（internet = 互联网区 / extranet = 政务外网区），
   * 字典缺条目回退 zone_type 编码；主机侧只读派生。
   */
  const resolveZoneTypeName = (code?: string) => {
    if (!code) return '-'
    return zoneTypes.find((z) => z.code === code)?.display_name ?? code
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
    return platformDicts.find((p) => p.platform_code === code)?.platform_name ?? code
  }
  /** 平台是否停用（停用条目以「平台名（已停用）」标识，存量资源保留历史值） */
  const isPlatformDisabled = (code: string) => {
    const p = platformDicts.find((d) => d.platform_code === code)
    return !!p && !p.enabled
  }

  /** 打开抽屉时抓取详情展示只读字典（云 / 网络分区 / 平台） */
  useEffect(() => {
    if (!open || !record) return
    // 只读字典（云字典 §5.20 / 决策 98；M06 网络分区字典 / 决策 103 scheme-B）：
    // 二者均不影响详情主渲染，加载失败静默降级（缺条目回退编码）
    cloudDictApi
      .list()
      .then((res) => setCloudDicts(res.data?.list ?? []))
      .catch(() => setCloudDicts([]))
    zoneTypeApi
      .list()
      .then((res) => setZoneTypes(res.data ?? []))
      .catch(() => setZoneTypes([]))
    // {v2026-09-28 决策 110}：平台字典（读资源行 platform_code 解析 platform_name）；
    // 不再拉取应用字典——「平台」列不再经已废弃的 ApplicationDict.platform_code 派生（决策 118-3）
    platformDictApi
      .list()
      .then((res) => setPlatformDicts(res.data?.list ?? []))
      .catch(() => setPlatformDicts([]))
  }, [open, record])

  /** 基础属性（资源 ID / 网域 / 业务 biz_name / 运行状态 / 来源 置顶，§5.4 网域置顶） */
  const baseItems = record
    ? [
        { key: 'resource_id', label: '资源 ID', children: <Text code>{record.resource_id}</Text> },
        {
          key: 'network_domain_id',
          label: '网域',
          children: <Tag color="cyan">{domainNameOf(record.network_domain_id)}</Tag>,
        },
        // 决策 103 scheme-B：网络分区唯一权威 = 所属网域 zone_type，**五类资源均只读派生**
        // （不再仅限 host）——无编辑入口（不提供任何一致性引导文案：不存在两处填写）
        {
          key: 'zone_type',
          label: '网络分区',
          children: (
            <span>
              {record.zone_type ? (
                <Tag>{resolveZoneTypeName(record.zone_type)}</Tag>
              ) : (
                <Text type="secondary">-</Text>
              )}
              <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                继承所属网域
              </Text>
            </span>
          ),
        },
        {
          key: 'biz_code',
          label: '业务',
          children: record.biz_code ? (
            <span>
              {resolveBizName(record.biz_code)}
              {isBizDisabled(record.biz_code) ? '（已停用）' : ''}
            </span>
          ) : (
            '-'
          ),
        },
        {
          key: 'status',
          label: '运行状态',
          children: (
            <Badge color={statusColor(tokens)[record.status] ?? tokens.colorTextTertiary} text={STATUS_MAP[record.status] ?? record.status} />
          ),
        },
        {
          key: 'source_type',
          label: '数据来源',
          children: <Tag>{SOURCE_TYPE_MAP[record.source_type] ?? record.source_type}</Tag>,
        },
        {
          key: 'resource_category',
          label: '资源类型',
          children: RESOURCE_TYPE_MAP[record.resource_category],
        },
        { key: 'env', label: '环境', children: record.env || '-' },
        { key: 'app_code', label: '应用', children: record.app_code || '-' },
        // {v2026-09-28 决策 110}「平台」为资源行**一等字段**：读 `platform_code` 并经平台字典解析
        // platform_name（停用加「（已停用）」、缺条目回退编码、留空 '-'）；不再经应用父级派生
        {
          key: 'platform',
          label: '平台',
          children: record.platform_code ? (
            <span>
              {resolvePlatformName(record.platform_code)}
              {isPlatformDisabled(record.platform_code) ? '（已停用）' : ''}
            </span>
          ) : (
            '-'
          ),
        },
        // 决策 103 scheme-B：云为五类共享字段且**只读派生**（值 = 所属网域 cloud_code），
        // 详情展示字典 cloud_name（停用标识、缺条目回退编码、空值 '-'）
        {
          key: 'cloud_code',
          label: '云',
          children: record.cloud_code ? (
            <span>
              {resolveCloudName(record.cloud_code)}
              {isCloudDisabled(record.cloud_code) ? '（已停用）' : ''}
            </span>
          ) : (
            '-'
          ),
        },
        { key: 'cluster', label: '集群', children: record.cluster || '-' },
        { key: 'owner', label: '负责人', children: record.owner || '-' },
        {
          key: 'apply_template',
          label: '适用模板',
          children: labelsTab.template ? (
            <Link style={{ fontSize: 12 }} onClick={() => navigate('/label-templates')}>
              {labelsTab.template.name}（{labelsTab.template.id}）
            </Link>
          ) : (
            '-'
          ),
        },
      ]
    : []

  /** 类型字段（§5.6~§5.9 差异化字段，与列表/编辑抽屉口径一致） */
  const typeItems = record
    ? (() => {
        switch (record.resource_category) {
          case 'host':
            return [
              { key: 'instance_name', label: '实例名', children: record.instance_name || '-' },
              { key: 'hostname', label: '主机名', children: record.hostname || '-' },
              { key: 'instance_ip', label: 'IP 地址', children: record.instance_ip || '-' },
              { key: 'os_type', label: '操作系统', children: record.os_type || '-' },
              { key: 'activated_at', label: '开通时间', children: record.activated_at || '-' },
            ]
          case 'database':
            return [
              { key: 'instance_name', label: '实例名', children: record.instance_name || '-' },
              { key: 'database_type', label: '数据库类型', children: record.database_type || '-' },
              { key: 'instance_ip', label: 'IP 地址', children: record.instance_ip || '-' },
              { key: 'port', label: '端口', children: record.port ?? '-' },
              { key: 'version', label: '版本', children: record.version || '-' },
            ]
          case 'middleware':
            return [
              { key: 'instance_name', label: '实例名', children: record.instance_name || '-' },
              { key: 'middleware_type', label: '中间件类型', children: record.middleware_type || '-' },
              { key: 'instance_ip', label: 'IP 地址', children: record.instance_ip || '-' },
              { key: 'port', label: '端口', children: record.port ?? '-' },
              { key: 'version', label: '版本', children: record.version || '-' },
            ]
          case 'application':
            return [
              { key: 'service_name', label: '服务名', children: record.service_name || '-' },
              { key: 'health_check_url', label: '健康检查 URL', children: record.health_check_url || '-' },
              { key: 'owner1', label: '负责人1', children: record.owner1 || '-' },
              { key: 'owner1_contact', label: '负责人1联系方式', children: record.owner1_contact || '-' },
              { key: 'owner2', label: '负责人2', children: record.owner2 || '-' },
              { key: 'owner2_contact', label: '负责人2联系方式', children: record.owner2_contact || '-' },
              { key: 'ops_person', label: '运维人员', children: record.ops_person || '-' },
              { key: 'ops_person_contact', label: '运维人员联系方式', children: record.ops_person_contact || '-' },
              { key: 'go_live_at', label: '应用上线时间', children: record.go_live_at || '-' },
              { key: 'protocol', label: '协议', children: record.protocol || '-' },
              { key: 'endpoint', label: '端点', children: record.endpoint || '-' },
              { key: 'port', label: '端口', children: record.port ?? '-' },
            ]
          case 'generic_target':
            return [
              { key: 'target_name', label: '目标名称', children: record.target_name || '-' },
              { key: 'exporter_type', label: 'Exporter 类型', children: record.exporter_type || '-' },
              { key: 'instance_ip', label: 'IP 地址', children: record.instance_ip || '-' },
              { key: 'port', label: '端口', children: record.port ?? '-' },
              { key: 'metrics_path', label: '采集路径', children: record.metrics_path || '/metrics' },
              { key: 'scheme', label: '协议', children: record.scheme || 'http' },
              {
                key: 'custom_labels',
                label: '自定义标签',
                children: record.custom_labels ? <Text code>{record.custom_labels}</Text> : '-',
              },
            ]
          case 'interface_service':
            return [
              { key: 'api_name', label: '接口名', children: record.api_name || '-' },
              { key: 'api_url', label: '接口地址', children: record.api_url || '-' },
            ]
        }
      })()
    : []

  return (
    <Drawer
      title="资源详情"
      width={720}
      open={open}
      onClose={onCancel}
      extra={
        <Button onClick={onCancel} disabled={labelsTab.submitting}>
          关闭
        </Button>
      }
    >
      {record && (
        <>
          <Descriptions column={2} size="small" title="基础信息" items={baseItems} />
          <Descriptions column={2} size="small" title="类型字段" style={{ marginTop: 16 }} items={typeItems} />
          <ResourceLabelsTab {...labelsTab} isApplication={isApplication} tokens={tokens} />
        </>
      )}
    </Drawer>
  )
}

export default ResourceDetailDrawer

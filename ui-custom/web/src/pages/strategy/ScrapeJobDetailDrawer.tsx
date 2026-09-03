import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Badge, Button, Descriptions, Drawer, Empty, List, Space, Switch, Tag, Tooltip, Typography } from 'antd'
import { SyncOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { scrapeJobApi } from '../../api/scrapeJobs'
import { targetsApi } from '../../api/targets'
import type { ScrapeJob, ScrapeJobInstanceItem, BlackboxTargetProtocol, CITypeExporterMapping } from '../../types/strategy'
import type { TargetItem } from '../../types/query'
import { MONITOR_TYPE_MAP, SCRAPE_PARAM_FIELDS } from './strategyConstants'
import type { JobInstanceScrapeStatus } from './useScrapeJobStatus'

const { Text } = Typography

/** 协议展示色（原型 PROTOCOL_COLOR） */
const PROTOCOL_COLOR: Record<BlackboxTargetProtocol, string> = {
  http: '#00B578',
  https: '#1481FD',
  tcp: '#FA8C16',
  icmp: '#0ECDEB',
  dns: '#722ED1',
}

/** 协议展示名（原型 PROTOCOL_LABEL） */
const PROTOCOL_LABEL: Record<BlackboxTargetProtocol, string> = {
  http: 'HTTP',
  https: 'HTTPS',
  tcp: 'TCP',
  icmp: 'ICMP',
  dns: 'DNS',
}

/** 决策 34：字段继承来源视觉标记（继承自映射 / 已覆盖 / 待同步） */
type FieldStatus = 'inherited' | 'overridden' | 'pending_sync'
const FIELD_STATUS_META: Record<FieldStatus, { color: string; text: string; tooltip: string }> = {
  inherited: { color: 'default', text: '继承自映射', tooltip: '当前值来自默认采集配置默认值，用户未手动修改' },
  overridden: { color: 'processing', text: '已覆盖', tooltip: '该字段已被手动覆盖，同步映射默认值时将跳过' },
  pending_sync: { color: 'warning', text: '待同步', tooltip: '映射默认值已变更，执行「同步映射默认值」可刷新该字段' },
}

function renderFieldTag(status: FieldStatus): ReactNode {
  const c = FIELD_STATUS_META[status]
  return (
    <Tooltip title={c.tooltip}>
      <Tag color={c.color} style={{ fontSize: 11, lineHeight: '18px', marginInlineStart: 4 }}>
        {c.text}
      </Tag>
    </Tooltip>
  )
}

/** 从 job 读取字段原文；空串视为继承（F-28 层叠默认链） */
function fieldValue(job: ScrapeJob, field: string): string | undefined {
  return (job as unknown as Record<string, string | undefined>)[field]
}

/** 从默认映射读取字段默认值（可能缺省继承采集器模板/全局兜底） */
function defaultFieldValue(mapping: CITypeExporterMapping | undefined, field: string): string | undefined {
  if (!mapping) return undefined
  return (mapping as unknown as Record<string, string | undefined>)[field]
}

/** 决策 34 每字段来源：覆盖（mapping_overrides 命中）> 待同步（与默认映射不一致）> 继承 */
function getFieldStatusForJob(job: ScrapeJob, mapping: CITypeExporterMapping | undefined, field: string): FieldStatus {
  if (job.mapping_overrides?.some((o) => o.field === field)) return 'overridden'
  const v = fieldValue(job, field)
  const dv = defaultFieldValue(mapping, field)
  if (v !== undefined && v !== '' && dv !== undefined && String(v) !== String(dv)) return 'pending_sync'
  return 'inherited'
}

/** 生效值：job 显式填写；否则回退默认映射；再回退 '-'（手填/无映射） */
function effectiveFieldValue(job: ScrapeJob, mapping: CITypeExporterMapping | undefined, field: string): string {
  const v = fieldValue(job, field)
  if (v !== undefined && v !== '') return v
  const dv = defaultFieldValue(mapping, field)
  if (dv !== undefined && dv !== '') return dv
  return '-'
}

/** 从 target.instance `host:port` 提取 host（IPv4 / 主机名按最后一个 ':' 截断；无冒号即原值） */
function hostOf(instance?: string): string {
  if (!instance) return ''
  const idx = instance.lastIndexOf(':')
  return idx === -1 ? instance : instance.slice(0, idx)
}

/** 实例 ↔ target 状态匹配（复用 useJobScrapeStatus 决策 47-2 口径：resource_id 回连，回落 host 地址） */
function matchTarget(it: ScrapeJobInstanceItem, targets: TargetItem[], deployed: boolean) {
  if (!deployed) return { status: 'pending' as JobInstanceScrapeStatus, target: undefined }
  const t = targets.find(
    (x) => x.resource_id === it.resource_id || (!x.resource_id && hostOf(x.instance) === it.instance_ip),
  )
  if (!t || t.health === 'unknown') return { status: 'pending' as JobInstanceScrapeStatus, target: t }
  return { status: t.health === 'up' ? ('collecting' as const) : ('down' as const), target: t }
}

/** 实例状态 Tag 展示元信息（原型 COLLECTION_STATUS_META：采集中=绿 / 待采集=warning / 已下发未采到=红） */
const INSTANCE_STATUS_TAG: Record<JobInstanceScrapeStatus, { color: string; label: string }> = {
  collecting: { color: 'green', label: '采集中' },
  pending: { color: 'warning', label: '待采集' },
  down: { color: 'red', label: '已下发未采到' },
}

const PENDING_TOOLTIP = '待采集：已保存变更尚未下发或未首次抓取'

export interface ScrapeJobDetailDrawerProps {
  open: boolean
  /** 待查看的采集 Job；null/undefined 时抽屉关闭 */
  job: ScrapeJob | null
  onClose: () => void
  /** 网域 id → 名称解析（未传则回退原值） */
  resolveDomainName?: (id: string) => string
  /** Exporter 模板名解析（id/name 双重索引；未传回退 '手填参数' 判定/原值） */
  resolveTemplateName?: (ref: string) => string | undefined
  /** 标签模板名解析 */
  resolveLabelTemplateName?: (id: string) => string | undefined
  /** monitor_type → 默认映射快照（决策 34 字段来源标记 / 参数同步 / 标签待配置） */
  getDefaultMapping?: (monitorType: string) => CITypeExporterMapping | undefined
}

/**
 * 采集 Job 详情抽屉（Module_01 §5.4/决策 34/决策 54/决策 47-2，原型对齐）。
 * Descriptions 概览（Job 名/类型/网域/监控对象/Exporter·Module/字段来源标记/选择模式/标签模板/启用/时间/参数同步快照）
 * + 分支区块：blackbox → 拨测目标列表；standard 且已选实例数>0 → 已选实例 + 采集状态回显
 * （在线 X / 总数 Y · 待采集 Z 汇总 + 手动刷新 + 20s 自动刷新；数据源只读消费 M02 /api/v1/targets 按 job 过滤）。
 * 无 Form，无 forceRender 竞态；Drawer 惰性挂载即可。
 */
export function ScrapeJobDetailDrawer({
  open,
  job,
  onClose,
  resolveDomainName,
  resolveTemplateName,
  resolveLabelTemplateName,
  getDefaultMapping,
}: ScrapeJobDetailDrawerProps) {
  const [items, setItems] = useState<ScrapeJobInstanceItem[]>([])
  const [targets, setTargets] = useState<TargetItem[]>([])
  const [loading, setLoading] = useState(false)
  // 实例信息来自控制面 DB（可靠）；目标采集状态来自数据面目标状态 API（数据面未就绪时单独降级，不影响实例列表展示）。
  const [instanceError, setInstanceError] = useState<string | null>(null)
  const [targetsError, setTargetsError] = useState<string | null>(null)
  // 决策 47-2：顶部「已更新 {time} · 20s 自动刷新」注记（每次拉取/刷新时更新）
  const [statusUpdatedAt, setStatusUpdatedAt] = useState<string | undefined>(undefined)
  const navigate = useNavigate()

  const deployed = !!job && job.change_status === 'deployed' && job.enabled !== false

  const load = useCallback(async () => {
    if (!job) return
    setLoading(true)
    setInstanceError(null)
    setTargetsError(null)
    // Promise.allSettled：两个请求独立处理结果，任一失败只降级对应区块，不拖垮整页。
    try {
      const [insRes, tgtRes] = await Promise.allSettled([
        scrapeJobApi.instances(job.id),
        targetsApi.list({ job: job.job_name }),
      ])
      if (insRes.status === 'fulfilled') {
        setItems(insRes.value?.data?.items ?? [])
      } else {
        setItems([])
        setInstanceError('实例信息加载失败，请稍后重试')
      }
      if (tgtRes.status === 'fulfilled') {
        setTargets(tgtRes.value?.data?.activeTargets ?? [])
        setTargetsError(null)
        setStatusUpdatedAt(new Date().toLocaleTimeString())
      } else {
        setTargets([])
        setTargetsError('数据面（查询中心）目标状态 API 未就绪，在线/离线状态暂不可用')
      }
    } catch {
      setItems([])
      setTargets([])
      setInstanceError('实例信息加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [job])

  useEffect(() => {
    if (!open || !job) return
    // 抽屉刚打开时拉取一次，并开启 20s 自动刷新（请求回调内 setState，沿用本模块既有抓取 effect 模式）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    const id = setInterval(() => void load(), 20000)
    return () => clearInterval(id)
  }, [open, job, load])

  const rows = items.map((it) => {
    const { status, target } = matchTarget(it, targets, deployed)
    return { it, status, target }
  })
  // 用只读 filter 聚合计数，避免 render 内对变量做赋值（react-hooks/immutability）
  const online = rows.filter((r) => r.status === 'collecting').length
  const down = rows.filter((r) => r.status === 'down').length
  const pending = rows.filter((r) => r.status === 'pending').length

  const defMapping = job ? getDefaultMapping?.(job.monitor_type) : undefined
  const overridesCount = job?.mapping_overrides?.length ?? 0
  // 参数同步快照「映射默认值已变更」判定：任一采集参数与当前默认映射不一致（且未被显式覆盖）
  const syncChanged =
    !!defMapping &&
    !job?.mapping_overrides?.length &&
    SCRAPE_PARAM_FIELDS.some(({ field }) => {
      const v = fieldValue(job as ScrapeJob, field)
      const dv = defaultFieldValue(defMapping, field)
      return v !== undefined && v !== '' && dv !== undefined && String(v) !== String(dv)
    })

  return (
    <Drawer
      title={
        <Space size={8}>
          Job 详情
          {job && (
            <Tag color="geekblue">
              {job.job_name}
            </Tag>
          )}
        </Space>
      }
      open={open}
      onClose={onClose}
      width={680}
      loading={loading}
    >
      {job && (
        <>
          <Descriptions column={2} size="small" bordered>
            <Descriptions.Item label="Job 名称" span={2}>
              <Text strong>{job.job_name}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="Job 类型">
              <Tag color={job.job_type === 'blackbox' ? 'purple' : 'blue'}>
                {job.job_type === 'blackbox' ? 'blackbox 拨测' : '标准采集'}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="归属网域">
              <Tag>{resolveDomainName?.(job.network_domain_id) ?? job.network_domain_id}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="监控对象类型">
              {job.job_type === 'blackbox' || !job.monitor_type ? (
                <Text type="secondary">-</Text>
              ) : (
                <Tag color="blue">{MONITOR_TYPE_MAP[job.monitor_type as keyof typeof MONITOR_TYPE_MAP] ?? job.monitor_type}</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Exporter / Module">
              {job.job_type === 'blackbox' ? (
                <Tag color="cyan">{job.blackbox_module ?? '-'}</Tag>
              ) : job.exporter_template_id ? (
                <Tag color="cyan">{resolveTemplateName?.(job.exporter_template_id) ?? job.exporter_template_id}</Tag>
              ) : (
                <Text type="secondary">手填参数</Text>
              )}
            </Descriptions.Item>
            {/* 决策 34：详情视图每个参数字段显示继承/覆盖/待同步标记 */}
            <Descriptions.Item label="采集间隔">
              <Space size={4}>
                <Text>{effectiveFieldValue(job, defMapping, 'scrape_interval')}</Text>
                {job.job_type === 'standard' && renderFieldTag(getFieldStatusForJob(job, defMapping, 'scrape_interval'))}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="超时">
              <Space size={4}>
                <Text>{effectiveFieldValue(job, defMapping, 'scrape_timeout')}</Text>
                {job.job_type === 'standard' && renderFieldTag(getFieldStatusForJob(job, defMapping, 'scrape_timeout'))}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="指标路径">
              <Space size={4}>
                <Text code>{effectiveFieldValue(job, defMapping, 'metrics_path')}</Text>
                {job.job_type === 'standard' && renderFieldTag(getFieldStatusForJob(job, defMapping, 'metrics_path'))}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="协议">
              <Space size={4}>
                <Tag>{effectiveFieldValue(job, defMapping, 'scheme')}</Tag>
                {job.job_type === 'standard' && renderFieldTag(getFieldStatusForJob(job, defMapping, 'scheme'))}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="选择模式">
              {job.job_type === 'blackbox' ? (
                <Text type="secondary">-</Text>
              ) : job.instance_selection_mode === 'manual' ? (
                '手动勾选'
              ) : (
                <Space size={4} wrap>
                  <Tag color="geekblue">过滤 · 动态</Tag>
                  {job.filter_rules ? <Text type="secondary" style={{ fontSize: 12 }}>{job.filter_rules}</Text> : null}
                </Space>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="标签模板">
              {job.label_template_id ? (
                <Space size={4}>
                  <Badge
                    status="success"
                    text={resolveLabelTemplateName?.(job.label_template_id) ?? job.label_template_id}
                  />
                  {job.job_type === 'standard' &&
                    renderFieldTag(getFieldStatusForJob(job, defMapping, 'label_template_id'))}
                </Space>
              ) : job.job_type === 'standard' && defMapping?.label_template_id ? (
                <Tooltip title="该监控对象类型的默认采集配置已挂标签模板，当前 Job 尚未关联，请点击补配">
                  <Tag color="warning">标签待配置</Tag>
                </Tooltip>
              ) : (
                '-'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="启用状态">
              <Switch checked={job.enabled} size="small" disabled />
            </Descriptions.Item>
            <Descriptions.Item label="创建 / 更新时间">
              {new Date(job.created_at).toLocaleString()} / {new Date(job.updated_at).toLocaleString()}
            </Descriptions.Item>
            <Descriptions.Item label="参数同步快照">
              {job.job_type === 'blackbox' ? (
                <Text type="secondary">-</Text>
              ) : overridesCount > 0 ? (
                <Tag color="blue">已覆盖 {overridesCount} 项</Tag>
              ) : syncChanged ? (
                <Tag color="warning">映射默认值已变更</Tag>
              ) : (
                <Tag color="success">已同步</Tag>
              )}
            </Descriptions.Item>
          </Descriptions>

          {instanceError && (
            <Typography.Paragraph type="danger" style={{ marginTop: 12 }}>
              {instanceError}
            </Typography.Paragraph>
          )}

          {job.job_type === 'blackbox' ? (
            <>
              <Text strong style={{ display: 'block', marginTop: 16 }}>
                拨测目标（{job.blackbox_targets?.length ?? 0}）
              </Text>
              <List
                bordered
                size="small"
                style={{ marginTop: 8 }}
                dataSource={job.blackbox_targets ?? []}
                renderItem={(item, index) => (
                  <List.Item key={index}>
                    <Space>
                      <Tag color={PROTOCOL_COLOR[item.protocol]}>{PROTOCOL_LABEL[item.protocol]}</Tag>
                      <Text code>{item.url || item.target}</Text>
                    </Space>
                  </List.Item>
                )}
              />
            </>
          ) : (
            items.length > 0 && (
              <>
                <Text strong style={{ display: 'block', marginTop: 16 }}>
                  已选实例（{items.length}）
                </Text>
                {/* 决策 47-2：实例采集状态回显——顶部汇总「在线 X / 总数 Y · 待采集 Z」+ 手动/20s 自动刷新；数据源 = M02 /api/v1/targets 代理 */}
                {targetsError && (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginTop: 8, marginBottom: 8 }}
                    message="采集状态暂不可用"
                    description={targetsError}
                    action={
                      <Button size="small" onClick={() => navigate('/targets')}>
                        查看全部监控目标状态
                      </Button>
                    }
                  />
                )}
                <Space size={8} wrap style={{ marginTop: 8, marginBottom: 8 }}>
                  {!targetsError && (
                    <Text style={{ fontSize: 12 }} strong>
                      在线 {online} / 总数 {items.length}
                      {' · '}待采集 {pending}
                      {down > 0 && (
                        <Text type="danger" style={{ fontSize: 12 }}>
                          {' · '}已下发未采到 {down}
                        </Text>
                      )}
                    </Text>
                  )}
                  <Button size="small" icon={<SyncOutlined />} onClick={() => void load()} disabled={loading}>
                    刷新
                  </Button>
                  {statusUpdatedAt && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      已更新 {statusUpdatedAt} · 20s 自动刷新
                    </Text>
                  )}
                </Space>
                {rows.length === 0 ? (
                  <Empty description={loading ? '加载中…' : '暂无已选实例'} />
                ) : (
                  <List
                    bordered
                    size="small"
                    dataSource={rows}
                    renderItem={(r) => {
                      const statusTag = targetsError ? (
                        <Tag>状态不可用</Tag>
                      ) : (
                        (() => {
                          const meta = INSTANCE_STATUS_TAG[r.status]
                          return r.status === 'down' || r.status === 'pending' ? (
                            <Tooltip
                              title={
                                r.status === 'pending'
                                  ? PENDING_TOOLTIP
                                  : `已下发未采到：${r.target?.lastError ?? ''}；配置已下发但未采集到数据，请检查采集器安装与网络连通`.trim()
                              }
                            >
                              <Tag color={meta.color} style={{ cursor: 'pointer' }}>
                                {meta.label}
                              </Tag>
                            </Tooltip>
                          ) : (
                            <Tag color={meta.color}>{meta.label}</Tag>
                          )
                        })()
                      )
                      return (
                        <List.Item key={r.it.resource_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                          <Space wrap>
                            <Text strong>{r.it.instance_name || '-'}</Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {r.it.instance_ip || '-'}
                            </Text>
                          </Space>
                          {statusTag}
                        </List.Item>
                      )
                    }}
                  />
                )}
              </>
            )
          )}

          <Space style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <Button onClick={onClose}>关闭</Button>
          </Space>
        </>
      )}
    </Drawer>
  )
}

export default ScrapeJobDetailDrawer
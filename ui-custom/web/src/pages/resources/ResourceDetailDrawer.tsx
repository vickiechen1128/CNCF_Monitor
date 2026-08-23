import { useEffect, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Input,
  Modal,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import {
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  LockOutlined,
  PlusOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { isApiError } from '../../api/client'
import { resourceApi } from '../../api/resources'
import { labelTemplateApi } from '../../api/labelTemplates'
import { EllipsisText } from '../../components/EllipsisText'
import type { NetworkDomain } from '../../types/domain'
import type { BusinessDomain, ResourceCategory, ResourceLabelItem } from '../../types/resource'
import type { LabelTemplateListItem } from '../../types/label'
import type { ResourceListItem } from './useResources'

const { Text, Title, Link } = Typography

/**
 * 资源详情抽屉（Module_07 §3.3/§5.3/§11.1，L3 任务 T07-F6）。
 * 参见 docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md
 * - 详情基础属性置顶展示（资源 ID / 网域 / 业务 biz_name / 运行状态 / 来源，§5.4 网域置顶）；
 * - 「适用模板」行展示该类型默认模板名 + ID（labelTemplateApi.list({resource_category, is_default}) 取首条），
 *   点击跳转标签模板页（/label-templates）；
 * - 标签卡展示全量标签（resourceApi.labels）：system 标注「来自 XX 模板 · source_map」并可跳转模板页；
 *   user 标注「手动添加」；cmdb 以「v0.4+ 预留」占位（§3.3 统一口径）；
 * - user 标签编辑（新增/编辑/删除）仅 resource_category=application 开放（标题「自定义标签（非必须）」
 *   并附引导文案）；静态资源只读展示来源、不提供打标入口；写返回 403 时 Alert 提示
 *   「该资源为静态资源，标签由 CMDB / Excel 带入，不支持手动打标」；
 * - 新增/编辑 key 与模板映射目标冲突时提示「该标签由标签模板生成，如需修改请前往标签模板管理」。
 */

/** 资源类别展示名（对齐原型 RESOURCE_TYPE_MAP / ResourceFormDrawer） */
const RESOURCE_CATEGORY_MAP: Record<ResourceCategory, string> = {
  host: '主机',
  database: '数据库',
  middleware: '中间件',
  application: '应用',
  generic_target: '通用目标',
}

/** 运行状态展示名（§5.2 / 决策 32，UI 展示名「运行状态」） */
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

/** 数据来源展示名（§5.2；cmdb 为 v0.4+ 预留） */
const SOURCE_TYPE_MAP: Record<string, string> = {
  manual: '手动录入',
  import: 'Excel 导入',
  cmdb: 'CMDB 同步',
}

/** 保护 label 清单（§5.3/§5.11：禁止作为标签 key），与后端 PROTECTED_PROMETHEUS_LABELS 一致 */
const PROTECTED_PROMETHEUS_LABELS = [
  'instance',
  'job',
  'scheme',
  '__address__',
  '__scheme__',
  '__metrics_path__',
  '__name__',
]

/** key 校验规则：小写字母 / 数字 / 下划线（§5.3） */
const LABEL_KEY_RE = /^[a-z0-9_]+$/

/** 标签卡左侧边框色（对齐原型：system 灰 / user 青 / cmdb 蓝） */
const LABEL_SOURCE_BORDER: Record<string, string> = {
  system: '#86909C',
  user: '#0ECDEB',
  cmdb: '#1481FD',
}

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

/** key 前端预校验（§5.3：小写/下划线/禁 __ 开头/≤128/禁内置 label/不重复） */
function validateLabelKey(key: string, existing: ResourceLabelItem[]): string | null {
  if (!key) return '请输入标签 Key'
  if (key.length > 128) return 'Key 长度不能超过 128 字符'
  if (key.startsWith('__')) return 'Key 禁止以 __ 开头'
  if (!LABEL_KEY_RE.test(key)) return 'Key 仅支持小写字母 / 数字 / 下划线'
  if (PROTECTED_PROMETHEUS_LABELS.includes(key)) return '禁止覆盖 Prometheus 内置标签'
  if (existing.some((l) => l.key === key)) return '该 Key 已存在'
  return null
}

/**
 * 资源详情抽屉（Module_07 §11.1 页面状态矩阵）。
 * 打开抽屉时抓取：标签全量（resourceApi.labels）+ 适用模板（labelTemplateApi.list is_default）。
 * 标签卡状态矩阵：加载骨架屏 / 空态「暂无自定义标签（非必须）」/ 接口错误 Alert + 重新加载 /
 * 写操作 403 提示。user 标签编辑入口仅 application 资源展示。
 */
export function ResourceDetailDrawer({ open, record, networkDomains, businessDomains, onCancel }: ResourceDetailDrawerProps) {
  const navigate = useNavigate()
  const [labels, setLabels] = useState<ResourceLabelItem[]>([])
  const [labelsLoading, setLabelsLoading] = useState(false)
  const [labelsError, setLabelsError] = useState<string | null>(null)
  const [template, setTemplate] = useState<LabelTemplateListItem | null>(null)
  const [writeError, setWriteError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')

  const isApplication = record?.resource_category === 'application'

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

  /** 打开抽屉时重置状态并抓取标签 + 适用模板（沿用本模块既有 set-state-in-effect 模式） */
  useEffect(() => {
    if (!open || !record) return
    // 打开抽屉时同步重置标签卡状态；异步请求回调内才异步 setState
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLabelsLoading(true)
    setLabelsError(null)
    setWriteError(null)
    setEditingId(null)
    setNewKey('')
    setNewValue('')
    setLabels([])
    setTemplate(null)
    resourceApi
      .labels(record.resource_id)
      .then((res) => {
        setLabels(res.data?.items ?? [])
        setLabelsLoading(false)
      })
      .catch((err: Error) => {
        setLabelsError(err.message || '标签数据加载失败，请稍后重试')
        setLabelsLoading(false)
      })
    // 适用模板：该资源类别默认模板（labelTemplateApi.list({resource_category, is_default}) 取首条，§5.3）
    labelTemplateApi
      .list({ resource_category: record.resource_category, is_default: true, page: 1, page_size: 10 })
      .then((res) => {
        setTemplate(res.data?.list?.[0] ?? null)
      })
      .catch(() => {
        // 模板加载失败不阻塞详情展示
        setTemplate(null)
      })
  }, [open, record])

  /** 标签数据重新加载（接口错误 Alert 的「重新加载」） */
  const reloadLabels = () => {
    if (!record) return
    setLabelsLoading(true)
    setLabelsError(null)
    resourceApi
      .labels(record.resource_id)
      .then((res) => {
        setLabels(res.data?.items ?? [])
        setLabelsLoading(false)
      })
      .catch((err: Error) => {
        setLabelsError(err.message || '标签数据加载失败，请稍后重试')
        setLabelsLoading(false)
      })
  }

  /** 写操作错误统一处理：403 → 静态资源只读提示（§11.1/§6.2），其余透传后端文案 */
  const handleWriteError = (err: unknown) => {
    if (isApiError(err) && err.code === 403) {
      setWriteError('该资源为静态资源，标签由 CMDB / Excel 带入，不支持手动打标')
    } else {
      setWriteError(err instanceof Error ? err.message : '标签操作失败，请稍后重试')
    }
  }

  /** key 是否被适用模板映射为生成目标（§3.3/§5.3 冲突提示；system 标签保护、引导走模板） */
  const isTemplateMappedLabel = (key: string) => !!template && template.mappings.some((m) => m.target_label === key)

  /**
   * key 与模板映射目标冲突时弹出确认：提示「该标签由标签模板生成，如需修改请前往标签模板管理」，
   * 「前往标签模板」跳转模板页；「仍要继续」放行实例级操作。返回是否命中冲突（命中则已弹窗）。
   */
  const guardTemplateConflict = (key: string, onOk: () => void) => {
    if (isTemplateMappedLabel(key)) {
      Modal.confirm({
        title: '该标签由标签模板生成',
        content: `「${key}」由标签模板生成，如需修改请前往标签模板管理。确认仍要继续吗？`,
        okText: '仍要继续',
        cancelText: '前往标签模板',
        onOk: () => onOk(),
        onCancel: () => navigate('/label-templates'),
      })
      return true
    }
    return false
  }

  /** 新增 user 标签（仅 application 展示入口；key 冲突 / 校验失败拦截） */
  const handleAddLabel = () => {
    if (!record) return
    const key = newKey.trim()
    const value = newValue.trim()
    const keyError = validateLabelKey(key, labels)
    if (keyError) {
      message.error(keyError)
      return
    }
    if (guardTemplateConflict(key, () => doAddUserLabel(key, value))) return
    doAddUserLabel(key, value)
  }

  const doAddUserLabel = (key: string, value: string) => {
    if (!record) return
    setSubmitting(true)
    setWriteError(null)
    resourceApi
      .createLabel(record.resource_id, { key, value })
      .then((res) => {
        setLabels((prev) => [...prev, res.data])
        setNewKey('')
        setNewValue('')
        message.success('标签已添加')
      })
      .catch((err: unknown) => handleWriteError(err))
      .finally(() => setSubmitting(false))
  }

  /** 进入编辑态（仅 application 的 user 标签） */
  const handleEditValue = (label: ResourceLabelItem) => {
    setEditingId(label.id)
    setEditValue(label.value)
  }

  /** 编辑 user 标签值（key 不可改，仅更新 value，§6.2/PUT）；key 命中模板映射同样弹冲突提示 */
  const handleSaveEdit = (label: ResourceLabelItem) => {
    if (!record) return
    if (guardTemplateConflict(label.key, () => doUpdateLabel(label))) return
    doUpdateLabel(label)
  }

  const doUpdateLabel = (label: ResourceLabelItem) => {
    if (!record) return
    setSubmitting(true)
    setWriteError(null)
    resourceApi
      .updateLabel(record.resource_id, label.id, { value: editValue })
      .then((res) => {
        setLabels((prev) => prev.map((l) => (l.id === label.id ? res.data : l)))
        setEditingId(null)
        message.success('标签已更新')
      })
      .catch((err: unknown) => handleWriteError(err))
      .finally(() => setSubmitting(false))
  }

  /** 删除 user 标签 */
  const handleDeleteLabel = (label: ResourceLabelItem) => {
    if (!record) return
    setSubmitting(true)
    setWriteError(null)
    resourceApi
      .removeLabel(record.resource_id, label.id)
      .then(() => {
        setLabels((prev) => prev.filter((l) => l.id !== label.id))
        message.success('标签已删除')
      })
      .catch((err: unknown) => handleWriteError(err))
      .finally(() => setSubmitting(false))
  }

  /** 基础属性（资源 ID / 网域 / 业务 biz_name / 运行状态 / 来源 置顶，§5.4 网域置顶） */
  const baseItems = record
    ? [
        { key: 'resource_id', label: '资源 ID', children: <Text code>{record.resource_id}</Text> },
        {
          key: 'network_domain_id',
          label: '网域',
          children: <Tag color="cyan">{domainNameOf(record.network_domain_id)}</Tag>,
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
            <Badge color={STATUS_COLOR[record.status] ?? '#86909C'} text={STATUS_MAP[record.status] ?? record.status} />
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
          children: RESOURCE_CATEGORY_MAP[record.resource_category],
        },
        { key: 'env', label: '环境', children: record.env || '-' },
        { key: 'app_name', label: '应用', children: record.app_name || '-' },
        { key: 'cluster', label: '集群', children: record.cluster || '-' },
        { key: 'owner', label: '负责人', children: record.owner || '-' },
        {
          key: 'apply_template',
          label: '适用模板',
          children: template ? (
            <Link style={{ fontSize: 12 }} onClick={() => navigate('/label-templates')}>
              {template.name}（{template.id}）
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
        }
      })()
    : []

  /** 标签来源 Tag（cmdb 以「v0.4+ 预留」占位，§3.3 统一口径） */
  const renderSourceTag = (label: ResourceLabelItem) => {
    if (label.source === 'cmdb') return <Tag>CMDB · v0.4+ 预留</Tag>
    if (label.source === 'user') return <Tag color="cyan">用户</Tag>
    return <Tag>系统</Tag>
  }

  /** 标签来源标注（§5.3 联动呈现：system → 模板·source_map；user → 手动添加；cmdb → 预留说明） */
  const renderAnnotation = (label: ResourceLabelItem) => {
    if (label.source === 'system') {
      if (!template) return <Text type="secondary" style={{ fontSize: 12 }}>来自标签模板</Text>
      return (
        <Text
          type="secondary"
          style={{ fontSize: 12, cursor: 'pointer' }}
          onClick={() => navigate('/label-templates')}
        >
          <Tooltip title="前往标签模板管理">
            {label.source_map ? `来自 ${template.name} · ${label.source_map}` : `来自 ${template.name}`}
          </Tooltip>
        </Text>
      )
    }
    if (label.source === 'user') {
      return <Text type="secondary" style={{ fontSize: 12 }}>手动添加</Text>
    }
    return <Text type="secondary" style={{ fontSize: 12 }}>CMDB 同步（v0.4+ 接入后生效，MVP 仅占位展示）</Text>
  }

  /** 单条标签行：system/cmdb 与静态资源的 user 标签只读；application 的 user 标签可编辑/删除 */
  const renderLabelRow = (label: ResourceLabelItem) => {
    const canEdit = isApplication && label.source === 'user'
    const isEditing = editingId === label.id
    return (
      <div
        key={label.id}
        style={{ borderLeft: `4px solid ${LABEL_SOURCE_BORDER[label.source]}`, background: '#FAFAFA', padding: '8px 12px', borderRadius: 4 }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <Space size={8} wrap>
            <Text strong>{label.key}</Text>
            {renderSourceTag(label)}
            {!canEdit && <LockOutlined style={{ color: '#86909C', fontSize: 12 }} />}
          </Space>
          {canEdit && !isEditing && (
            <Space size={4}>
              <Button type="text" size="small" icon={<EditOutlined />} disabled={submitting} onClick={() => handleEditValue(label)}>
                编辑
              </Button>
              <Button type="text" size="small" danger icon={<DeleteOutlined />} disabled={submitting} onClick={() => handleDeleteLabel(label)}>
                删除
              </Button>
            </Space>
          )}
        </div>
        <div style={{ marginTop: 4 }}>{renderAnnotation(label)}</div>
        <div style={{ marginTop: 4 }}>
          {canEdit && isEditing ? (
            <Space.Compact block>
              <Input
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onPressEnter={() => handleSaveEdit(label)}
                placeholder="标签值"
              />
              <Button type="primary" icon={<SaveOutlined />} loading={submitting} onClick={() => handleSaveEdit(label)}>
                保存
              </Button>
              <Button icon={<CloseOutlined />} disabled={submitting} onClick={() => setEditingId(null)}>
                取消
              </Button>
            </Space.Compact>
          ) : (
            <EllipsisText maxWidth={520}>{label.value || '-'}</EllipsisText>
          )}
        </div>
      </div>
    )
  }

  return (
    <Drawer
      title="资源详情"
      width={720}
      open={open}
      onClose={onCancel}
      extra={
        <Button onClick={onCancel} disabled={submitting}>
          关闭
        </Button>
      }
    >
      {record && (
        <>
          <Descriptions column={2} size="small" title="基础信息" items={baseItems} />
          <Descriptions column={2} size="small" title="类型字段" style={{ marginTop: 16 }} items={typeItems} />
          <Divider />
          <Title level={5}>{isApplication ? '自定义标签（非必须）' : '自定义标签（静态资源只读）'}</Title>
          {writeError && (
            <Alert
              type="error"
              showIcon
              message="标签操作失败"
              description={writeError}
              style={{ marginBottom: 12 }}
            />
          )}
          {labelsLoading ? (
            <Skeleton active paragraph={{ rows: 3 }} />
          ) : labelsError ? (
            <Alert
              type="error"
              showIcon
              message="标签数据加载失败，请稍后重试"
              description={labelsError}
              action={
                <Button size="small" onClick={reloadLabels}>
                  重新加载
                </Button>
              }
            />
          ) : (
            <>
              {isApplication ? (
                <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 12 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    大多数场景下，标签模板已自动生成所需标签；仅当个别实例需要额外标签时使用。
                  </Text>
                  <Space.Compact block>
                    <Input
                      placeholder="标签 Key，如 team"
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      onPressEnter={handleAddLabel}
                    />
                    <Input
                      placeholder="标签值"
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                      onPressEnter={handleAddLabel}
                    />
                    <Button type="primary" icon={<PlusOutlined />} loading={submitting} onClick={handleAddLabel}>
                      添加
                    </Button>
                  </Space.Compact>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    key 规则：小写字母 / 数字 / 下划线；禁止 __ 开头；长度 ≤128；禁止覆盖 Prometheus 内置标签。
                  </Text>
                </Space>
              ) : (
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                  静态资源标签由 CMDB / Excel 治理，平台只读，不提供实例级打标入口。如需修改标签，请前往 CMDB 或更新导入数据。
                </Text>
              )}
              {labels.length === 0 ? (
                <Empty description="暂无自定义标签（非必须）" image={Empty.PRESENTED_IMAGE_SIMPLE}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    标签模板已自动生成所需标签，仅当个别实例需要额外标签时使用。
                  </Text>
                </Empty>
              ) : (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {labels.map((label) => renderLabelRow(label))}
                </Space>
              )}
            </>
          )}
        </>
      )}
    </Drawer>
  )
}

export default ResourceDetailDrawer

import { useMemo, useState, type ReactNode } from 'react'
import {
  Card,
  Table,
  Button,
  Tag,
  Drawer,
  Form,
  Input,
  Select,
  Switch,
  Space,
  Typography,
  Row,
  Col,
  Alert,
  Statistic,
  Tabs,
  App,
  Tooltip,
  Empty,
  Segmented,
  Upload,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  CodeOutlined,
  MinusCircleOutlined,
  ThunderboltOutlined,
  InfoCircleOutlined,
  ArrowRightOutlined,
  UploadOutlined,
  EyeOutlined,
} from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { ReviewNote } from '../components/ReviewNote'
import {
  mockMonitoringRules,
  mockMountedRuleFiles,
  mockExporterTemplates,
  mockCITypeExporterMappings,
  metricLibraryStore,
  CI_TYPE_LABEL,
  CI_TYPE_CATEGORY_MAP,
  CI_TYPES_BY_CATEGORY,
  RESOURCE_CATEGORIES,
  RESOURCE_CATEGORY_MAP,
  RULE_TYPE_MAP,
  METRIC_TYPE_COLOR,
  METRIC_TYPE_LABEL,
} from '../mocks/module-01'
import type {
  CiType,
  RuleType,
  MonitoringRule,
  MountedRuleFile,
  ResourceCategory,
} from '../mocks/module-01'

const { Title, Text } = Typography
const { TextArea } = Input
const { Option } = Select
const { TabPane } = Tabs

const now = () => new Date().toISOString()

/** 时间格式化：YYYY-MM-DD HH:mm */
const formatTime = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 表单内字段说明提示（轻量非 Alert）：代替表单中堆叠的说明性 Alert，用户主区保持清爽
function FieldGuide({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 8, padding: '8px 12px', background: '#F7F9FB', borderRadius: 6 }}>
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <Text strong style={{ fontSize: 12 }}>
          {title}
        </Text>
        {children}
      </Space>
    </div>
  )
}

// {v3.20} D28：规则变更引导（rules.yml 变更必须 reload，走 M09 人工确认档，决策 38-1）——跨模块跳转链接与采集 Job 同机制（D27-2）
const MODULE_LINKS = {
  module09: '../module-09/dist/index.html',
} as const

// {v3.22} v0.2 能力角标：橙色小 Tag，标识「该能力 v0.2 交付」的入口/按钮（演示态占位标记）
function V02Badge() {
  return (
    <Tag
      color="orange"
      style={{
        marginInlineStart: 4,
        marginInlineEnd: 0,
        paddingInline: 4,
        lineHeight: '14px',
        fontSize: 10,
        borderRadius: 4,
      }}
    >
      v0.2
    </Tag>
  )
}

// 从 PromQL 表达式中粗略解析出引用的指标名（去掉 label selector / 字符串字面量 / by/without 子句）
const extractMetricNames = (expr: string): string[] => {
  if (!expr) return []
  const stripped = expr
    .replace(/"[^"]*"/g, '""')
    .replace(/\{[^}]*\}/g, '{}')
    .replace(/\[[^\]]*\]/g, '[]')
    .replace(/\b(?:by|without)\s*\([^)]*\)/gi, '')
  const matches = stripped.match(/[a-zA-Z_:][a-zA-Z0-9_:]*/g) ?? []
  const functions = new Set([
    'rate', 'irate', 'increase', 'sum', 'avg', 'min', 'max', 'count',
    'and', 'or', 'unless', 'on', 'ignoring', 'group_left', 'group_right',
    'offset', 'histogram_quantile', 'topk', 'bottomk', 'quantile',
    'predict_linear', 'changes', 'delta', 'deriv', 'idelta', 'resets',
    'absent', 'ceil', 'floor', 'round', 'abs', 'clamp_max', 'clamp_min',
    'clamp', 'time', 'vector', 'scalar', 'sort', 'sort_desc', 'sqrt',
    'ln', 'log2', 'log10', 'exp', 'sgn', 'deg', 'rad', 'pi', 'year',
    'month', 'day_of_month', 'day_of_week', 'days_in_month', 'hour',
    'minute', 'timestamp', 'label_replace', 'label_join', 'bool',
    'aggr_over_time', 'avg_over_time', 'min_over_time', 'max_over_time',
    'sum_over_time', 'count_over_time', 'quantile_over_time',
    'stddev_over_time', 'stdvar_over_time', 'last_over_time',
    'present_over_time', 'holt_winters', 'histogram_count', 'histogram_sum',
    'histogram_avg', 'histogram_stddev', 'histogram_stdvar',
    'histogram_fraction',
  ])
  return matches.filter((n) => !functions.has(n))
}

/** {v3.24} 规则文件挂载 YAML 校验（PRD 5.5 / 6.2.4）：至少校验 groups 存在且为数组 */
const validateRuleContent = (
  content: string
): { ok: true } | { ok: false; message: string } => {
  if (!content.trim()) return { ok: false, message: '规则文件内容不能为空' }
  if (!/^groups\s*:/m.test(content)) {
    return { ok: false, message: 'YAML 非法：缺少顶层键 groups（rules.yml 必须以 groups 为顶层数组）' }
  }
  const groupNames = content.match(/^\s*-\s*name\s*:/gm)
  if (!groupNames || groupNames.length === 0) {
    return { ok: false, message: 'YAML 非法：groups 下缺少规则分组（需至少一个 - name: xxx）' }
  }
  if (!/^(\s*)rules\s*:/m.test(content)) {
    return { ok: false, message: 'YAML 非法：缺少 rules 键（每个分组下需有 rules 数组）' }
  }
  return { ok: true }
}

/** 统计 rules.yml 内规则条数（groups[*].rules 中 alert / record 条目合计，原型启发式） */
const countRuleCount = (content: string): number => {
  const alerts = content.match(/^\s*-\s*alert\s*:/gm) ?? []
  const records = content.match(/^\s*-\s*record\s*:/gm) ?? []
  return alerts.length + records.length
}

// ==================== MVP 视图：规则文件挂载（PRD 5.5 / 3.1，{v3.24}） ====================

function FileMountView() {
  const { modal, message } = App.useApp()
  const [files, setFiles] = useState<MountedRuleFile[]>(() => [...mockMountedRuleFiles])
  const [mountOpen, setMountOpen] = useState(false)
  const [mountName, setMountName] = useState('')
  const [mountContent, setMountContent] = useState('')
  const [mountError, setMountError] = useState<string | null>(null)
  const [detailFile, setDetailFile] = useState<MountedRuleFile | null>(null)

  const totalRules = files.reduce((acc, f) => acc + f.rule_count, 0)
  const enabledCount = files.filter((f) => f.enabled).length

  /** {v3.24} 规则变更引导（决策 D28 / 38-1）：与采集 Job 同源同机制——乐观更新 toast + 「前往配置变更确认」跳转 */
  const showChangePendingToast = (baseMsg: string) => {
    message.success({
      content: `${baseMsg}：已标为「待下发」，变更将由 M09 生成变更单，需确认后生效（点击本条前往配置变更确认）`,
      onClick: () => window.open(MODULE_LINKS.module09, '_blank'),
    })
  }

  const handleMount = () => {
    const result = validateRuleContent(mountContent)
    if (!result.ok) {
      setMountError(result.message)
      return
    }
    setMountError(null)
    const newFile: MountedRuleFile = {
      rule_id: `rule-file-${Date.now()}`,
      name: mountName.trim() || `rules-挂载-${files.length + 1}`,
      content_mode: 'yaml_passthrough',
      rule_content: mountContent,
      rule_count: countRuleCount(mountContent),
      enabled: true,
      change_status: 'pending',
      created_at: now(),
      updated_at: now(),
    }
    setFiles((prev) => [newFile, ...prev])
    setMountOpen(false)
    setMountName('')
    setMountContent('')
    setMountError(null)
    showChangePendingToast('规则已挂载')
  }

  const handleToggleEnabled = (record: MountedRuleFile, checked: boolean) => {
    setFiles((prev) =>
      prev.map((f) =>
        f.rule_id === record.rule_id
          ? { ...f, enabled: checked, change_status: 'pending' as const, updated_at: now() }
          : f
      )
    )
    showChangePendingToast(checked ? '规则已启用' : '规则已禁用')
  }

  const handleDelete = (record: MountedRuleFile) => {
    modal.confirm({
      title: '确认删除',
      content: `确定删除已挂载的规则文件「${record.name}」？删除后 M09 生成的 rules.yml 将移除该文件内容，规则不再生效。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        setFiles((prev) => prev.filter((f) => f.rule_id !== record.rule_id))
        showChangePendingToast('规则已删除')
      },
    })
  }

  /** 读取本地 rules.yml 文件内容填入粘贴框，并自动带出展示名 */
  const onReadFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      setMountContent(text)
      if (!mountName.trim()) {
        setMountName(file.name.replace(/\.(ya?ml|yml)$/i, ''))
      }
    }
    reader.readAsText(file)
    return false
  }

  const renderChangeStatus = (status: MountedRuleFile['change_status']) => {
    if (status === 'pending') {
      return (
        <Tooltip title="存在待确认的配置变更单，点击前往 M09「配置变更确认」页确认发布">
          <Button
            type="link"
            size="small"
            icon={<ArrowRightOutlined />}
            style={{ padding: 0, height: 'auto', fontSize: 13 }}
            onClick={() => window.open(MODULE_LINKS.module09, '_blank')}
          >
            待确认
          </Button>
        </Tooltip>
      )
    }
    if (status === 'confirmed') return <Tag color="success">已确认</Tag>
    return <Text type="secondary">-</Text>
  }

  const columns = [
    {
      title: '规则文件',
      dataIndex: 'name',
      key: 'name',
      render: (value: string) => (
        <Space>
          <Text strong>{value}</Text>
          <Tag color="geekblue">文件透传</Tag>
        </Space>
      ),
    },
    {
      title: (
        <Tooltip title="groups[*].rules 中 alert / record 条目合计">
          <Space size={4}>
            规则条数
            <InfoCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
          </Space>
        </Tooltip>
      ),
      dataIndex: 'rule_count',
      key: 'rule_count',
      width: 100,
      render: (value: number) => <Tag color="blue">{value} 条</Tag>,
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 150,
      render: (value: string) => <Text type="secondary">{formatTime(value)}</Text>,
    },
    {
      // {v3.24} 下发状态（决策 D28 / 38-1）：rules.yml 变更必须 reload、走 M09 人工确认档；与采集 Job 同源同机制
      title: (
        <Tooltip title="规则变更下发状态（来自 M09 变更单）：待确认=有变更单待你在「配置变更确认」页确认发布；已确认=变更单已确认；无变更=未产生变更单">
          <Space size={4}>
            下发状态
            <InfoCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
          </Space>
        </Tooltip>
      ),
      key: 'changeStatus',
      width: 120,
      render: (_: unknown, record: MountedRuleFile) => renderChangeStatus(record.change_status),
    },
    {
      title: '启用状态',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 90,
      render: (value: boolean, record: MountedRuleFile) => (
        <Switch
          checked={value}
          size="small"
          onChange={(checked) => handleToggleEnabled(record, checked)}
        />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 130,
      render: (_: unknown, record: MountedRuleFile) => (
        <Space>
          <Button type="link" icon={<EyeOutlined />} onClick={() => setDetailFile(record)}>
            详情
          </Button>
          <Button type="link" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record)}>
            删除
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <>
      <Row gutter={[16, 16]} align="middle" justify="space-between" style={{ marginBottom: 16 }}>
        <Col>
          <Button
            type="primary"
            icon={<UploadOutlined />}
            style={{ backgroundColor: '#0ECDEB' }}
            onClick={() => setMountOpen(true)}
          >
            上传 / 粘贴 rules.yml 挂载
          </Button>
        </Col>
        <Col>
          <Space size="large">
            <Statistic title="已挂载文件" value={files.length} valueStyle={{ color: '#0ECDEB' }} />
            <Statistic title="规则条数" value={totalRules} />
            <Statistic title="已启用" value={enabledCount} valueStyle={{ color: '#52C41A' }} />
          </Space>
        </Col>
      </Row>

      <Alert
        type="info"
        showIcon
        message="规则文件挂载（MVP）"
        description="本页通过上传 / 粘贴完整的规则文件来挂载告警与记录规则。保存 / 启停 / 删除后，变更进入配置中心的变更确认流程，确认后统一下发生效；右上角可切换「字段化编辑」查看 v0.3 的逐条编辑预览。"
        style={{ marginBottom: 16 }}
      />

      <Table
        rowKey="rule_id"
        dataSource={files}
        columns={columns}
        pagination={{ pageSize: 5 }}
      />

      {/* 挂载抽屉：上传 / 粘贴整文件 rules.yml */}
      <Drawer
        title="挂载 rules.yml"
        open={mountOpen}
        onClose={() => {
          setMountOpen(false)
          setMountError(null)
        }}
        width={680}
        maskClosable={false}
        extra={
          <Space>
            <Button
              onClick={() => {
                setMountOpen(false)
                setMountError(null)
              }}
            >
              取消
            </Button>
            <Button type="primary" style={{ backgroundColor: '#0ECDEB' }} onClick={handleMount}>
              挂载并提交
            </Button>
          </Space>
        }
      >
        <Form layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="规则文件名称（展示名，选填）" extra="留空则按上传文件名或「rules-挂载-N」自动生成">
            <Input
              value={mountName}
              onChange={(e) => setMountName(e.target.value)}
              placeholder="如：主机与中间件告警"
            />
          </Form.Item>
          <Form.Item
            label="rules.yml 内容（必填）"
            extra="支持直接粘贴或选择本地 .yml / .yaml 文件上传；内容需含 groups 顶层数组，校验通过后保存"
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              <Upload beforeUpload={onReadFile} showUploadList={false} accept=".yml,.yaml">
                <Button icon={<UploadOutlined />}>选择文件上传</Button>
              </Upload>
              <TextArea
                rows={18}
                value={mountContent}
                onChange={(e) => {
                  setMountContent(e.target.value)
                  setMountError(null)
                }}
                placeholder={'groups:\n  - name: node.rules\n    rules:\n      - alert: HostHighCpuUsage\n        expr: ...\n'}
                style={{ fontFamily: 'SFMono-Regular, Consolas, Menlo, monospace', fontSize: 12 }}
              />
            </Space>
          </Form.Item>
          {mountError && (
            <Alert
              type="error"
              showIcon
              message="挂载失败"
              description={mountError}
              style={{ marginBottom: 16 }}
            />
          )}
          <Alert
            type="info"
            showIcon
            message="挂载后的配置闭环"
            description="挂载保存后，M09 下一轮询周期检测到 MonitoringRule 变化 → 生成 rules.yml 草稿（rule_content 原样并入）→ 在「配置变更确认」页人工确认后下发生效；本页列表「下发状态」随 M09 变更单状态回写（与采集 Job 同源同机制）。"
          />
        </Form>
      </Drawer>

      {/* 详情抽屉：YAML 只读视图 */}
      <Drawer
        title={detailFile ? `规则文件：${detailFile.name}` : '规则文件详情'}
        open={!!detailFile}
        onClose={() => setDetailFile(null)}
        width={680}
      >
        {detailFile && (
          <>
            <Space wrap style={{ marginBottom: 16 }}>
              <Tag color="geekblue">文件透传</Tag>
              <Tag color="blue">{detailFile.rule_count} 条规则</Tag>
              <Tag color={detailFile.enabled ? 'success' : 'default'}>
                {detailFile.enabled ? '已启用' : '已停用'}
              </Tag>
              {detailFile.change_status === 'pending' && <Tag color="warning">待确认</Tag>}
              {detailFile.change_status === 'confirmed' && <Tag color="success">已确认</Tag>}
            </Space>
            <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              更新时间：{formatTime(detailFile.updated_at)} · 该内容将原样并入 M09 生成的 rules.yml
            </Text>
            <pre
              style={{
                margin: 0,
                padding: 12,
                background: '#0B1B2A',
                color: '#C9D1D9',
                borderRadius: 6,
                maxHeight: 480,
                overflow: 'auto',
                fontFamily: 'SFMono-Regular, Consolas, Menlo, monospace',
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              {detailFile.rule_content}
            </pre>
          </>
        )}
      </Drawer>
    </>
  )
}

// ==================== v0.3 预览视图：字段化编辑（PRD 3.2，{v3.24} 明确为 structured 形态） ====================

function StructuredEditView() {
  const { modal, message } = App.useApp()
  const [rules, setRules] = useState<MonitoringRule[]>(() => [...mockMonitoringRules])
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<MonitoringRule | null>(null)
  const [validating, setValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<ValidationResult>(null)
  // {v3.22} 提交生效失败错误：定位展示在 PromQL 表达式字段下方（决策 D29）
  const [saveError, setSaveError] = useState<string | null>(null)
  const [previewVisible, setPreviewVisible] = useState(false)
  const [form] = Form.useForm()

  const watchRuleType = Form.useWatch('rule_type', form) as RuleType | undefined
  const watchExporterTemplateId = Form.useWatch('exporter_template_id', form) as
    | string
    | undefined
  const watchResourceCategory = Form.useWatch('resource_category', form)
  const watchResourceType = Form.useWatch('resource_type', form)
  const categoryCiTypes = (watchResourceCategory as ResourceCategory | undefined)
    ? CI_TYPES_BY_CATEGORY[watchResourceCategory as ResourceCategory]
    : []

  const templateNameMap = useMemo(() => {
    const map = new Map<string, string>()
    mockExporterTemplates.forEach((t) => map.set(t.exporter_template_id, t.name))
    return map
  }, [])

  const alertingRules = useMemo(
    () => rules.filter((r) => r.rule_type === 'alerting'),
    [rules]
  )
  const recordingRules = useMemo(
    () => rules.filter((r) => r.rule_type === 'recording'),
    [rules]
  )

  // {v3.8} 指标预览：按 CI 类型（resource_types 主锚点）过滤当前指标库（共享 store，含用户新增/禁用）启用的指标名；
  // 同名指标（不同来源采集器）在预览/校验中显示来源区分
  const previewMetrics = metricLibraryStore.filter((m) => {
    if (!watchResourceType) return false
    return (
      m.enabled &&
      (m.resource_types ?? []).some((rt) => rt.resource_type === watchResourceType)
    )
  })

  // 将监控规则默认值打开 modal
  const handleOpenModal = (record?: MonitoringRule) => {
    setPreviewVisible(false)
    setValidating(false)
    setValidationResult(null)
    setSaveError(null)
    if (record) {
      setEditingRule(record)
      form.setFieldsValue({
        name: record.name,
        rule_type: record.rule_type,
        resource_category: CI_TYPE_CATEGORY_MAP[record.resource_type],
        resource_type: record.resource_type,
        exporter_template_id: record.exporter_template_id,
        duration: record.duration,
        expr: record.expr,
        enabled: record.enabled,
        labels: Object.entries(record.labels).map(([key, value]) => ({ key, value })),
        annotations: Object.entries(record.annotations).map(([key, value]) => ({
          key,
          value,
        })),
      })
    } else {
      setEditingRule(null)
      form.resetFields()
      form.setFieldsValue({
        rule_type: 'alerting',
        resource_category: 'host',
        resource_type: 'host_linux',
        duration: '5m',
        enabled: true,
        labels: [],
        annotations: [],
      })
    }
    setModalOpen(true)
  }

  const handleCloseModal = (force = false) => {
    const doClose = () => {
      setModalOpen(false)
      setEditingRule(null)
      setPreviewVisible(false)
      setValidating(false)
      setValidationResult(null)
      setSaveError(null)
      form.resetFields()
    }
    // 决策 36：Drawer 关闭前检查未保存修改；保存成功后由 handleSave 直接 force 关闭，不再弹确认
    if (!force && form.isFieldsTouched()) {
      modal.confirm({
        title: '有未保存的修改',
        content: '确定关闭吗？未保存的修改将丢失。',
        onOk: doClose,
      })
    } else {
      doClose()
    }
  }

  // {v3.8} 校验表达式引用的指标是否存在于指标库（基于共享指标库 store，按 CI 类型 resource_types 过滤）
  const validateMetrics = (
    expr: string,
    resourceType?: CiType
  ): { ok: true } | { ok: false; message: string } => {
    if (!expr.trim()) {
      return { ok: false, message: '表达式不能为空' }
    }
    const knownMetricNames = new Set(
      metricLibraryStore
        .filter((m) => m.enabled)
        .filter(
          (m) =>
            !resourceType ||
            (m.resource_types ?? []).some((rt) => rt.resource_type === resourceType)
        )
        .map((m) => m.metric_name)
    )
    // 全库兜底（用户可在不同 CI 类型间引用），只要任意启用指标命中即视为已知
    const allKnown = new Set(metricLibraryStore.filter((m) => m.enabled).map((m) => m.metric_name))
    const used = extractMetricNames(expr)
    const unknown = used.filter((n) => !allKnown.has(n))
    if (unknown.length > 0) {
      return {
        ok: false,
        message: `未知指标名 ${unknown.join(', ')}${
          resourceType ? `（不在「${CI_TYPE_LABEL[resourceType]}」指标库中）` : ''
        }`,
      }
    }
    // 同 CI 类型校验：若选定 CI 类型，所有指标都应在该类型的指标集内
    if (resourceType) {
      const notInType = used.filter((n) => !knownMetricNames.has(n))
      if (notInType.length > 0) {
        return {
          ok: false,
          message: `指标 ${notInType.join(', ')} 不属于所选 CI 类型「${CI_TYPE_LABEL[resourceType]}」的指标集（可先在技术指标库为该指标挂接该类型）`,
        }
      }
    }
    return { ok: true }
  }

  // 交互式 PromQL 校验：检查表达式中出现的指标名是否在所选 Exporter 指标库内
  const handleValidate = () => {
    const expr = (form.getFieldValue('expr') as string) ?? ''
    setValidating(true)
    setValidationResult(null)
    setTimeout(() => {
      setValidating(false)
      const resourceType = form.getFieldValue('resource_type') as CiType | undefined
      const result = validateMetrics(expr, resourceType)
      if (!result.ok) {
        setValidationResult({ status: 'error', message: `校验失败：${result.message}` })
        return
      }
      setValidationResult({
        status: 'success',
        message: '语法校验通过：表达式引用的指标均存在，结构正确。',
      })
    }, 600)
  }

  const handlePreview = () => {
    setPreviewVisible(true)
  }

  /** {v3.20} 规则保存/启停/删除后的动线引导（决策 D28）：rules.yml 变更必须 reload、走 M09 人工确认档（决策 38-1）；
   *  {v3.22} 改为乐观更新 toast：本地先标为「待下发」，点击 toast 前往 M09「配置变更确认」页确认发布
   *  与全站其他 toast 保持一致——单行 message.success */
  const showChangePendingToast = (baseMsg: string) => {
    message.success({
      content: `${baseMsg}：已标为「待下发」，变更将由 M09 生成变更单，需确认后生效（点击本条前往配置变更确认）`,
      onClick: () => window.open(MODULE_LINKS.module09, '_blank'),
    })
  }

  const handleSave = () => {
    form.validateFields().then((values) => {
      // 保存前强制校验：expr 引用的指标必须存在于指标库（PRD v2.0 决策 5；{v3.8} 按 CI 类型校验）
      const expr = (values.expr as string) ?? ''
      const resourceType = values.resource_type as CiType | undefined
      const metricResult = validateMetrics(expr, resourceType)
      if (!metricResult.ok) {
        // {v3.22} 决策 D29：提交生效失败——错误定位到 expr 字段下方（saveError Alert），不再只在表单底部提示
        setSaveError(metricResult.message)
        setValidationResult(null)
        message.error('提交生效失败：PromQL 引用了指标库中不存在的指标，请修正表达式')
        return
      }
      setSaveError(null)

      const labelsArr = (values.labels as { key: string; value: string }[]) ?? []
      const annotationsArr = (values.annotations as { key: string; value: string }[]) ?? []
      const labels: Record<string, string> = {}
      labelsArr.forEach((it) => {
        if (it.key) labels[it.key] = it.value
      })
      const annotations: Record<string, string> = {}
      annotationsArr.forEach((it) => {
        if (it.key) annotations[it.key] = it.value
      })
      const ruleType = values.rule_type as RuleType
      const payload = {
        name: values.name as string,
        rule_type: ruleType,
        expr: values.expr as string,
        duration: ruleType === 'alerting' ? (values.duration as string) : '',
        labels,
        annotations: ruleType === 'alerting' ? annotations : {},
        resource_type: values.resource_type as CiType,
        exporter_template_id: values.exporter_template_id as string,
        // MVP~v0.3 阶段 scope 固定 central（中心求值），不暴露给用户（PRD 5.5）
        scope: 'central' as const,
        enabled: values.enabled as boolean,
      }
      if (editingRule) {
        const updated: MonitoringRule = {
          ...editingRule,
          ...payload,
          // {v3.20} 保存后置「待确认」（M09 变更单待确认，决策 D28）
          change_status: 'pending',
          updated_at: now(),
        }
        setRules((prev) => prev.map((r) => (r.rule_id === editingRule.rule_id ? updated : r)))
        showChangePendingToast('规则已更新')
      } else {
        const newRule: MonitoringRule = {
          rule_id: `rule-${Date.now()}`,
          ...payload,
          // {v3.20} 新建即置「待确认」（M09 变更单待确认，决策 D28）
          change_status: 'pending',
          created_at: now(),
          updated_at: now(),
        }
        setRules((prev) => [...prev, newRule])
        showChangePendingToast('规则已新增')
      }
      // 保存成功后强制关闭，不触发决策 36 的未保存修改确认（变更已持久化）
      handleCloseModal(true)
    })
  }

  // {v3.22} 决策 D29：保存草稿（v0.2，本页为 v0.3 预览）——仅基础校验（规则名称必填）；
  // 草稿允许 PromQL 半成品暂存（不做指标存在性强校验），不入下发管线（draft_status='draft'、change_status='none'），表单保持打开
  const handleSaveDraft = () => {
    const name = form.getFieldValue('name') as string | undefined
    if (!name?.trim()) {
      message.warning('请先填写规则名称以保存草稿')
      return
    }
    setSaveError(null)
    const ruleType = (form.getFieldValue('rule_type') as RuleType) ?? 'alerting'
    const labelsArr = (form.getFieldValue('labels') as { key: string; value: string }[]) ?? []
    const annotationsArr = (form.getFieldValue('annotations') as { key: string; value: string }[]) ?? []
    const labels: Record<string, string> = {}
    labelsArr.forEach((it) => {
      if (it.key) labels[it.key] = it.value
    })
    const annotations: Record<string, string> = {}
    annotationsArr.forEach((it) => {
      if (it.key) annotations[it.key] = it.value
    })
    const payload = {
      name: name.trim(),
      rule_type: ruleType,
      expr: (form.getFieldValue('expr') as string) ?? '',
      duration: ruleType === 'alerting' ? ((form.getFieldValue('duration') as string) ?? '') : '',
      labels,
      annotations: ruleType === 'alerting' ? annotations : {},
      resource_type: (form.getFieldValue('resource_type') as CiType) ?? 'host_linux',
      exporter_template_id: form.getFieldValue('exporter_template_id') as string,
      // MVP~v0.3 阶段 scope 固定 central（中心求值），不暴露给用户（PRD 5.5）
      scope: 'central' as const,
      enabled: false,
    }
    if (editingRule) {
      const updated: MonitoringRule = {
        ...editingRule,
        ...payload,
        draft_status: 'draft',
        change_status: 'none',
        updated_at: now(),
      }
      setRules((prev) => prev.map((r) => (r.rule_id === editingRule.rule_id ? updated : r)))
    } else {
      const newRule: MonitoringRule = {
        rule_id: `rule-draft-${Date.now()}`,
        ...payload,
        draft_status: 'draft',
        change_status: 'none',
        created_at: now(),
        updated_at: now(),
      }
      setRules((prev) => [...prev, newRule])
    }
    message.success('草稿已保存，当前配置不会进入下发管线（可继续编辑后提交生效）')
    // 表单保持打开，不关闭 Drawer
  }

  const handleDelete = (record: MonitoringRule) => {
    modal.confirm({
      title: '确认删除',
      content: `确定删除规则「${record.name}」？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        setRules((prev) => prev.filter((r) => r.rule_id !== record.rule_id))
        showChangePendingToast('规则已删除')
      },
    })
  }

  const handleToggleEnabled = (record: MonitoringRule, checked: boolean) => {
    setRules((prev) =>
      prev.map((r) =>
        r.rule_id === record.rule_id
          ? { ...r, enabled: checked, change_status: 'pending' as const, updated_at: now() }
          : r
      )
    )
    showChangePendingToast(checked ? '规则已启用' : '规则已禁用')
  }

  const columns = [
    {
      title: '规则名称',
      dataIndex: 'name',
      key: 'name',
      render: (value: string, record: MonitoringRule) => (
        <Space>
          <Text strong>{value}</Text>
          <Tag color={RULE_TYPE_MAP[record.rule_type].color}>
            {RULE_TYPE_MAP[record.rule_type].text}
          </Tag>
        </Space>
      ),
    },
    {
      title: '资源类型',
      dataIndex: 'resource_type',
      key: 'resource_type',
      render: (value: CiType) => (
        <Space direction="vertical" size={0}>
          <Tag color="blue">{CI_TYPE_LABEL[value]}</Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {CI_TYPE_CATEGORY_MAP[value]}
          </Text>
        </Space>
      ),
    },
    {
      title: '关联 Exporter',
      dataIndex: 'exporter_template_id',
      key: 'exporter_template_id',
      render: (value: string) => (
        <Tag color="cyan">{templateNameMap.get(value) ?? value}</Tag>
      ),
    },
    {
      title: '表达式',
      dataIndex: 'expr',
      key: 'expr',
      ellipsis: true,
      render: (value: string) => (
        <Text code style={{ color: '#0ECDEB' }}>
          {value}
        </Text>
      ),
    },
    {
      title: '持续时间',
      dataIndex: 'duration',
      key: 'duration',
      render: (value: string, record: MonitoringRule) =>
        record.rule_type === 'recording' ? <Text type="secondary">-</Text> : value || '-',
    },
    {
      // {v3.20} 下发状态（决策 D28，v0.3 随规则编辑 UI 落地）：rules.yml 变更必须 reload、走 M09 人工确认档（决策 38-1）
      title: (
        <Tooltip title="规则变更下发状态（来自 M09 变更单）：待确认=有变更单待你在「配置变更确认」页确认发布（rules.yml 变更必须 reload，走人工确认）；已确认=变更单已确认；无变更=未产生变更单">
          <Space size={4}>
            下发状态
            <InfoCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
          </Space>
        </Tooltip>
      ),
      key: 'changeStatus',
      width: 130,
      render: (_: unknown, record: MonitoringRule) => {
        if (record.change_status === 'pending') {
          // {v3.20} 样式调整：原 warning Tag 易被误读为静态状态、看不出可点击；
          // 改为 link 型 Button + 箭头图标，明确「这是可前往确认的操作入口」
          return (
            <Tooltip title="存在待确认的配置变更单，点击前往 M09「配置变更确认」页确认发布">
              <Button
                type="link"
                size="small"
                icon={<ArrowRightOutlined />}
                style={{ padding: 0, height: 'auto', fontSize: 13 }}
                onClick={() => window.open(MODULE_LINKS.module09, '_blank')}
              >
                待确认
              </Button>
            </Tooltip>
          )
        }
        if (record.change_status === 'confirmed') return <Tag color="success">已确认</Tag>
        return <Text type="secondary">-</Text>
      },
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (value: boolean, record: MonitoringRule) => (
        <Switch
          checked={value}
          size="small"
          onChange={(checked) => handleToggleEnabled(record, checked)}
        />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: MonitoringRule) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => handleOpenModal(record)}>
            编辑
          </Button>
          <Button type="link" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record)}>
            删除
          </Button>
        </Space>
      ),
    },
  ]

  const renderTable = (data: MonitoringRule[]) => (
    <Table rowKey="rule_id" dataSource={data} columns={columns} pagination={{ pageSize: 5 }} />
  )

  // 渲染 key-value 动态表单（Form.List）
  const renderKeyValueList = (
    name: 'labels' | 'annotations',
    label: string,
    placeholderKey: string,
    placeholderValue: string
  ) => (
    <Form.List name={name}>
      {(fields, { add, remove }) => (
        <div style={{ marginBottom: 8 }}>
          {fields.length === 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              暂无{label}，点击下方按钮新增
            </Text>
          )}
          {fields.map((field) => (
            <Row gutter={8} key={field.key} style={{ marginBottom: 8 }} align="middle">
              <Col span={10}>
                <Form.Item name={[field.name, 'key']} noStyle>
                  <Input placeholder={placeholderKey} />
                </Form.Item>
              </Col>
              <Col span={10}>
                <Form.Item name={[field.name, 'value']} noStyle>
                  <Input placeholder={placeholderValue} />
                </Form.Item>
              </Col>
              <Col span={4}>
                <MinusCircleOutlined
                  onClick={() => remove(field.name)}
                  style={{ color: '#FF4C3A', fontSize: 16 }}
                />
              </Col>
            </Row>
          ))}
          <Button
            type="dashed"
            onClick={() => add({ key: '', value: '' })}
            icon={<PlusOutlined />}
            size="small"
            style={{ width: 160 }}
          >
            新增{label}行
          </Button>
        </div>
      )}
    </Form.List>
  )

  return (
    <>
      <Row gutter={[16, 16]} align="middle" justify="space-between" style={{ marginBottom: 16 }}>
        <Col>
          <Space>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              style={{ backgroundColor: '#0ECDEB' }}
              onClick={() => handleOpenModal()}
            >
              新增规则
            </Button>
            <Tooltip title="P1：规则模板一键填充（待实现）">
              <Button icon={<ThunderboltOutlined />} disabled>
                规则模板（P1）
              </Button>
            </Tooltip>
          </Space>
        </Col>
        <Col>
          <Space size="large">
            <Statistic
              title="告警规则"
              value={alertingRules.length}
              valueStyle={{ color: RULE_TYPE_MAP.alerting.color }}
            />
            <Statistic
              title="记录规则"
              value={recordingRules.length}
              valueStyle={{ color: RULE_TYPE_MAP.recording.color }}
            />
          </Space>
        </Col>
      </Row>

      <Alert
        type="info"
        showIcon
        message="v0.3 字段化编辑预览（content_mode=structured）"
        description="本视图为 v0.3 规划的类 YAML 字段化编辑（expr / for / labels / annotations），MVP 通过左侧「文件挂载」视图整文件透传 rules.yml；v0.3 落地后逐条写入 MonitoringRule（structured），同样经 M09 生成 rules.yml → 变更单人工确认 → 下发。"
        style={{ marginBottom: 16 }}
      />

      <Tabs defaultActiveKey="alerting">
        <TabPane tab="告警规则" key="alerting">
          {renderTable(alertingRules)}
        </TabPane>
        <TabPane tab="记录规则" key="recording">
          {renderTable(recordingRules)}
        </TabPane>
      </Tabs>

      <Drawer
        title={editingRule ? '编辑规则' : '新增规则'}
        open={modalOpen}
        onClose={() => handleCloseModal()}
        width={760}
        maskClosable={false}
        extra={
          <Space>
            <Button onClick={() => handleCloseModal()}>取消</Button>
            <Tooltip title="P1：规则模板一键填充（待实现）">
              <Button icon={<ThunderboltOutlined />} disabled>
                规则模板（P1）
              </Button>
            </Tooltip>
            <Button icon={<CodeOutlined />} onClick={handlePreview}>
              指标预览
            </Button>
            <Button icon={<PlayCircleOutlined />} loading={validating} onClick={handleValidate}>
              校验 PromQL
            </Button>
            {/* {v3.22} 决策 D29：双按钮——保存草稿（v0.2，基础校验，允许 PromQL 半成品暂存）/ 提交生效（完整校验） */}
            <Button onClick={handleSaveDraft}>
              保存草稿<V02Badge />
            </Button>
            <Button type="primary" style={{ backgroundColor: '#0ECDEB' }} onClick={handleSave}>
              提交生效
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="规则名称"
                name="name"
                rules={[{ required: true, message: '请输入规则名称' }]}
              >
                <Input placeholder="如 HostHighCpuUsage" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="规则类型"
                name="rule_type"
                rules={[{ required: true, message: '请选择规则类型' }]}
              >
                <Select disabled={!!editingRule}>
                  <Option value="alerting">告警规则</Option>
                  <Option value="recording">记录规则</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="资源类别"
                name="resource_category"
                rules={[{ required: true, message: '请选择资源类别' }]}
              >
                <Select
                  placeholder="请选择"
                  onChange={() => form.setFieldsValue({ resource_type: undefined, exporter_template_id: undefined })}
                >
                  {RESOURCE_CATEGORIES.map((cat) => (
                    <Option key={cat} value={cat}>
                      {RESOURCE_CATEGORY_MAP[cat]}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="CI 类型"
                name="resource_type"
                rules={[{ required: true, message: '请选择 CI 类型' }]}
                extra="选中后自动带出该类型的默认采集配置（默认采集器）；指标提示与校验按该类型的指标集进行"
              >
                <Select
                  placeholder={categoryCiTypes.length > 0 ? '请选择 CI 类型' : '请先选择资源类别'}
                  disabled={categoryCiTypes.length === 0}
                  onChange={(type) => {
                    const mapping = mockCITypeExporterMappings.find(
                      (m) => m.resource_type === (type as CiType)
                    )
                    form.setFieldsValue({
                      exporter_template_id: mapping?.exporter_template_id,
                    })
                  }}
                >
                  {categoryCiTypes.map((type) => (
                    <Option key={type} value={type}>
                      {CI_TYPE_LABEL[type]}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item
                label="默认采集器"
                name="exporter_template_id"
                extra="可选：与所选 CI 类型联动自动带出默认采集器（建议采集器），用于指标预览与 PromQL 校验；指标提示按该类型指标集进行，可不选"
              >
                <Select placeholder="请选择" showSearch optionFilterProp="children">
                  {mockExporterTemplates
                    .filter((t) => t.supported_resource_types.length > 0)
                    .filter((t) =>
                      watchResourceType
                        ? t.supported_resource_types.includes(watchResourceType as CiType)
                        : true
                    )
                    .map((t) => (
                      <Option key={t.exporter_template_id} value={t.exporter_template_id}>
                        {t.name} v{t.version}
                      </Option>
                    ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          {watchRuleType === 'alerting' && (
            <Form.Item label="持续时间 (for)" name="duration">
              <Input placeholder="如 5m" />
            </Form.Item>
          )}

          <Form.Item
            label="PromQL 表达式"
            name="expr"
            rules={[{ required: true, message: '请输入表达式' }]}
          >
            <TextArea rows={4} placeholder="输入 PromQL 表达式" />
          </Form.Item>

          {/* {v3.22} 决策 D29：提交生效失败——错误定位到 expr 字段下方（saveError Alert），替代仅在表单底部提示 */}
          {saveError && (
            <Alert
              type="error"
              showIcon
              message="提交生效失败"
              description={saveError}
              style={{ marginBottom: 16 }}
            />
          )}

          <Alert
            type="info"
            showIcon
            message="规则不绑定网域"
            description="告警/记录规则针对全部网域的聚合数据统一求值，因此无需（也不应）绑定单一网域；如需限定到某网域，请在表达式中按「网域」标签过滤。"
            style={{ marginBottom: 16 }}
          />

          <Row gutter={16}>
            <Col span={12}>
              {/* [DEV] 决策 35：Labels 语义说明（轻量提示，非 Alert） */}
              <FieldGuide title="规则 Labels 与标签模板的区别">
                <Text>
                  此处的 labels 是<Text strong>告警元数据</Text>（如 <Text code>severity=critical</Text>、<Text code>team=sre</Text>），用于告警分级、路由与接收人匹配；<Text strong>不是</Text>标签模板中生成的 target 身份标签（如 <Text code>instance</Text>、<Text code>app</Text>、<Text code>env</Text>）。
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  必填状态：整体为<Text strong>选填</Text>（推荐填写），每个 key 和 value 均为选填。推荐 key：<Text code>severity</Text>（critical/warning/info）、<Text code>team</Text>。
                </Text>
              </FieldGuide>
              <Form.Item label="告警标签（Alert Labels）" required={false}>
                {renderKeyValueList('labels', 'Label', 'severity', 'warning')}
              </Form.Item>
            </Col>
            <Col span={12}>
              {watchRuleType === 'alerting' ? (
                <>
                  {/* [DEV] 决策 35：Annotations 必要性说明（轻量提示） */}
                  <FieldGuide title="Annotations 的作用">
                    <Text>
                      annotations 是告警触发时附带的<Text strong>人类可读信息</Text>，用于告警通知中的展示内容。<Text strong>不参与告警路由判断</Text>，仅用于通知展示。
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      必填状态：整体为<Text strong>选填</Text>（推荐填写），每个 key 和 value 均为选填。推荐 key：<Text code>summary</Text>、<Text code>description</Text>、<Text code>runbook_url</Text>。
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      模板变量：<Text code>{'{{ $labels.instance }}'}</Text> 引用标签值、<Text code>{'{{ $value }}'}</Text> 引用当前指标值。
                    </Text>
                  </FieldGuide>
                  <Form.Item label="告警说明（Annotations）" required={false}>
                    {renderKeyValueList('annotations', 'Annotation', 'summary', '主机 CPU 过高')}
                  </Form.Item>
                </>
              ) : (
                <>
                  {/* [DEV] 决策 35：记录规则 labels 特殊说明（轻量提示） */}
                  <FieldGuide title="记录规则 Labels 说明">
                    <Text>
                      记录规则的 labels 语义与告警规则不同——此处的 labels 将附加到记录规则生成的新时间序列上，用于标识计算结果的维度（如 team、datacenter）。不参与告警路由。
                    </Text>
                  </FieldGuide>
                  <Form.Item label="记录标签（Recording Labels）" required={false}>
                    {renderKeyValueList('labels', 'Label', 'team', 'sre')}
                  </Form.Item>
                </>
              )}
            </Col>
          </Row>

          <Form.Item label="启用状态" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>

          {validationResult && (
            <Alert
              type={validationResult.status === 'success' ? 'success' : 'error'}
              showIcon
              message={validationResult.status === 'success' ? 'PromQL 校验通过' : 'PromQL 校验失败'}
              description={validationResult.message}
              style={{ marginBottom: 16 }}
            />
          )}

          {previewVisible && (
            <div style={{ marginBottom: 16 }}>
              <Text strong style={{ fontSize: 12 }}>
                指标预览
                {previewMetrics.length > 0
                  ? `：${templateNameMap.get(watchExporterTemplateId ?? '') ?? ''}（${previewMetrics.length} 个启用指标）`
                  : ''}
              </Text>
              {previewMetrics.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={watchResourceType ? '该 CI 类型暂无启用指标' : '请先选择 CI 类型'}
                  style={{ marginTop: 8 }}
                />
              ) : (
                <Space wrap size={[4, 4]} style={{ marginTop: 8 }}>
                  {previewMetrics.map((m) => (
                    <Tooltip
                      key={m.metric_id}
                      title={`${m.help}${m.unit ? ` · 单位 ${m.unit}` : ''} · ${METRIC_TYPE_LABEL[m.metric_type]}`}
                    >
                      <Tag color={METRIC_TYPE_COLOR[m.metric_type]} style={{ marginBottom: 4 }}>
                        {m.metric_name}
                      </Tag>
                    </Tooltip>
                  ))}
                </Space>
              )}
            </div>
          )}
        </Form>
      </Drawer>
    </>
  )
}

type ValidationResult =
  | { status: 'success'; message: string }
  | { status: 'error'; message: string }
  | null

/** {v3.24} 规则编辑页（PRD 3.1 / 3.2 / 5.5）：MVP 提供「文件挂载」视图（整文件透传 rules.yml），v0.3 提供「字段化编辑」视图（预览） */
export default function RulesPage() {
  // 视图模式：mount = MVP 规则文件挂载（默认）/ structured = v0.3 字段化编辑（预览）
  const [mode, setMode] = useState<'mount' | 'structured'>('mount')

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>规则编辑</Title>
        <Text type="secondary">
          MVP 通过上传 / 粘贴整文件 rules.yml 挂载告警 / 记录规则（不绕过 M09：保存 / 启停 / 删除后由配置中心生成
          rules.yml → 人工确认 → 下发）；v0.3 升级为字段化编辑（PromQL 校验 + 指标预览）。
        </Text>
      </div>
      <Card className="page-card">
        <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
          <Col>
            <Segmented
              value={mode}
              onChange={(v) => setMode(v as 'mount' | 'structured')}
              options={[
                { label: '文件挂载（MVP）', value: 'mount' },
                { label: '字段化编辑（v0.3 预览）', value: 'structured' },
              ]}
            />
          </Col>
          <Col>
            <ReviewNote title="规则内容形态（PRD 5.5 / 3.1 / 3.2）">
              MVP 默认 <Text code>content_mode=yaml_passthrough</Text>——规则经「规则编辑」页上传 / 粘贴整文件
              rules.yml 落库 MonitoringRule（rule_content），保存 / 启停 / 删除即触发 M09 变更检测 → 生成 rules.yml →
              变更单人工确认 → 下发，回写 change_status（与采集 Job 同源同机制）；v0.3 升级为{' '}
              <Text code>content_mode=structured</Text> 逐条字段化编辑（expr / for / labels / annotations）。
            </ReviewNote>
          </Col>
        </Row>
        {mode === 'mount' ? <FileMountView /> : <StructuredEditView />}
      </Card>
    </MainLayout>
  )
}

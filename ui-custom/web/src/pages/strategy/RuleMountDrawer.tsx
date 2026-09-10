import { useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Drawer, Form, Input, Select, Space, Typography, Upload, message } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { monitoringRuleApi } from '../../api/monitoringRules'
import type { JobRefIssue } from '../../api/monitoringRules'
import { isApiError } from '../../api/client'
import type { ResourceCategory } from '../../types/resource'
import type { MonitorType, MonitoringRule } from '../../types/strategy'
import { CATEGORY_MAP, MONITOR_TYPE_CASCADE, MONITOR_TYPE_MAP } from './strategyConstants'
import { validateYamlClient } from './rulesYaml'
import { triggerConfigDraftsForAllDomains } from '../config-center/preview/triggerConfigDraft'

const { TextArea } = Input

interface RuleMountDrawerProps {
  open: boolean
  onCancel: () => void
  /** 挂载/编辑成功后回刷规则列表 */
  onSuccess: () => void
  /** 编辑目标规则；非空进入编辑模式（回显并走 update，不改变启停状态） */
  editingRule?: MonitoringRule | null
}

/** 规则文件挂载/编辑输入 */
interface MountFormValues {
  name?: string
  /** 资源类别（级联辅助，不入库；提交载荷仅 monitor_type） */
  resource_category?: ResourceCategory
  monitor_type?: MonitorType
  rule_content: string
}

/** 由监控对象类型反推资源类别（编辑回显级联选择器用） */
function categoryOfType(t?: string): ResourceCategory | undefined {
  if (!t) return undefined
  return MONITOR_TYPE_CASCADE.find((g) => g.types.includes(t as MonitorType))?.category
}

/**
 * 规则挂载 / 编辑抽屉（Module_01 §3.1/§5.5/§6.2.4/§11.1，F6）。
 * 上传 / 粘贴 rules.yml（content_mode=yaml_passthrough），提交前 YAML 预检（validate-yaml），
 * YAML 非法以 Alert 提示并保留内容；保存成功同步触发变更单生成（全局 scope 全量网域）。
 * - 新增模式：创建默认启用（enabled: true）；
 * - 编辑模式：回显已有规则，提交走 update（不携带 enabled，启停由列表操作独立负责）；
 * - 保存成功后同步触发全部已纳管网域的变更单生成（规则为全局 scope），提示变更单号并可点击跳转。
 */
export function RuleMountDrawer({ open, onCancel, onSuccess, editingRule }: RuleMountDrawerProps) {
  const navigate = useNavigate()
  const [form] = Form.useForm<MountFormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [jobRefIssues, setJobRefIssues] = useState<JobRefIssue[]>([])
  const [saveDone, setSaveDone] = useState(false)
  // 决策 67-2 逃生门：存在 error 级 job 引用时默认阻断提交，勾选后显式覆盖放行（降级留痕）
  const [ackJobRefErrors, setAckJobRefErrors] = useState(false)
  // 后端兜底门禁（errorType=job_ref_unresolved）返回的拒绝说明；前端预检不可用
  //（本地 YAML 回落）时用户仍能在此看到原因并使用逃生门重试
  const [jobRefGateMessage, setJobRefGateMessage] = useState<string | null>(null)
  const isEdit = Boolean(editingRule)
  // error 级（存活类缺 job）为阻断项；warning 级仅提示
  const blockingJobRefErrors = jobRefIssues.filter((it) => it.severity === 'error')
  const hasBlockingJobRefErrors = blockingJobRefErrors.length > 0
  // job 引用面板：有明细（前端预检）或有后端兜底拒绝说明时展示
  const showJobRefPanel = jobRefIssues.length > 0 || jobRefGateMessage !== null
  // 面板是否为「阻断态」（error）：保存成功后降级为 warning 提示
  const jobRefBlocked = !saveDone && (hasBlockingJobRefErrors || jobRefGateMessage !== null)
  // 逃生门仅在阻断态且尚未保存时提供
  const showJobRefEscapeHatch = jobRefBlocked

  // 资源类别 → 监控对象类型两级级联（对齐 MappingDrawer/ScrapeJobFormDrawer F1-8）：
  // 已选类别时类型候选按类别收敛；未选类别时平铺全部类型（monitor_type 可空，类别仅作辅助）。
  const resourceCategory = Form.useWatch('resource_category', form)
  const monitorTypeOptions = resourceCategory
    ? MONITOR_TYPE_CASCADE.find((g) => g.category === resourceCategory)?.types ?? []
    : MONITOR_TYPE_CASCADE.flatMap((g) => g.types)

  useEffect(() => {
    if (!open) return
    if (editingRule) {
      // 编辑模式回显（含类别反推）；启停状态不回显/不修改
      form.setFieldsValue({
        name: editingRule.name,
        resource_category: categoryOfType(editingRule.monitor_type),
        monitor_type: editingRule.monitor_type as MonitorType | undefined,
        rule_content: editingRule.rule_content ?? '',
      })
    } else {
      form.resetFields()
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubmitError(null)
    setJobRefIssues([])
    setSaveDone(false)
    setAckJobRefErrors(false)
    setJobRefGateMessage(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingRule])

  const handleSubmit = async () => {
    let values: MountFormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    // 提交前预检：新增与编辑统一走后端 validate-yaml（服务端校验，含决策 66 的
    // job 引用语义校验 job_ref）；网络失败 / 接口异常时回落本地 validateYamlClient
    //（仅 YAML 语法，无 job_ref）并告警提示
    let check: { valid: boolean; error?: string; job_ref?: JobRefIssue[] | null }
    try {
      const res = await monitoringRuleApi.validateYaml(editingRule?.id ?? 0, values.rule_content)
      check = res.data
    } catch (err) {
      console.warn('[RuleMountDrawer] 后端 validate-yaml 校验不可用，回落本地 YAML 校验：', err)
      check = validateYamlClient(values.rule_content)
    }
    const jobRefs = check.job_ref ?? []
    setJobRefIssues(jobRefs)
    if (!check.valid) {
      setSubmitError(check.error ?? 'YAML 校验未通过')
      return
    }
    // 决策 67-2：error 级（存活类缺 job）默认阻断提交；用户勾选逃生门后方可放行，
    // warning 级不阻断。后端 POST/PUT 以同口径兜底（errorType=job_ref_unresolved）。
    if (jobRefs.some((it) => it.severity === 'error') && !ackJobRefErrors) {
      setSubmitError(null)
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    setJobRefGateMessage(null)
    try {
      if (editingRule) {
        await monitoringRuleApi.update(editingRule.id, {
          name: values.name,
          monitor_type: values.monitor_type,
          rule_content: values.rule_content,
          // 逃生门：仅在用户显式确认时上送，后端据 ack=true 放行留痕
          ...(ackJobRefErrors ? { ack_job_ref_errors: true } : {}),
        })
        // 规则为全局 scope，对全部已纳管网域同步触发变更单生成（best-effort）
        void triggerConfigDraftsForAllDomains({ prefix: '规则已更新', onNavigate: () => navigate('/config-preview') })
      } else {
        await monitoringRuleApi.create({
          content_mode: 'yaml_passthrough',
          rule_content: values.rule_content,
          name: values.name,
          monitor_type: values.monitor_type,
          // 创建默认启用（M01 PRD §8，与采集 Job 对齐）；漏传会被后端零值 false 落库成「停用」
          enabled: true,
          // 逃生门：仅在用户显式确认时上送，后端据 ack=true 放行留痕
          ...(ackJobRefErrors ? { ack_job_ref_errors: true } : {}),
        })
        void triggerConfigDraftsForAllDomains({ prefix: '规则已挂载', onNavigate: () => navigate('/config-preview') })
      }
      setSubmitting(false)
      onSuccess()
      if (jobRefs.length === 0) {
        // 干净保存：直接关抽屉
        onCancel()
      } else {
        // 存在规则 job 引用提示（决策 66）：保持抽屉打开，避免「红色提示一闪而过」
        // 无法阅读；用户读完提示后手动关闭，列表已由 onSuccess 刷新。
        setSaveDone(true)
      }
    } catch (err) {
      // 决策 67-2 后端兜底门禁：validate-yaml 不可用（本地回落无 job_ref）时，
      // 提交才暴露 job 引用错误——以专用面板呈现，让用户能勾选逃生门重试，
      // 而不是把球踢回给一个无法自救的普通错误提示。
      if (isApiError(err) && err.errorType === 'job_ref_unresolved') {
        setJobRefGateMessage(err.message)
        setSubmitError(null)
      } else {
        setSubmitError(err instanceof Error ? err.message : '保存失败，请稍后重试')
      }
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      title={isEdit ? '编辑规则' : '挂载规则'}
      open={open}
      onClose={submitting ? undefined : onCancel}
      width={600}
      // forceRender：Drawer 首次打开时内容惰性挂载（rc-drawer 动画期先于父组件
      // useEffect 的 setFieldsValue 完成挂载），导致编辑回显首次为空、二次才出现；
      // forceRender 保证 Form 常驻挂载，首次打开即正确回显（#19 回归修复）。
      forceRender
      footer={
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button onClick={onCancel} disabled={submitting}>
              取消
            </Button>
            <Button type="primary" loading={submitting} disabled={submitting} onClick={handleSubmit}>
              {isEdit ? '保存变更' : '提交生效'}
            </Button>
          </Space>
        </div>
      }
    >
      {submitError && (
        <Alert
          type="error"
          showIcon
          message="YAML 校验未通过"
          description={submitError}
          style={{ marginBottom: 16 }}
        />
      )}
      {showJobRefPanel && (
        <Alert
          // 决策 67-2 分级：error 级阻断时为 error（红），warning 级 / 已保存降级为 warning（黄）
          type={jobRefBlocked ? 'error' : 'warning'}
          showIcon
          message={
            saveDone
              ? hasBlockingJobRefErrors
                ? '已保存（已显式确认），规则 job 引用问题发布前请处理'
                : '已保存，存在规则 job 引用提示（发布前请处理）'
              : jobRefBlocked
                ? '规则 job 引用错误：提交已被阻断'
                : '规则 job 引用提示'
          }
          style={{ marginBottom: 16, borderColor: jobRefBlocked ? '#ffa39e' : '#faad14' }}
          description={
            <div>
              {jobRefIssues.map((it) => (
                <div
                  key={`${it.severity}-${it.referenced_job}-${it.rule_name}`}
                  style={{
                    color: it.severity === 'error' ? '#cf1322' : '#ad6800',
                    marginBottom: 4,
                    fontSize: 13,
                  }}
                >
                  {it.severity === 'error' ? '[错误] ' : '[告警] '}
                  {it.message}
                </div>
              ))}
              {jobRefGateMessage && (
                <div style={{ color: '#cf1322', marginBottom: 4, fontSize: 13 }}>
                  [错误] {jobRefGateMessage}
                </div>
              )}
              <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                {saveDone
                  ? hasBlockingJobRefErrors
                    ? '本次已按显式确认放行保存，可继续编辑或点击「取消」关闭；error 级问题在「配置变更确认」（M09）发布确认前仍会被阻断，请及时补建 Job 或修正规则。'
                    : '本次已保存成功，可继续编辑或点击「取消」关闭；warning 级问题仅提示，不影响发布。'
                  : jobRefBlocked
                    ? '存活类规则（up / absent(up) 等）引用不存在的 job 会导致告警恒触发，因此默认阻断提交。请先创建对应采集 Job 或修正规则；如确认「先挂规则，稍后补建 Job」，可勾选下方确认项后重新提交（M09 发布确认前仍会阻断）。'
                    : '建议先创建对应采集 Job，再挂载规则；warning 级仅提示，不影响本次提交。'}
              </Typography.Text>
              {showJobRefEscapeHatch && (
                <Checkbox
                  data-testid="rule-jobref-ack"
                  checked={ackJobRefErrors}
                  onChange={(e) => setAckJobRefErrors(e.target.checked)}
                  style={{ marginTop: 8 }}
                >
                  <Typography.Text style={{ fontSize: 13 }}>
                    已知晓：先挂规则，稍后补建 Job（勾选后放行本次提交，问题仍留痕并在发布前阻断）
                  </Typography.Text>
                </Checkbox>
              )}
            </div>
          }
        />
      )}
      <Form
        form={form}
        layout="vertical"
        name="rule-mount-form"
        preserve={false}
        onValuesChange={() => {
          setSubmitError(null)
          setJobRefGateMessage(null)
          // 决策 67-2：内容变更后先前的显式确认失效，须重新勾选（防「确认 A 内容、提交 B 内容」）
          setAckJobRefErrors(false)
        }}
      >
        <Form.Item label="规则名称" name="name">
          <Input
            data-testid="rule-name"
            placeholder="例如：生产告警规则（可选）"
            maxLength={64}
          />
        </Form.Item>
        <Form.Item
          label="资源类别"
          name="resource_category"
          extra="可选，用于按 CI 类型组织规则；切换类别会清空已选监控对象类型"
        >
          <Select
            allowClear
            data-testid="rule-resource-category"
            placeholder="全部类别"
            options={MONITOR_TYPE_CASCADE.map((g) => ({ value: g.category, label: CATEGORY_MAP[g.category] }))}
            onChange={() => form.setFieldsValue({ monitor_type: undefined })}
          />
        </Form.Item>
        <Form.Item
          label="监控对象类型"
          name="monitor_type"
          extra="可选；所有启用规则将合并为同一份 rules.yml，组名（group name）须全局唯一"
        >
          <Select
            allowClear
            data-testid="rule-monitor-type"
            placeholder="请选择监控对象类型"
            options={monitorTypeOptions.map((t) => ({ value: t, label: MONITOR_TYPE_MAP[t] }))}
          />
        </Form.Item>
        <Form.Item label="内容形态" extra="当前版本仅支持文件透传（yaml_passthrough）">
          <Typography.Text type="secondary">文件透传</Typography.Text>
        </Form.Item>
        <Form.Item label="上传 / 粘贴 rules.yml" name="rule_content" rules={[{ required: true, message: '请上传或粘贴 rules.yml' }]}>
          <TextArea
            data-testid="rule-content"
            rows={16}
            placeholder={'groups:\n  - name: example\n    rules:\n      - alert: HighErrorRate\n        expr: ...'}
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          />
        </Form.Item>
        <Upload
          accept=".yml,.yaml"
          showUploadList={false}
          beforeUpload={(file) => {
            void file
              .text()
              .then((t) => {
                form.setFieldValue('rule_content', t)
                setSubmitError(null)
              })
              .catch(() => message.error('文件读取失败'))
            return false
          }}
        >
          <Button icon={<InboxOutlined />}>从本地选择 rules.yml</Button>
          <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
            文件内容将填充到文本框，可再编辑后保存
          </Typography.Text>
        </Upload>
      </Form>
    </Drawer>
  )
}

export default RuleMountDrawer
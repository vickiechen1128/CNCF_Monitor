import { useEffect, useState } from 'react'
import { Alert, Button, Drawer, Form, Input, Select, Space, Typography, Upload, message } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import { monitoringRuleApi } from '../../api/monitoringRules'
import type { ResourceCategory } from '../../types/resource'
import type { MonitorType, MonitoringRule } from '../../types/strategy'
import { CATEGORY_MAP, MONITOR_TYPE_CASCADE, MONITOR_TYPE_MAP } from './strategyConstants'
import { validateYamlClient } from './rulesYaml'

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
 * YAML 非法以 Alert 提示并保留内容；保存成功提示 M09 变更引导 + 乐观待下发。
 * - 新增模式：创建默认启用（enabled: true）；
 * - 编辑模式：回显已有规则，提交走 update（不携带 enabled，启停由列表操作独立负责）。
 */
export function RuleMountDrawer({ open, onCancel, onSuccess, editingRule }: RuleMountDrawerProps) {
  const [form] = Form.useForm<MountFormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const isEdit = Boolean(editingRule)

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
    // 重置上次提交错误；仅在抽屉打开 / 编辑目标切换时初始化一次
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubmitError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingRule])

  const handleSubmit = async () => {
    let values: MountFormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    // 提交前 YAML 预检：非法则以 Alert 提示并保持内容
    const check = validateYamlClient(values.rule_content)
    if (!check.valid) {
      setSubmitError(check.error ?? 'YAML 校验未通过')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      if (editingRule) {
        await monitoringRuleApi.update(editingRule.id, {
          name: values.name,
          monitor_type: values.monitor_type,
          rule_content: values.rule_content,
        })
        message.success('规则已更新，变更将由 M09 生成变更单并下发')
      } else {
        await monitoringRuleApi.create({
          content_mode: 'yaml_passthrough',
          rule_content: values.rule_content,
          name: values.name,
          monitor_type: values.monitor_type,
          // 创建默认启用（M01 PRD §8，与采集 Job 对齐）；漏传会被后端零值 false 落库成「停用」
          enabled: true,
        })
        message.success('规则已挂载，变更将由 M09 生成变更单并下发')
      }
      setSubmitting(false)
      onSuccess()
      onCancel()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '保存失败，请稍后重试')
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
      <Form
        form={form}
        layout="vertical"
        name="rule-mount-form"
        preserve={false}
        onValuesChange={() => setSubmitError(null)}
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
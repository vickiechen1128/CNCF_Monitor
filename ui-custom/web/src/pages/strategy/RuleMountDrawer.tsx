import { useState } from 'react'
import { Alert, Button, Drawer, Form, Input, Space, Typography, Upload, message } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import { monitoringRuleApi } from '../../api/monitoringRules'
import { validateYamlClient } from './rulesYaml'

const { TextArea } = Input

interface RuleMountDrawerProps {
  open: boolean
  onCancel: () => void
  /** 挂载成功后回刷规则列表 */
  onSuccess: () => void
}

/** 规则文件挂载输入 */
interface MountFormValues {
  name?: string
  rule_content: string
}

/**
 * 规则挂载抽屉（Module_01 §3.1/§5.5/§6.2.4/§11.1，F6）。
 * 上传 / 粘贴 rules.yml（content_mode=yaml_passthrough），提交前 YAML 预检（validate-yaml），
 * YAML 非法以 Alert 提示并保留内容；保存成功提示 M09 变更引导 + 乐观待下发。
 */
export function RuleMountDrawer({ open, onCancel, onSuccess }: RuleMountDrawerProps) {
  const [form] = Form.useForm<MountFormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

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
      await monitoringRuleApi.create({
        content_mode: 'yaml_passthrough',
        rule_content: values.rule_content,
        name: values.name,
        // 创建默认启用（M01 PRD §8，与采集 Job 对齐）；漏传会被后端零值 false 落库成「停用」
        enabled: true,
      })
      message.success('规则已挂载，变更将由 M09 生成变更单并下发')
      setSubmitting(false)
      onSuccess()
      onCancel()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '挂载失败，请稍后重试')
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      title="挂载规则"
      open={open}
      onClose={submitting ? undefined : onCancel}
      width={600}
      footer={
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button onClick={onCancel} disabled={submitting}>
              取消
            </Button>
            <Button type="primary" loading={submitting} disabled={submitting} onClick={handleSubmit}>
              提交生效
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
/**
 * 告警配置挂载抽屉（upload / paste content + amtool 校验 + 提交 M09 变更单）。
 * 决策 59/60：校验失败不落库，行级错误列表展示，仅校验通过提交留痕并进变更管道。
 */
import { useState } from 'react'
import {
  Alert,
  Button,
  Divider,
  Drawer,
  Input,
  Space,
  Tag,
  Typography,
  Upload,
} from 'antd'
import { CheckCircleOutlined, InboxOutlined, UploadOutlined } from '@ant-design/icons'
import { readValidateErrors } from '../../api/alertmanager'
import type { ValidateErrorItem } from '../../types/alertmanager'
import { partitionValidateErrors, validateSectionLabel, validateSectionColor } from './alertmanagerConstants'

const { Dragger } = Upload
const { Text, Title } = Typography

interface AlertConfigDrawerProps {
  open: boolean
  onClose: () => void
  /** 预填内容（重新挂载历史版本时填入） */
  initialContent?: string
  /** 挂载名称提示（重新挂载时显示版本名） */
  mountName?: string
  /** 提交已校验通过的内容；失败抛出 ApiError 携带行级 detail */
  onSubmit: (content: string) => Promise<void>
}

export function AlertConfigDrawer({ open, onClose, initialContent = '', mountName = '', onSubmit }: AlertConfigDrawerProps) {
  // 由父级通过 key 触发重挂载以重置：每次打开都以 initialContent 作为初始内容。
  const [content, setContent] = useState(initialContent)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<ValidateErrorItem[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [validated, setValidated] = useState(false)

  const onReadFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      setContent(text)
      setError(null)
      setErrors([])
      setValidated(false)
    }
    reader.readAsText(file)
    return false
  }

  const handleChangeText = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value)
    setError(null)
    setErrors([])
    setValidated(false)
  }

  const handleSubmit = async () => {
    if (!content.trim()) {
      setError('配置内容为空，请上传或粘贴 alertmanager.yml')
      return
    }
    setSubmitting(true)
    setError(null)
    setErrors([])
    try {
      await onSubmit(content)
      setSubmitting(false)
      onClose()
    } catch (e) {
      const detail = readValidateErrors(e)
      if (detail?.items) {
        setErrors(detail.items)
        const grouped = partitionValidateErrors(detail.items)
        const total = Object.values(grouped).flat().length
        setError(`${total} 项校验错误，详见下方列表${detail.note ? `：${detail.note}` : ''}`)
      } else {
        setError(e instanceof Error ? e.message : '提交校验失败，请稍后重试')
      }
      setValidated(false)
      setSubmitting(false)
    }
  }

  const groupedErrors = partitionValidateErrors(errors)
  const hasErrors = errors.length > 0

  return (
    <Drawer
      title="挂载 alertmanager.yml"
      width={760}
      open={open}
      onClose={onClose}
      destroyOnClose
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {mountName.startsWith('remount-') && (
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
              padding: '8px 12px',
              background: 'rgba(22,119,255,0.06)',
              border: '1px solid rgba(22,119,255,0.35)',
              borderRadius: 8,
              fontSize: 13,
            }}
          >
            <div>
              <Text strong>{`正在重新挂载历史版本 ${mountName.replace('remount-', '')} 的内容`}</Text>
              <div style={{ marginTop: 2, color: 'rgba(0,0,0,0.65)' }}>
                历史版本回滚即重新挂载该版本内容：可在此基础上修改，校验通过后重新提交变更单，确认后下发生效。
              </div>
            </div>
          </div>
        )}

        <Dragger
          accept=".yml,.yaml"
          showUploadList={false}
          beforeUpload={onReadFile}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">点击或拖拽 alertmanager.yml 到此处上传</p>
          <p className="ant-upload-hint">也可在下文粘贴框中手动粘贴整份配置内容</p>
        </Dragger>

        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Text strong>配置内容</Text>
          <Input.TextArea
            value={content}
            onChange={handleChangeText}
            rows={18}
            spellCheck={false}
            placeholder="# 在此粘贴 alertmanager.yml 完整内容"
            style={{
              width: '100%',
              fontFamily: 'SFMono-Regular, Consolas, Menlo, monospace',
              fontSize: 13,
              lineHeight: 1.6,
              padding: 12,
              borderRadius: 8,
            }}
          />
        </Space>

        <Space wrap>
          <Button
            icon={<CheckCircleOutlined />}
            onClick={() => {
              if (!content.trim()) {
                setError('配置内容为空，请上传或粘贴 alertmanager.yml')
                setValidated(false)
                return
              }
              setValidated(true)
              setError(null)
              setErrors([])
              // 前端仅做大小格式基础校验，核心校验由服务端 amtool 执行
              if (content.length > 1024 * 100) {
                setError(`配置内容过大（${(content.length / 1024 / 1024).toFixed(2)} MB > 100KB），请拆分后提交`)
                setValidated(false)
              } else {
                setError(null)
              }
            }}
            loading={submitting}
          >
            前置校验（服务端 amtool）
          </Button>
          <Button
            type="primary"
            icon={<UploadOutlined />}
            onClick={handleSubmit}
            loading={submitting}
            disabled={!validated || hasErrors}
          >
            提交并进入变更确认
          </Button>
        </Space>

        {error && <Alert type="error" showIcon message="配置校验失败" description={error} />}

        {validated && !hasErrors && !error && (
          <Alert
            type="success"
            showIcon
            message="前置校验通过"
            description="YAML 格式大小校验通过，提交后由服务端执行 amtool 等价校验并进入 M09 变更确认流程，人工确认后下发生效。"
          />
        )}

        {hasErrors && Object.keys(groupedErrors).map((section) => {
          const sectionErrors = groupedErrors[section as keyof typeof groupedErrors]
          if (sectionErrors.length === 0) return null
          return (
            <div key={section}>
              <Divider style={{ margin: '8px 0' }} />
              <Title level={5} style={{ fontSize: 14, margin: '0 0 8px 0' }}>
                <Tag color={validateSectionColor[section as keyof typeof validateSectionColor]}>
                  {validateSectionLabel[section as keyof typeof validateSectionLabel]}
                </Tag>
                ({sectionErrors.length})
              </Title>
              {sectionErrors.map((err, idx) => (
                <div key={idx} style={{ marginBottom: 4, fontSize: 13 }}>
                  <Text code style={{ marginRight: 8 }}>{err.file}{err.line > 0 ? `:${err.line}` : ''}</Text>
                  {err.message}
                </div>
              ))}
            </div>
          )
        })}
      </Space>
    </Drawer>
  )
}
import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Modal,
  Radio,
  Row,
  Space,
  Table,
  Typography,
  Upload,
  message,
} from 'antd'
import type { UploadFile } from 'antd'
import { UploadOutlined, WarningOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { TABLE_SCROLL_X } from '../../components/tablePresets'
import { EllipsisText } from '../../components/EllipsisText'
import { resourceApi } from '../../api/resources'
import type { ImportError, ImportMode, ImportResult, ResourceCategory } from '../../types/resource'
import { triggerBlobDownload } from '../../utils/triggerBlobDownload'
import { useSkin } from '../../skinContext'

const { Text } = Typography

/** 资源类别展示名（对齐原型 RESOURCE_TYPE_MAP / ResourcesPage） */
const RESOURCE_TYPE_MAP: Record<ResourceCategory, string> = {
  host: '主机',
  database: '数据库',
  middleware: '中间件',
  application: '应用',
  generic_target: '通用目标',
}

/** 导入模式说明（§6.1 / §5.16.2，create_only 默认；upsert 按判重键覆盖更新）。文案经 F-9 用户评审改为场景化人话，标签与后端 mode 枚举对应，默认 create_only */
const MODE_OPTIONS: { value: ImportMode; label: string; hint: string }[] = [
  { value: 'create_only', label: '仅新增', hint: '已存在的行会报错跳过，不会改动现有数据（适合首次批量建档）' },
  { value: 'upsert', label: '新增或更新', hint: '已存在的行会用文件内容覆盖更新（适合整体刷新）' },
]

interface ImportModalProps {
  open: boolean
  /** 当前资源类型 Tab，联动模板下载与导入（§5.16.1 固定列模板按类型） */
  category: ResourceCategory
  onCancel: () => void
  /** 导入成功后回刷资源列表（ResourcesPage 传入 reload） */
  onSuccess?: () => void
}

/**
 * 待登记清单判定（决策 97）：业务/应用未登记且未在声明 sheet 申报时，后端 reason 含
 * 「未登记」且指向业务/应用（网域未登记文案不含业务/应用字样，不命中），错误行渲染可执行指引。
 */
function isPendingRegistrationReason(reason?: string): boolean {
  return !!reason && reason.includes('未登记') && /业务|应用/.test(reason)
}

/**
 * Excel 导入弹窗（Module_07 §5.16/§6.1/§11.2，L3 任务 T07-F5 / T07-97-F1）。
 * - 文件上传 + 导入模式选择（默认 create_only）+ 提交 loading 防重复；
 * - 上传区下方提供次级「下载当前资源类型模板」文字链接，直接触发下载（复用 handleDownloadTemplate）；
 * - 导入结果展示 total/success/updated/failed 统计 + 错误行 Table（行号/字段/值/原因，§5.16.3）；
 * - 错误文案透传后端引导；reason 命中待登记清单（业务/应用未登记且未声明）时高亮可执行指引。
 * 参见 docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md
 */
export function ImportModal({ open, category, onCancel, onSuccess }: ImportModalProps) {
  const { tokens } = useSkin()
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [mode, setMode] = useState<ImportMode>('create_only')
  const [downloading, setDownloading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // 打开时重置为待导入状态（条件挂载时每次打开即全新实例，此处兜底持久挂载场景）
  useEffect(() => {
    if (!open) return
    // 打开弹窗时同步重置待导入状态；条件挂载场景每次打开即全新实例，此处兜底持久挂载
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFileList([])
    setMode('create_only')
    setResult(null)
    setSubmitError(null)
  }, [open])

  /** 下载当前资源类型的 Excel 模板（浏览器触发下载） */
  const handleDownloadTemplate = async () => {
    setDownloading(true)
    try {
      const blob = await resourceApi.template(category)
      triggerBlobDownload(blob, `${category}_template.xlsx`)
      message.success('模板下载成功')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '模板下载失败，请稍后重试')
    } finally {
      setDownloading(false)
    }
  }

  /** 提交导入（FormData 组装在 resourceApi.importExcel，组件仅传 file + mode） */
  const handleSubmit = async () => {
    const file = fileList[0]?.originFileObj
    if (!file) {
      message.warning('请先选择要导入的 Excel 文件')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await resourceApi.importExcel(category, file as File, mode)
      setResult(res.data)
      message.success('导入完成')
      onSuccess?.()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '导入失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  /** 导入错误行表格列（§5.16.3：行号/字段/值/原因；原因透传后端引导文案） */
  const errorColumns: ColumnsType<ImportError> = [
    { title: '行号', dataIndex: 'row', key: 'row', width: 70 },
    { title: '字段', dataIndex: 'field', key: 'field', width: 150 },
    {
      title: '值',
      dataIndex: 'value',
      key: 'value',
      width: 200,
      render: (v?: string) => (v ? <Text code style={{ fontSize: 12 }}>{v}</Text> : '(空)'),
    },
    {
      title: '原因',
      dataIndex: 'reason',
      key: 'reason',
      render: (v?: string) => {
        if (!v) return '-'
        // 命中待登记清单（业务/应用未登记且未声明，决策 97）：warning 高亮 + 图标，
        // 可执行指引在后端 reason 文案内（「请到『业务管理』/『应用管理』页登记，或在文件声明 sheet 补充后重新导入」），前后端一致
        if (isPendingRegistrationReason(v)) {
          return (
            <Space size={4}>
              <WarningOutlined style={{ color: tokens.colorWarning }} />
              <EllipsisText maxWidth={300} type="warning">{v}</EllipsisText>
            </Space>
          )
        }
        return <EllipsisText maxWidth={320}>{v}</EllipsisText>
      },
    },
  ]

  /** 待导入表单态（上传 + 模式选择） */
  const renderForm = () => (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Excel 导入说明"
        description={
          <Text style={{ fontSize: 13 }}>
            导入按行增量更新，不会删除已存在的资源；如需批量下线，请将目标行状态改为「已停止」后导入。
          </Text>
        }
      />
      <Text strong style={{ display: 'block', marginBottom: 8 }}>
        1. 上传文件
      </Text>
      <Upload
        accept=".xlsx"
        maxCount={1}
        fileList={fileList}
        beforeUpload={() => false}
        onChange={({ fileList: fl }) => setFileList(fl)}
        onRemove={() => setFileList([])}
      >
        <Button icon={<UploadOutlined />} disabled={submitting}>
          选择 Excel 文件
        </Button>
      </Upload>
      <Text style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
        <Text strong>仅支持 .xlsx 文件，每次选择一个文件</Text>
        <Text type="secondary">（.xls / .csv 暂不支持）；请按模板列头填写 Excel 后上传。</Text>
      </Text>
      {/* F-8-a：次级文字链接直触发下载（复用 handleDownloadTemplate），不嵌套弹窗 */}
      <Button
        type="link"
        size="small"
        style={{ padding: 0, height: 'auto', marginBottom: 20 }}
        loading={downloading}
        onClick={handleDownloadTemplate}
      >
        没有模板？下载当前资源类型模板
      </Button>
      <Text strong style={{ display: 'block', marginBottom: 8 }}>
        2. 选择导入模式
      </Text>
      <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
        导入时，文件里已有的资源（按 IP / 服务名等唯一标识识别）怎么处理？
      </Text>
      <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
        <Space direction="vertical">
          {MODE_OPTIONS.map((opt) => (
            <Radio key={opt.value} value={opt.value}>
              <Text>{opt.label}</Text>
              <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                {opt.hint}
              </Text>
            </Radio>
          ))}
        </Space>
      </Radio.Group>
      {submitError && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 16 }}
          message="导入失败"
          description={submitError}
        />
      )}
    </>
  )

  /** 导入结果态（统计 + 错误行表，§5.16.3；create_only 无 updated 显示「-」） */
  const renderResult = () => {
    if (!result) return null
    return (
      <>
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
          message="导入完成"
          description="导入按行增量更新，不会删除已存在的资源；失败行未写入，请修正后重新导入。"
        />
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={6}>
            <Card size="small">
              <Text type="secondary">总数</Text>
              <div>
                <Text strong style={{ fontSize: 20 }}>
                  {result.total}
                </Text>
              </div>
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Text type="secondary">成功</Text>
              <div>
                <Text strong style={{ fontSize: 20, color: tokens.colorSuccess }}>
                  {result.success}
                </Text>
              </div>
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Text type="secondary">更新</Text>
              <div>
                <Text strong style={{ fontSize: 20, color: tokens.colorInfo }}>
                  {result.updated ?? '-'}
                </Text>
              </div>
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Text type="secondary">失败</Text>
              <div>
                <Text strong style={{ fontSize: 20, color: result.failed > 0 ? tokens.colorError : tokens.colorTextTertiary }}>
                  {result.failed}
                </Text>
              </div>
            </Card>
          </Col>
        </Row>
        <Table<ImportError>
          size="small"
          rowKey={(r) => `${r.row}-${r.field}`}
          dataSource={result.errors}
          columns={errorColumns}
          pagination={false}
          scroll={TABLE_SCROLL_X}
          locale={{ emptyText: '导入无错误' }}
        />
      </>
    )
  }

  return (
    <Modal
      title={
        result
          ? `Excel 导入结果 - ${RESOURCE_TYPE_MAP[category]}`
          : `Excel 导入 - ${RESOURCE_TYPE_MAP[category]}`
      }
      open={open}
      onCancel={submitting ? undefined : onCancel}
      width={760}
      footer={
        result ? (
          <Space>
            <Button
              onClick={() => {
                setResult(null)
                setFileList([])
                setSubmitError(null)
              }}
            >
              再次导入
            </Button>
            <Button type="primary" onClick={onCancel}>
              关闭
            </Button>
          </Space>
        ) : (
          <Space>
            <Button onClick={onCancel} disabled={submitting}>
              取消
            </Button>
            <Button
              type="primary"
              icon={<UploadOutlined />}
              loading={submitting}
              disabled={submitting}
              onClick={handleSubmit}
            >
              开始导入
            </Button>
          </Space>
        )
      }
    >
      {result ? renderResult() : renderForm()}
    </Modal>
  )
}

export default ImportModal

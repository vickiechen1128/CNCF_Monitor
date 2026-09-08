import { useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Drawer,
  Descriptions,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd'
import {
  ArrowRightOutlined,
  CheckCircleOutlined,
  EyeOutlined,
  HistoryOutlined,
  InboxOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  currentAlertmanagerYaml,
  mockConfigVersions,
  type AlertmanagerConfigVersion,
  type ChangeStatus,
} from '../mocks/module-08'

const { Dragger } = Upload
const { Title, Text } = Typography

// {v1.7} 决策 60：跨模块跳转统一收拢为常量，跳 M09「配置变更确认」页做人工确认（落在 #/config-preview，非网域纳管页）
// {v1.7} 提示分区规范：用户可见文案不含决策编号 / PRD 引用；实现依据见 PRD 5.1 与 design-decisions 决策 59/60
const MODULE_LINKS = {
  module09: '../module-09/dist/index.html#/config-preview',
} as const

function shortChecksum(checksum: string) {
  return checksum.length > 16 ? `${checksum.slice(0, 8)}...${checksum.slice(-8)}` : checksum
}

/** {v1.7} 决策 59：amtool check-config 等价校验（原型本地模拟，仅示意行级错误定位） */
function checkAlertmanagerYaml(content: string): { ok: boolean; errors: string[] } {
  if (!content || !content.trim()) {
    return { ok: false, errors: ['配置内容为空，请上传或粘贴 alertmanager.yml'] }
  }
  // 原型演示：路由映射到不存在的接收人时给出可读行级错误（含行号定位）
  const definedNames = new Set([...content.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]))
  for (const m of content.matchAll(/receiver:\s*'([^']+)'/g)) {
    const r = m[1]
    if (!definedNames.has(r)) {
      // 行号 = 命中位置前的换行数 + 1
      const lineNo = content.slice(0, m.index).split('\n').length
      return {
        ok: false,
        errors: [`amtool check-config 校验失败：第 ${lineNo} 行：route/receivers 引用的 receiver "${r}" 未定义`],
      }
    }
  }
  const hasRoute = /\n\s*route:/.test(content)
  const hasReceivers = /\n\s*receivers:/.test(content)
  if (!hasRoute || !hasReceivers) {
    return { ok: false, errors: ['amtool check-config 校验失败：缺少顶层 route 或 receivers 段'] }
  }
  return { ok: true, errors: [] }
}

/** {v1.7} 决策 60：M09 变更单回写下发状态 → 用户可读展示 */
function renderChangeStatus(status: ChangeStatus | undefined, onGotoM09: () => void) {
  if (status === 'pending') {
    return (
      <Tooltip title="存在待确认的变更单，点击前往配置中心「配置变更确认」页确认后下发">
        <Button
          type="link"
          size="small"
          icon={<ArrowRightOutlined />}
          style={{ padding: 0, height: 'auto', fontSize: 13 }}
          onClick={onGotoM09}
        >
          待确认
        </Button>
      </Tooltip>
    )
  }
  if (status === 'confirmed') return <Tag color="processing">已确认待下发</Tag>
  if (status === 'deployed') return <Tag color="success">已下发</Tag>
  if (status === 'rejected') return <Tag color="error">已拒绝</Tag>
  return <Text type="secondary">未进入变更单</Text>
}

export default function ConfigPage() {
  const { message } = App.useApp()
  const [versions, setVersions] = useState<AlertmanagerConfigVersion[]>(mockConfigVersions)
  const [viewing, setViewing] = useState<AlertmanagerConfigVersion | null>(null)
  const [mountOpen, setMountOpen] = useState(false)
  const [mountName, setMountName] = useState('')
  const [mountContent, setMountContent] = useState('')
  const [mountError, setMountError] = useState<string | null>(null)
  const [mountChecked, setMountChecked] = useState(false)

  const latest = useMemo(
    () => versions.filter((v) => v.status === 'applied').sort((a, b) => b.applied_at.localeCompare(a.applied_at))[0],
    [versions]
  )
  const hasPending = versions.some((v) => v.change_status === 'pending')

  const gotoM09 = () => window.open(MODULE_LINKS.module09, '_blank')

  /** {v1.7} 决策 60：提交挂载 → 生成 M09 变更单（管理域 default scope）→ 引导跳转配置变更确认 */
  const showChangePendingToast = (baseMsg: string) => {
    message.success({
      content: `${baseMsg}：已提交 M09 变更单（管理域），需在配置中心确认后下发生效（点击本条前往配置变更确认）`,
      onClick: gotoM09,
    })
  }

  /** {v1.7} 决策 59：读取本地 alertmanager.yml 文件内容并自动带出展示名 */
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

  /** {v1.7} 决策 59：触发 amtool check-config 等价校验 */
  const handleValidate = () => {
    const result = checkAlertmanagerYaml(mountContent)
    if (!result.ok) {
      setMountError(result.errors.join('；'))
      setMountChecked(false)
      return
    }
    setMountError(null)
    setMountChecked(true)
    message.success('amtool check-config 校验通过：YAML 语法与 route/receiver 引用闭合')
  }

  /** {v1.7} 决策 59/60：校验通过后提交挂载 → 内容侧留痕 + 进入 M09 变更单 */
  const handleSubmitMount = () => {
    if (!mountChecked) {
      message.warning('请先执行校验（amtool check-config）通过后再提交')
      return
    }
    const created: AlertmanagerConfigVersion = {
      id: `acv-${Date.now()}`,
      version: `v${versions.length + 1}`,
      content: mountContent,
      checksum: '7e1b4d9c2a6f8e0d3b9a1c5e7f2d4b8c',
      applied_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      applied_by: '张伟（运维）',
      status: 'applied',
      change_status: 'pending',
    }
    setVersions((prev) => [created, ...prev])
    setMountOpen(false)
    setMountName('')
    setMountContent('')
    setMountError(null)
    setMountChecked(false)
    showChangePendingToast('配置已挂载并提交')
  }

  /** {v1.7} 决策 59：历史版本回滚 = 重新挂载该版本内容（PRD §9.1 P0）——把历史版本内容填入挂载抽屉，重新走校验 + 提交流程 */
  const handleRemount = (record: AlertmanagerConfigVersion) => {
    setViewing(null)
    setMountName(`remount-${record.version}`)
    setMountContent(record.content)
    setMountError(null)
    setMountChecked(false)
    setMountOpen(true)
  }

  const columns = [
    {
      title: '版本',
      dataIndex: 'version',
      key: 'version',
      width: 90,
      render: (version: string) => <Text code>{version}</Text>,
    },
    {
      title: '留痕状态',
      dataIndex: 'status',
      key: 'status',
      width: 140,
      render: (_status: AlertmanagerConfigVersion['status'], record: AlertmanagerConfigVersion) =>
        record.id === latest?.id ? <Tag color="success">当前内容</Tag> : <Tag>已留痕</Tag>,
    },
    {
      title: '下发状态（M09 回写）',
      dataIndex: 'change_status',
      key: 'change_status',
      width: 150,
      render: (cs: ChangeStatus | undefined) => renderChangeStatus(cs, gotoM09),
    },
    { title: '提交时间', dataIndex: 'applied_at', key: 'applied_at', width: 170 },
    { title: '操作人', dataIndex: 'applied_by', key: 'applied_by', width: 130 },
    {
      title: '校验和（sha256）',
      dataIndex: 'checksum',
      key: 'checksum',
      render: (checksum: string) => <Text code style={{ fontSize: 12 }}>{shortChecksum(checksum)}</Text>,
    },
    {
      title: '操作',
      key: 'action',
      width: 90,
      render: (_: unknown, record: AlertmanagerConfigVersion) => (
        <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => setViewing(record)}>
          查看
        </Button>
      ),
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4} style={{ margin: 0 }}>
          Alertmanager 配置管理
        </Title>
        <Text type="secondary">
          通过文件挂载整份 `alertmanager.yml`，校验通过后提交配置中心（M09）变更单，确认后统一下发生效
        </Text>
      </div>

      {/* {v1.7} 决策 60：清晰呈现「文件挂载 → M09 变更确认 → reload」路径，去除 v1.3「直接 reload」旧口径 */}
      <div
        style={{
          marginBottom: 16,
          padding: 10,
          borderRadius: 6,
          background: 'rgba(14, 205, 235, 0.08)',
          border: '1px solid rgba(14, 205, 235, 0.25)',
          fontSize: 12,
          color: 'rgba(0,0,0,0.72)',
        }}
      >
        <Text strong>配置变更路径：</Text>
        接收人 / 路由 / 抑制策略以<Text strong>文件挂载</Text>方式提交：整文件上传或粘贴
        <Text code>alertmanager.yml</Text> → <Text strong>amtool check-config</Text> 校验 → 提交{' '}
        <Text strong>配置中心（M09）变更单</Text>（管理域 scope）→ 人工确认后由配置中心写中心
        Alertmanager 配置路径并触发 reload。`rules.yml` 的生成与下发仍由 Module_09 负责，本模块不生成。
      </div>

      <Card
        className="page-card"
        title={
          <Space size={8}>
            当前生效配置
            {latest && (
              <Space size={6}>
                <Tag color="processing">
                  v{latest.version}（{latest.applied_at} 由 {latest.applied_by} 提交）
                </Tag>
                {latest.change_status === 'pending' && <Tag color="warning">变更待确认</Tag>}
                {latest.change_status === 'deployed' && (
                  <Tag color="success" icon={<CheckCircleOutlined />}>
                    已下发生效
                  </Tag>
                )}
              </Space>
            )}
          </Space>
        }
        extra={
          <Button
            type="primary"
            icon={<UploadOutlined />}
            onClick={() => {
              setMountContent(currentAlertmanagerYaml)
              setMountChecked(false)
              setMountError(null)
              setMountOpen(true)
            }}
          >
            挂载新配置
          </Button>
        }
        style={{ marginBottom: 16 }}
      >
        <pre className="yaml-preview" style={{ margin: 0, maxHeight: 420, overflow: 'auto' }}>
          {latest?.content ?? currentAlertmanagerYaml}
        </pre>
        <div
          style={{
            marginTop: 12,
            padding: 10,
            borderRadius: 6,
            background: 'rgba(14, 205, 235, 0.08)',
            border: '1px solid rgba(14, 205, 235, 0.25)',
            fontSize: 12,
            color: 'rgba(0,0,0,0.72)',
          }}
        >
          <Text strong>变更生效路径：</Text>
          挂载提交后进入配置中心（M09）变更单：人工确认后由 M09 写中心 Alertmanager 配置路径并触发 reload，
          change_status 回写本页「下发状态」。校验失败不落库、仅返回行级错误，不进入变更单（决策 59/60）。
        </div>
      </Card>

      <Card
        className="page-card"
        title={
          <Space size={8}>
            <HistoryOutlined />
            配置版本历史
            <Tag>内容侧留痕</Tag>
          </Space>
        }
        extra={
          hasPending ? (
            <Button type="link" size="small" icon={<ArrowRightOutlined />} onClick={gotoM09}>
              前往配置变更确认（M09）
            </Button>
          ) : undefined
        }
      >
        <Table<AlertmanagerConfigVersion>
          rowKey="id"
          dataSource={versions}
          columns={columns}
          pagination={false}
          size="middle"
        />
      </Card>

      {/* {v1.7} 决策 59：文件挂载抽屉（上传 / 粘贴整份 alertmanager.yml + amtool 校验 + 提交 M09） */}
      <Drawer
        title="挂载 alertmanager.yml"
        width={760}
        open={mountOpen}
        onClose={() => setMountOpen(false)}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {/* 回滚提示用轻量 banner（非 Alert），避免用户主区 Alert 超阈（结构约束 ≤2） */}
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
            beforeUpload={(file) => {
              onReadFile(file)
              return false
            }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽 `alertmanager.yml` 到此处上传</p>
            <p className="ant-upload-hint">也可在下文粘贴框中手动粘贴整份配置内容</p>
          </Dragger>

          <Space style={{ width: '100%' }} direction="vertical" size={4}>
            <Text strong>配置内容</Text>
            <textarea
              value={mountContent}
              onChange={(e) => {
                setMountContent(e.target.value)
                setMountChecked(false)
                setMountError(null)
              }}
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
                border: '1px solid #D9DDE3',
                outline: 'none',
              }}
            />
          </Space>

          <Space wrap>
            <Button icon={<CheckCircleOutlined />} onClick={handleValidate}>
              校验配置（amtool check-config）
            </Button>
            <Button type="primary" icon={<UploadOutlined />} onClick={handleSubmitMount}>
              提交并进入变更确认
            </Button>
          </Space>

          {mountError && (
            <Alert type="error" showIcon message="配置校验失败" description={mountError} />
          )}
          {mountChecked && !mountError && (
            <Alert
              type="success"
              showIcon
              message="校验通过"
              description="YAML 语法与 route/receiver 引用闭合校验通过。提交后进入配置中心（M09）变更单，人工确认后下发生效。"
            />
          )}
        </Space>
      </Drawer>

      <Drawer
        title={`配置版本 ${viewing ? `v${viewing.version}` : ''} 内容`}
        width={760}
        open={viewing !== null}
        onClose={() => setViewing(null)}
        extra={
          viewing && (
            <Tooltip title="历史版本回滚：将该版本内容填入挂载抽屉，重新走校验 + 提交变更单流程">
              <Button icon={<HistoryOutlined />} onClick={() => handleRemount(viewing)}>
                重新挂载此版本
              </Button>
            </Tooltip>
          )
        }
      >
        {viewing && (
          <>
            <Descriptions bordered size="small" column={{ xs: 1, md: 2 }} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="版本">
                <Text code>{viewing.version}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="留痕状态">
                <Tag color="success">已留痕</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="下发状态（M09）">
                {renderChangeStatus(viewing.change_status, gotoM09)}
              </Descriptions.Item>
              <Descriptions.Item label="提交人">{viewing.applied_by}</Descriptions.Item>
              <Descriptions.Item label="提交时间">{viewing.applied_at}</Descriptions.Item>
              <Descriptions.Item label="校验和（sha256）">
                <Text code style={{ fontSize: 12 }}>
                  {viewing.checksum}
                </Text>
              </Descriptions.Item>
            </Descriptions>
            <pre className="yaml-preview" style={{ margin: 0, maxHeight: 520, overflow: 'auto' }}>
              {viewing.content}
            </pre>
          </>
        )}
      </Drawer>
    </MainLayout>
  )
}
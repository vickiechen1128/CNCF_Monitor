/**
 * 告警配置页（文件挂载，决策 59/60）。
 * 能力：上传/粘贴 alertmanager.yml 挂载（校验失败行级报错不落库）；当前生效只读视图；
 * 历史版本列表 + 重新挂载回滚（Modal 二次确认 + 触发重校验）；跨模块跳转 M09 配置变更确认。
 */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Alert,
  App,
  Button,
  Card,
  ConfigProvider,
  Descriptions,
  Drawer,
  Empty,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import config from 'antd/locale/zh_CN'
import { EyeOutlined, HistoryOutlined, UploadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { alertmanagerConfigApi, readValidateErrors } from '../../api/alertmanager'
import { triggerConfigDrafts } from '../config-center/preview/triggerConfigDraft'
import type { AlertmanagerConfigVersionListItem, ValidateErrorItem } from '../../types/alertmanager'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { RuleGuideLink } from '../../components/RuleGuideLink'
import { useAlertConfig } from './useAlertConfig'
import { AlertConfigDrawer } from './AlertConfigDrawer'
import {
  ALERTMANAGER_MIN_SKELETON,
  ALERT_CONFIG_EXEMPT_BLOCKS,
  ALERT_CONFIG_REQUIRED_BLOCKS,
  CONFIG_PREVIEW_PATH,
  CURRENT_USER,
  configStatusColor,
  configStatusLabel,
} from './alertmanagerConstants'
import { shortChecksum } from '../../utils/shortChecksum'
import { MainLayout } from '../../layouts/MainLayout'
import { useSkin } from '../../skinContext'

const { Text } = Typography

export function AlertConfigPage() {
  const { tokens } = useSkin()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { current, versions, total, loading, error, permissionDenied, reload, page, onPageSizeChange, submit, remount } =
    useAlertConfig()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerOpenSeq, setDrawerOpenSeq] = useState(0)
  const [drawerContent, setDrawerContent] = useState('')
  const [drawerName, setDrawerName] = useState('')
  const [detail, setDetail] = useState<AlertmanagerConfigVersionListItem | null>(null)
  const [detailLoaded, setDetailLoaded] = useState<{ id: string; content: string } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [remountErrors, setRemountErrors] = useState<ValidateErrorItem[] | null>(null)
  const [remounting, setRemounting] = useState(false)

  const openMount = (content = '', name = '') => {
    setDrawerOpenSeq((s) => s + 1)
    setDrawerContent(content)
    setDrawerName(name)
    setDrawerOpen(true)
  }

  const handleSubmit = async (content: string) => {
    await submit(content, CURRENT_USER)
    setRemountErrors(null)
    // 决策 60：告警配置仅作用于管理域 default；挂载成功后同步触发变更单生成
    void triggerConfigDrafts(['default'], { prefix: '配置已挂载', onNavigate: () => navigate(CONFIG_PREVIEW_PATH) })
    reload()
  }

  const openVersionDetail = async (record: AlertmanagerConfigVersionListItem) => {
    setDetail(record)
    setDetailLoading(true)
    setDetailLoaded(null)
    try {
      const res = await alertmanagerConfigApi.getVersion(record.id)
      setDetailLoaded({ id: record.id, content: res.data.content })
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载版本内容失败，请稍后重试')
    } finally {
      setDetailLoading(false)
    }
  }

  const handleRemount = (record: AlertmanagerConfigVersionListItem) => {
    Modal.confirm({
      title: `重新挂载本版本（${record.id}）？`,
      content: '将把该历史版本内容再次提交挂载（重新执行 amtool 校验）并进入 M09 变更确认，人工确认后下发生效。',
      okText: '重新挂载',
      cancelText: '取消',
      async onOk() {
        setRemounting(true)
        try {
          await remount(record.id, CURRENT_USER)
          setRemountErrors(null)
          void triggerConfigDrafts(['default'], { prefix: `版本 ${record.id} 已重新挂载`, onNavigate: () => navigate(CONFIG_PREVIEW_PATH) })
          reload()
        } catch (e) {
          const detail = readValidateErrors(e)
          if (detail?.items) {
            setRemountErrors(detail.items)
            message.error('重新挂载校验失败，请在下方错误列表中定位修改后重试')
          } else {
            message.error(e instanceof Error ? e.message : '重新挂载失败，请稍后重试')
          }
          throw e
        } finally {
          setRemounting(false)
        }
      },
    })
  }

  const columns: ColumnsType<AlertmanagerConfigVersionListItem> = [
    {
      title: '版本 ID',
      dataIndex: 'id',
      key: 'id',
      width: 160,
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (_: unknown, r: AlertmanagerConfigVersionListItem) => (
        <Tag color={configStatusColor[r.status]}>{configStatusLabel[r.status]}</Tag>
      ),
    },
    {
      title: '生效时间',
      dataIndex: 'applied_at',
      key: 'applied_at',
      width: 180,
      render: (v?: string) => <Text type="secondary">{v ?? '-'}</Text>,
    },
    {
      title: '应用人',
      dataIndex: 'applied_by',
      key: 'applied_by',
      width: 130,
      render: (v?: string) => <Text>{v ?? '-'}</Text>,
    },
    {
      title: 'M09 变更单',
      dataIndex: 'source_change_no',
      key: 'source_change_no',
      width: 170,
      // 决策 69-③（决策 60 补充块）：变更单号直达 M09 该单详情（?change_no= 深链）。
      // 纯展示层增强——source_change_no 字段既已存在，不引入 change_status 依赖、不新增路由。
      render: (v?: string) =>
        v ? (
          <Link to={`${CONFIG_PREVIEW_PATH}?change_no=${encodeURIComponent(v)}`}>{v}</Link>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '校验和（sha256）',
      dataIndex: 'checksum',
      key: 'checksum',
      render: (v: string) => <Text code style={{ fontSize: 12 }}>{shortChecksum(v)}</Text>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 170,
      fixed: 'right',
      render: (_: unknown, r: AlertmanagerConfigVersionListItem) => (
        <Space size={0}>
          <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => openVersionDetail(r)}>
            查看
          </Button>
          <Button size="small" type="link" icon={<HistoryOutlined />} loading={remounting} onClick={() => handleRemount(r)}>
            重新挂载此版本
          </Button>
        </Space>
      ),
    },
  ]

  if (permissionDenied) {
    return (
      <MainLayout>
        <Card>
          <Empty description="当前账号无此页面查看权限" />
        </Card>
      </MainLayout>
    )
  }

  return (
    <MainLayout>
      <ConfigProvider locale={config}>
        <Card
          title="告警配置"
          extra={
            <Button type="primary" icon={<UploadOutlined />} onClick={() => openMount()}>
              挂载新配置
            </Button>
          }
          style={{ marginBottom: 16 }}
        >
          <Text type="secondary">
            通过文件挂载整份 alertmanager.yml，校验通过后提交配置中心（M09）变更单，确认后统一下发生效
          </Text>
          {/* PL-1（D-1 方案丙）：本页只管「发给谁、怎么收敛」，告警规则（什么情况算告警）在 M01
              「规则编辑」维护——跨模块说明 + 联动入口，导航归属不变。 */}
          <div style={{ marginTop: 8 }}>
            <Text type="secondary">告警规则（什么情况下告警）在「规则编辑」维护，本页只管「告警发给谁、怎么收敛」。 </Text>
            <RuleGuideLink />
          </div>

          {/* PL-2（2026-09-28）：显式化「在这页要写什么」——三块必写 + 两块豁免，口径与服务端
              amtool check-config 一致，不承诺校验器不校验的字段。 */}
          <div style={{ marginTop: 16 }}>
            <Text strong>本页你需要写这三块：</Text>
            <ol style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
              {ALERT_CONFIG_REQUIRED_BLOCKS.map((block) => (
                <li key={block.key} style={{ marginBottom: 4 }}>
                  <Text strong>{block.title}</Text>
                  <Text code style={{ margin: '0 6px' }}>{block.fields}</Text>
                  <Text type="secondary">{block.desc}</Text>
                  {/* A 路线（T08-F14）：receivers 块内容来源改为平台生成，给出「通知渠道」页入口 */}
                  {block.path ? (
                    <Text type="secondary">
                      ，前往<Link to={block.path}>{block.linkText ?? '详情'}</Link>
                    </Text>
                  ) : null}
                </li>
              ))}
            </ol>
            <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
              global 段按需最简即可（如 resolve_timeout）；仅使用邮件渠道时才需补 smtp_* 配置，不列为必写块。
            </Text>
          </div>

          <div style={{ marginTop: 16 }}>
            <Text strong>这两块不用你写（已豁免）：</Text>
            <ul style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
              {ALERT_CONFIG_EXEMPT_BLOCKS.map((block) => (
                <li key={block.key} style={{ marginBottom: 4 }}>
                  <Text strong>{block.title}</Text>
                  <Text type="secondary">
                    ：{block.desc}
                    {block.path ? (
                      <>
                        ，前往<Link to={block.path}>{block.linkText ?? '详情'}</Link>
                      </>
                    ) : null}
                  </Text>
                </li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: 16 }}>
            <Space size={8} style={{ marginBottom: 8 }}>
              <Text strong>最小可运行 alertmanager.yml 骨架</Text>
              <Tag color="processing">已通过 amtool 校验</Tag>
            </Space>
            <pre
              style={{
                margin: 0,
                maxHeight: 320,
                overflow: 'auto',
                background: tokens.colorBgBase,
                padding: 12,
                borderRadius: 8,
                fontSize: 12.5,
              }}
            >
              {ALERTMANAGER_MIN_SKELETON}
            </pre>
            <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
              点「挂载新配置」后可在抽屉里用「插入骨架示例」一键填入；将占位符替换为「通知渠道」页「接收人配置」复制的真实片段即可提交。
            </Text>
          </div>
        </Card>

        {error && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="配置信息加载失败，请稍后重试"
            description={error}
            action={<Button size="small" onClick={reload}>重新加载</Button>}
          />
        )}

        {remountErrors && remountErrors.length > 0 && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="重新挂载校验失败，未保存、未生效，请修改后重试"
            description={
              <div>
                <Text>请在下方定位行级错误：</Text>
                <ul style={{ paddingLeft: 20, margin: '8px 0 0 0' }}>
                  {remountErrors.map((err, idx) => (
                    <li key={idx} style={{ marginBottom: 4 }}>
                      <Tag style={{ marginInlineEnd: 8 }}>
                        {err.file}
                        {err.line > 0 ? `:${err.line}` : ''}
                      </Tag>
                      {err.message}
                    </li>
                  ))}
                </ul>
              </div>
            }
            action={<Button size="small" onClick={() => setRemountErrors(null)}>关闭</Button>}
          />
        )}

        <Card
          title={
            <Space size={8}>
              当前生效配置
              {current && current.applied_at && (
                <Tag color="processing">生效于 {current.applied_at} 由 {current.applied_by ?? '-'} 提交</Tag>
              )}
            </Space>
          }
          style={{ marginBottom: 16 }}
        >
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Text type="secondary">加载中…</Text>
            </div>
          ) : current && current.content ? (
            <>
              <Descriptions size="small" column={{ xs: 1, md: 2 }} style={{ marginBottom: 12 }}>
                <Descriptions.Item label="版本 ID">
                  <Text code>{current.id}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="状态">
                  <Tag color={configStatusColor[current.status]}>{configStatusLabel[current.status]}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="生效时间">{current.applied_at ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="应用人">{current.applied_by ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="M09 变更单">
                  {current.source_change_no ? <Text code>{current.source_change_no}</Text> : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="校验和（sha256）">
                  <Text code style={{ fontSize: 12 }}>{shortChecksum(current.checksum)}</Text>
                </Descriptions.Item>
              </Descriptions>
              <Space size={8} style={{ marginBottom: 8 }}>
                <Text strong>完整配置</Text>
                <Tag>只读</Tag>
              </Space>
              <pre
                style={{ margin: 0, maxHeight: 420, overflow: 'auto', background: tokens.colorBgBase, padding: 12, borderRadius: 8, fontSize: 13 }}
              >
                {current.content}
              </pre>
            </>
          ) : (
            <Empty description="当前无生效配置，点击「挂载新配置」上传或粘贴 alertmanager.yml" />
          )}
        </Card>

        <Card
          title={
            <Space size={8}>
              <HistoryOutlined />
              配置版本历史
              <Tag>内容侧留痕</Tag>
            </Space>
          }
        >
          <Table<AlertmanagerConfigVersionListItem>
            rowKey="id"
            dataSource={versions}
            loading={loading}
            columns={columns}
            scroll={TABLE_SCROLL_X}
            pagination={{
              ...TABLE_PAGINATION,
              current: page,
              total,
              onChange: (p, pz) => onPageSizeChange(p, pz),
            }}
          />
        </Card>

        <AlertConfigDrawer
          key={`${drawerOpenSeq}-${drawerName}`}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          initialContent={drawerContent}
          mountName={drawerName}
          onSubmit={handleSubmit}
        />

        <Drawer
          title={detail ? `配置版本 ${detail.id} 内容` : '配置版本内容'}
          width={760}
          open={detail !== null}
          loading={detailLoading}
          onClose={() => setDetail(null)}
        >
          {detail && (
            <>
              <Descriptions bordered size="small" column={{ xs: 1, md: 2 }} style={{ marginBottom: 16 }}>
                <Descriptions.Item label="版本 ID">
                  <Text code>{detail.id}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="状态">
                  <Tag color={configStatusColor[detail.status]}>{configStatusLabel[detail.status]}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="生效时间">{detail.applied_at ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="应用人">{detail.applied_by ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="M09 变更单">
                  {detail.source_change_no ? <Text code>{detail.source_change_no}</Text> : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="校验和（sha256）">
                  <Text code style={{ fontSize: 12 }}>{shortChecksum(detail.checksum)}</Text>
                </Descriptions.Item>
              </Descriptions>
              <pre
                style={{ margin: 0, maxHeight: 520, overflow: 'auto', background: tokens.colorBgBase, padding: 12, borderRadius: 8, fontSize: 13 }}
              >
                {detailLoaded?.id === detail.id ? detailLoaded.content : ''}
              </pre>
            </>
          )}
        </Drawer>
      </ConfigProvider>
    </MainLayout>
  )
}
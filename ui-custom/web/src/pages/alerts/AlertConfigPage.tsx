/**
 * 告警配置页（v3）。
 *
 * 页面职责：
 *   ① 当前生效配置（只读 YAML + 版本元数据 + 最近 reload 状态 + 手动重载）；
 *   ② 配置版本历史（只读留痕，可查看内容）。
 *
 * v3 语义（D25/D31）：配置由「路由规则 / 告警抑制 / 通知渠道」保存时生成，
 * 经 amtool 校验后由 M08 内部 Reload 子模块直接写盘并 reload，**保存即生效**；
 * 不存在「提交变更单 / 待确认下发」环节，M09 只保留只读快照。
 * 因此本页不再展示变更单号、待确认状态或确认入口。
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  App,
  Button,
  Card,
  Collapse,
  ConfigProvider,
  Descriptions,
  Drawer,
  Empty,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import config from 'antd/locale/zh_CN'
import { DownloadOutlined, EyeOutlined, HistoryOutlined, InfoCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { alertmanagerConfigApi } from '../../api/alertmanager'
import type { AlertmanagerConfigVersionListItem } from '../../types/alertmanager'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { PageIntro } from '../../components/PageIntro'
import { RuleGuideLink } from '../../components/RuleGuideLink'
import { useAlertConfig } from './useAlertConfig'
import { ROUTES_PATH } from './alertmanagerConstants'
import { shortChecksum } from '../../utils/shortChecksum'
import { triggerBlobDownload } from '../../utils/triggerBlobDownload'
import { MainLayout } from '../../layouts/MainLayout'
import { useSkin } from '../../skinContext'

const { Text } = Typography

/** reload 结果 → 展示文案（succeeded / failed / rolled_back）。 */
const RELOAD_STATUS_LABEL: Record<string, string> = {
  succeeded: '成功',
  failed: '失败',
  rolled_back: '已回退上一版',
}

function reloadStatusLabel(status?: string): string {
  if (!status) return '-'
  return RELOAD_STATUS_LABEL[status] ?? status
}

function reloadStatusColor(status?: string): string {
  switch (status) {
    case 'succeeded':
      return 'success'
    case 'rolled_back':
      return 'warning'
    case 'failed':
      return 'error'
    default:
      return 'default'
  }
}

export function AlertConfigPage() {
  const { tokens } = useSkin()
  const { message } = App.useApp()
  const {
    current,
    lastReload,
    versions,
    total,
    loading,
    error,
    permissionDenied,
    reload,
    page,
    pageSize,
    onPageSizeChange,
  } = useAlertConfig()

  const [detail, setDetail] = useState<AlertmanagerConfigVersionListItem | null>(null)
  const [detailLoaded, setDetailLoaded] = useState<{ id: string; content: string } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [reloading, setReloading] = useState(false)

  // YAML / 配置正文统一排版：等宽、可滚动、同圆角同内边距，配色取皮肤 token。
  const yamlBlockStyle = {
    margin: 0,
    overflow: 'auto',
    background: tokens.colorBgBase,
    padding: 12,
    borderRadius: 8,
    fontSize: 13,
  } as const

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

  /** 下载历史/当前版本的 alertmanager.yml（SRS v1.5 FR-05/FR-06）。 */
  const handleDownloadVersion = () => {
    if (!detail || !detailLoaded || detailLoaded.id !== detail.id) {
      message.warning('配置内容尚未加载完成，请稍后重试')
      return
    }
    triggerBlobDownload(
      new Blob([detailLoaded.content], { type: 'text/yaml;charset=utf-8' }),
      `${detail.id}-alertmanager.yml`,
    )
    message.success('alertmanager.yml 已开始下载')
  }

  /** 手动重载：用当前生效快照重跑一次 apply（不产生新版本，D-M08-06）。 */
  const handleManualReload = async () => {
    setReloading(true)
    try {
      const res = await alertmanagerConfigApi.reload()
      message.success(
        `已重新加载 Alertmanager（${reloadStatusLabel(res.data.status)}，${res.data.duration_ms} ms）`,
      )
      reload()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '重新加载失败，请确认 Alertmanager 已启动')
    } finally {
      setReloading(false)
    }
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
      dataIndex: 'is_current',
      key: 'is_current',
      width: 110,
      render: (v?: boolean) =>
        v ? <Tag color="success">当前生效</Tag> : <Tag>历史版本</Tag>,
    },
    {
      title: '生成时间',
      dataIndex: 'generated_at',
      key: 'generated_at',
      width: 180,
      render: (v?: string) => <Text type="secondary">{v ?? '-'}</Text>,
    },
    {
      title: '生成人',
      dataIndex: 'generated_by',
      key: 'generated_by',
      width: 130,
      render: (v?: string) => <Text>{v ?? '-'}</Text>,
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
      width: 90,
      fixed: 'right',
      render: (_: unknown, r: AlertmanagerConfigVersionListItem) => (
        <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => openVersionDetail(r)}>
          查看
        </Button>
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
        <PageIntro
          testId="alert-config-intro"
          title="告警配置"
          subtitle="查看当前生效的告警配置与历史版本；配置由路由规则、告警抑制、通知渠道保存时自动生成"
          points={[
            '本页是只读视图：看当前生效的是哪一版配置，以及历史上的版本内容。',
            <>
              保存路由 / 抑制 / 渠道变更时，平台会生成整份配置并执行 amtool 校验，
              通过后立即 reload 生效，无需人工确认。 <RuleGuideLink />
            </>,
            '要改路由分发，去「路由规则」页；要改接收渠道，去「通知渠道」页。本页不提供配置入口。',
          ]}
        />

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

        {/* ① 现状卡：现在生效的是什么 + 最近一次 reload 的结果/时间 + 手动重载入口。 */}
        <Card
          title="当前生效"
          extra={
            <Space size={12} wrap>
              {lastReload ? (
                <Tag color={reloadStatusColor(lastReload.status)}>
                  最近重载：{reloadStatusLabel(lastReload.status)} · {lastReload.started_at}
                </Tag>
              ) : null}
              <Button
                size="small"
                icon={<ReloadOutlined />}
                loading={reloading}
                onClick={handleManualReload}
              >
                重新加载 Alertmanager
              </Button>
            </Space>
          }
          style={{ marginBottom: 16 }}
          data-testid="alert-current-card"
        >
          {loading ? (
            <div style={{ textAlign: 'center', padding: 24 }}>
              <Text type="secondary">加载中…</Text>
            </div>
          ) : current && current.content ? (
            <>
              <Descriptions size="small" column={{ xs: 1, md: 3 }} style={{ marginBottom: 12 }}>
                <Descriptions.Item label="版本 ID">
                  <Text code>{current.id}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="生成时间">{current.generated_at ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="生成人">{current.generated_by ?? '-'}</Descriptions.Item>
              </Descriptions>
              <Collapse
                ghost
                size="small"
                items={[
                  {
                    key: 'yaml',
                    label: (
                      <Space size={8}>
                        <InfoCircleOutlined style={{ color: tokens.colorInfo }} />
                        <Text>查看完整配置内容</Text>
                        <Tag>只读</Tag>
                      </Space>
                    ),
                    children: (
                      <>
                        <Space size={8} style={{ marginBottom: 8 }} wrap>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            生成人：{current.generated_by ?? '-'}
                          </Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            生成时间：{current.generated_at ?? '-'}
                          </Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            校验和：<Text code>{shortChecksum(current.checksum)}</Text>
                          </Text>
                        </Space>
                        <pre style={yamlBlockStyle}>{current.content}</pre>
                      </>
                    ),
                  },
                ]}
              />
            </>
          ) : (
            <Empty
              description={
                <span>
                  当前无生效配置。请先到<Link to={ROUTES_PATH}>「路由规则」</Link>
                  页配置路由树，保存后立即生效。
                </span>
              }
            />
          )}
        </Card>

        {/* ② 配置版本历史：每次生成都会留一版，只读查看。 */}
        <Card
          title={
            <Space size={8} wrap>
              <HistoryOutlined />
              配置版本历史
              <Tag>内容留痕</Tag>
            </Space>
          }
          extra={<Text type="secondary" style={{ fontSize: 12 }}>每次配置变更都会存一版，可查看内容留痕</Text>}
          style={{ marginBottom: 16 }}
          data-testid="alert-versions-card"
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
              pageSize,
              pageSizeOptions: ['10', '20', '50', '100'],
              total,
              onChange: (p, pz) => onPageSizeChange(p, pz),
            }}
          />
        </Card>

        <Drawer
          title={detail ? `配置版本 ${detail.id} 内容` : '配置版本内容'}
          width={760}
          open={detail !== null}
          loading={detailLoading}
          onClose={() => setDetail(null)}
          extra={
            <Button
              icon={<DownloadOutlined />}
              disabled={!detailLoaded || detailLoaded.id !== detail?.id}
              onClick={handleDownloadVersion}
            >
              下载 alertmanager.yml
            </Button>
          }
        >
          {detail && (
            <>
              <Descriptions bordered size="small" column={{ xs: 1, md: 2 }} style={{ marginBottom: 16 }}>
                <Descriptions.Item label="版本 ID">
                  <Text code>{detail.id}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="状态">
                  {detail.is_current ? <Tag color="success">当前生效</Tag> : <Tag>历史版本</Tag>}
                </Descriptions.Item>
                <Descriptions.Item label="生成时间">{detail.generated_at ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="生成人">{detail.generated_by ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="校验和（sha256）">
                  <Text code style={{ fontSize: 12 }}>{shortChecksum(detail.checksum)}</Text>
                </Descriptions.Item>
              </Descriptions>
              <pre style={{ ...yamlBlockStyle, maxHeight: 520 }}>
                {detailLoaded?.id === detail.id ? detailLoaded.content : ''}
              </pre>
            </>
          )}
        </Drawer>
      </ConfigProvider>
    </MainLayout>
  )
}

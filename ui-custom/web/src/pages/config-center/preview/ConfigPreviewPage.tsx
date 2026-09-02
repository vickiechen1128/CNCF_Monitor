import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Button,
  Card,
  Collapse,
  ConfigProvider,
  Descriptions,
  Drawer,
  Empty,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import config from 'antd/locale/zh_CN'
import type { ColumnsType } from 'antd/es/table'
import {
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { configDraftApi, deploymentApi } from '../../../api/configCenter'
import type { ConfigDraft, ConfigChangeItem, ConfigVersion, DiscardImpact, DraftStatus, Risk } from '../../../types/config-center'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../../components/tablePresets'
import { MainLayout } from '../../../layouts/MainLayout'
import { useConfigDrafts, fetchMonitoredDomains, ALL_DOMAINS_ID } from './useConfigDrafts'
import { affectedFileSet, computeDiff, fileTextByKey, previewFileText, previewTabsFor, shortChecksum } from './configPreviewYaml'
import {
  CURRENT_USER,
  affectedFileColor,
  affectedFileLabel,
  changeTargetLabel,
  changeTypeColor,
  changeTypeLabel,
  channelColor,
  channelLabel,
  channelTip,
  draftStatusColor,
  draftStatusLabel,
  riskColor,
  riskLabel,
  validationColor,
  validationLabel,
} from '../configCenterConstants'

const { Text } = Typography

/** 废弃变更单对源数据的分类影响说明（决策 43-7）。 */
function DiscardImpactSummary({ impact }: { impact: DiscardImpact }) {
  const items: string[] = []
  if (impact.new_reverted > 0) {
    items.push(`${impact.new_reverted} 个新建未生效 Job 将回退为草稿`)
  }
  if (impact.modified_kept > 0) {
    items.push(`${impact.modified_kept} 个已生效 Job 的修改将保留（变更单废弃不影响字段值）`)
  }
  if (impact.deleted_restored > 0) {
    items.push(`${impact.deleted_restored} 个已生效 Job（删除/停用/草稿化）将被恢复`)
  }
  if (impact.missing > 0) {
    items.push(`${impact.missing} 个已生效 Job 在系统中已不存在，无法自动恢复`)
  }
  if (items.length === 0) {
    return <Text type="secondary">废弃后保持当前生效配置不变，源数据无额外影响。</Text>
  }
  return (
    <Space direction="vertical" size={4}>
      <div>废弃后源数据将发生如下变化：</div>
      {items.map((t) => (
        <div key={t}>• {t}</div>
      ))}
    </Space>
  )
}

/**
 * 配置变更确认页（Module_09 契约 §4 / PRD §3.4 / §11）。
 * 网域切换器 + 状态筛选（pending/confirmed/discarded/all 默认 pending）+ 分页；
 * 详情抽屉四 Tab：变更摘要 / 变更清单 / 配置预览（受影响文件高亮）/ 版本对比(diff)。
 * 确认(MVP 预置确认人) / 废弃 / 重新校验动作（Modal 二次确认 + loading 防重复）。
 * 覆盖：加载 / 空态 / 接口错误 / 权限不足（契约 §1.2 errorType）。
 */
export function ConfigPreviewPage() {
  const navigate = useNavigate()
  const {
    data,
    loading,
    error,
    permissionDenied,
    domainId,
    setDomainId,
    status,
    setStatus,
    page,
    pageSize,
    onPageSizeChange,
    reload,
  } = useConfigDrafts()

  const [domains, setDomains] = useState<{ id: string; name: string; channel: string; is_monitored: boolean }[]>([])
  const [domainError, setDomainError] = useState(false)

  const [detail, setDetail] = useState<ConfigDraft | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('summary')
  const [confirming, setConfirming] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [revalidating, setRevalidating] = useState(false)
  // MEDIUM-2：版本对比 Tab 真实对比 source_version（ConfigVersion 产物）
  const [sourceOrigin, setSourceOrigin] = useState<ConfigVersion | null>(null)
  const [sourceVersionLoading, setSourceVersionLoading] = useState(false)

  useEffect(() => {
    fetchMonitoredDomains()
      .then((list) => setDomains(list.map((d) => ({ id: d.id, name: d.name, channel: d.channel, is_monitored: d.is_monitored }))))
      .catch(() => setDomainError(true))
  }, [])

  // 默认「全部网域」（口径对齐）：不强制选中首个网域，domainId 保持 undefined 即展示全部网域变更清单；
  // 网域加载完成后不覆盖默认值，用户可手动切换到具体网域。

  const channelByDomainId = useMemo(() => {
    const m = new Map<string, { name: string; channel: string }>()
    domains.forEach((d) => m.set(d.id, { name: d.name, channel: d.channel }))
    return m
  }, [domains])

  const domainMap = useMemo(() => new Map(domains.map((d) => [d.id, d.name])), [domains])

  const pendingCount = data.items.filter((d) => d.status === 'pending').length
  const pendingHighRisk = data.items.some((d) => d.status === 'pending' && d.change_items?.some((i) => i.risk === 'high'))

  const openDetail = useCallback(async (record: ConfigDraft) => {
    setDetailLoading(true)
    setSourceOrigin(null)
    setActiveTab('summary')
    try {
      const res = await configDraftApi.get(record.change_no)
      setDetail(res.data)
      // MEDIUM-2：存在基础版本时拉取其产物供版本对比 Tab 做真实 diff
      if (res.data.source_version) {
        setSourceVersionLoading(true)
        try {
          const vres = await deploymentApi.getConfigVersion(res.data.source_version)
          setSourceOrigin(vres.data)
        } catch {
          setSourceOrigin(null)
        } finally {
          setSourceVersionLoading(false)
        }
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载变更详情失败，请稍后重试')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const handleConfirm = () => {
    if (!detail) return
    const isAgentPull = channelByDomainId.get(detail.network_domain_id)?.channel === 'agent_pull'
    // 决策 60：含告警配置（alertmanager.yml）的变更单在确认时提示——低风险人工确认，发布后立即 reload 并在 M08 回写「已生效」
    const hasAlertmanager = affectedFileSet(detail).has('alertmanager')
    Modal.confirm({
      title: `确认发布变更单 ${detail.change_no}？`,
      content: isAgentPull
        ? '确认后发布为配置包，待 Edge Sync Agent 下次心跳拉取生效（准实时 30s）。可在「采集节点状态」页查看配置同步与生效进度。'
        : `确认后由中心写盘并 reload 立即生效。${hasAlertmanager ? ' 本变更含告警配置（alertmanager.yml），发布后同步 reload Alertmanager，并在「告警收敛与通知管理」回写「已生效」。' : ''}`,
      okText: '确认发布',
      cancelText: '取消',
      async onOk() {
        setConfirming(true)
        try {
          await configDraftApi.confirm(detail.change_no, CURRENT_USER)
          message.success(`变更单 ${detail.change_no} 已确认并发布到监控（确认人：${CURRENT_USER}）`)
          setDetail(null)
          reload()
        } catch (e) {
          message.error(e instanceof Error ? e.message : '确认发布失败，请稍后重试')
          throw e
        } finally {
          setConfirming(false)
        }
      },
    })
  }

  const handleDiscard = async () => {
    if (!detail) return
    setDiscarding(true)
    try {
      const res = await configDraftApi.discardImpact(detail.change_no)
      const impact = res.data
      Modal.confirm({
        title: `废弃变更单 ${detail.change_no}？`,
        content: <DiscardImpactSummary impact={impact} />,
        okText: '废弃变更',
        okButtonProps: { danger: true },
        cancelText: '取消',
        async onOk() {
          setDiscarding(true)
          try {
            await configDraftApi.discard(detail.change_no, CURRENT_USER)
            message.info(`变更单 ${detail.change_no} 已废弃，保持当前生效配置不变`)
            setDetail(null)
            reload()
          } catch (e) {
            message.error(e instanceof Error ? e.message : '废弃变更失败，请稍后重试')
            throw e
          } finally {
            setDiscarding(false)
          }
        },
      })
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载废弃影响失败，请稍后重试')
    } finally {
      setDiscarding(false)
    }
  }

  const handleRevalidate = async () => {
    if (!detail) return
    setRevalidating(true)
    try {
      const res = await configDraftApi.revalidate(detail.change_no)
      message.success(`变更单 ${detail.change_no} 已重新校验：${validationLabel[res.data.validation_status as keyof typeof validationLabel]}`)
      await openDetail(detail)
      reload()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '重新校验失败，请稍后重试')
    } finally {
      setRevalidating(false)
    }
  }

  // 决策 45-1：仅 passed 可确认下发；pending/failed/rejected 均不可确认。
  // 重新校验 / 废弃出口对「非 passed 且非已确认/已废弃」的待办单可用。
  // 决策 45-3 修订：platform_fault（如 promtool 不可用）同样展示「重新校验」——
  // 后端校验层自动重试（决策 39-3 指数退避）尚未落地，须由用户在运维环境就绪后
  // 手动重校恢复可确认，避免草稿永久卡死 pending（决策 45-1 自愈入口覆盖全部非 passed 态）。
  const isPending = detail?.status === 'pending'
  const validationPassed = detail?.validation_status === 'passed'
  const validationFailed = detail?.validation_status === 'failed'
  const canConfirm = isPending && validationPassed
  const canRevalidate = isPending && !validationPassed
  // failed + user_config 时可提供「前往修改」引导（源数据输入层，决策 45-4）
  const canFixUserConfig = isPending && validationFailed && detail?.validation_cause === 'user_config'

  const columns: ColumnsType<ConfigDraft> = [
    {
      title: '变更单号',
      dataIndex: 'change_no',
      key: 'change_no',
      width: 170,
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      title: '变更摘要',
      key: 'summary',
      render: (_: unknown, r: ConfigDraft) => <Text ellipsis style={{ maxWidth: 320 }}>{r.summary}</Text>,
    },
    {
      title: (
        <Tooltip title="该变更所属网域的下发通道：local（中心直接 reload）/ agent_pull（Edge Sync Agent 心跳拉取配置包）">
          <Space size={4}>
            下发通道<InfoCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
          </Space>
        </Tooltip>
      ),
      key: 'channel',
      width: 130,
      render: (_: unknown, r: ConfigDraft) => {
        const channel = channelByDomainId.get(r.network_domain_id)?.channel ?? 'agent_pull'
        return (
          <Tooltip title={channelTip[channel as 'local' | 'agent_pull'] ?? ''}>
            <Tag color={channelColor[channel as 'local' | 'agent_pull']}>{channelLabel[channel as 'local' | 'agent_pull']}</Tag>
          </Tooltip>
        )
      },
    },
    {
      title: '风险等级',
      key: 'risk',
      width: 100,
      render: (_: unknown, r: ConfigDraft) => {
        const risk: Risk = r.change_items?.some((i) => i.risk === 'high') ? 'high' : 'low'
        return <Tag color={riskColor[risk]}>{riskLabel[risk]}</Tag>
      },
    },
    {
      title: '确认人',
      key: 'confirmed_by',
      width: 130,
      render: (_: unknown, r: ConfigDraft) =>
        r.status === 'confirmed' && r.confirmed_by ? (
          <Tooltip title={`确认时间：${r.confirmed_at ?? '-'}`}>
            <Text>{r.confirmed_by}</Text>
          </Tooltip>
        ) : r.status === 'discarded' ? (
          <Text type="secondary">已废弃</Text>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '生成时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (v: string) => <Text type="secondary">{v}</Text>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 90,
      fixed: 'right',
      render: (_: unknown, r: ConfigDraft) => (
        <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => openDetail(r)}>
          详情
        </Button>
      ),
    },
  ]

  const renderSummaryTab = () => (
    <div>
      <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
        <Descriptions.Item label="变更单号"><Text code>{detail?.change_no}</Text></Descriptions.Item>
        <Descriptions.Item label="网域">
          {domainMap.get(detail?.network_domain_id ?? '') ?? detail?.network_domain_id}
        </Descriptions.Item>
        <Descriptions.Item label="状态">
          <Tag color={draftStatusColor[detail?.status as DraftStatus]}>{draftStatusLabel[detail?.status as DraftStatus]}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="下发通道">
          <Tag color={channelColor[detail?.channel ?? 'local']}>{channelLabel[detail?.channel ?? 'local']}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="校验状态">
          <Tag color={validationColor[detail?.validation_status ?? 'pending']}>
            {validationLabel[detail?.validation_status ?? 'pending']}
          </Tag>
        </Descriptions.Item>
        {detail?.validation_message ? (
          <Descriptions.Item label="校验信息" span={2}>
            {/* 决策 45-2：failed→error；pending（待环境就绪）→warning，避免语义误导 */}
            <Alert
              type={detail.validation_status === 'failed' ? 'error' : 'warning'}
              showIcon
              message={
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <span>{detail.validation_message}</span>
                  {detail.validation_details?.map((vd, i) => (
                    <Text key={i} type="secondary" style={{ fontSize: 12 }}>
                      {vd.file ? `${vd.file}${vd.line ? `:${vd.line}` : ''}` : '—'}：{vd.message}
                    </Text>
                  ))}
                </Space>
              }
            />
          </Descriptions.Item>
        ) : null}
        <Descriptions.Item label="生成时间">{detail?.created_at}</Descriptions.Item>
        <Descriptions.Item label="变更摘要" span={2}>{detail?.summary}</Descriptions.Item>
      </Descriptions>
      <Collapse
        ghost
        size="small"
        style={{ marginTop: 12 }}
        items={[
          {
            key: 'tech',
            label: (
              <Space size={4}>
                <InfoCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
                技术信息（源数据版本 / 生成器版本 / 联合校验值）
              </Space>
            ),
            children: (
              <Descriptions bordered size="small" column={1}>
                <Descriptions.Item label="源数据版本">
                  <Text code>{detail?.metadata?.source_data_version ?? '-'}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="生成器版本">{detail?.metadata?.generator_version ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="触发摘要">{detail?.metadata?.trigger_summary ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="联合校验值">
                  <Text code style={{ fontSize: 12 }}>{shortChecksum(detail?.metadata?.checksum)}</Text>
                </Descriptions.Item>
              </Descriptions>
            ),
          },
        ]}
      />
    </div>
  )

  const renderChangeListTab = () => {
    const items: ConfigChangeItem[] = detail?.change_items ?? []
    if (items.length === 0) return <Empty description="无实际内容变化（已自动丢弃），无需确认" />
    return (
      <Table<ConfigChangeItem>
        rowKey={(item, idx) => `${item.target}-${idx}`}
        dataSource={items}
        size="small"
        pagination={false}
        scroll={TABLE_SCROLL_X}
        columns={[
          {
            title: '变更类型',
            key: 'type',
            width: 90,
            render: (_: unknown, item: ConfigChangeItem) => <Tag color={changeTypeColor[item.type]}>{changeTypeLabel[item.type]}</Tag>,
          },
          {
            title: '变更对象',
            key: 'target',
            width: 120,
            render: (_: unknown, item: ConfigChangeItem) => <Tag color="blue">{changeTargetLabel[item.target]}</Tag>,
          },
          { title: '变更说明', key: 'description', dataIndex: 'description' },
          {
            title: '影响的配置文件',
            key: 'affected-files',
            width: 200,
            render: (_: unknown, item: ConfigChangeItem) => (
              <Space size={4} wrap>
                {item.affected_files.map((f) => (
                  <Tag key={f} color={affectedFileColor[f]} style={{ marginInlineEnd: 0 }}>
                    {affectedFileLabel[f]}
                  </Tag>
                ))}
              </Space>
            ),
          },
          {
            title: '风险等级',
            key: 'risk',
            width: 110,
            render: (_: unknown, item: ConfigChangeItem) => <Tag color={riskColor[item.risk]}>{riskLabel[item.risk]}</Tag>,
          },
        ]}
      />
    )
  }

  const renderPreviewTab = () => {
    if (!detail) return null
    const affected = affectedFileSet(detail)
    // 决策 60：alertmanager.yml 条件渲染——仅变更单含该产物（管理域 default）时展示
    const tabs = previewTabsFor(detail)
    // 默认聚焦首受影响文件（PRD §9.1）
    const firstAffected = tabs.find((t) => t.affectedKey && affected.has(t.affectedKey))
    const defaultTab = firstAffected?.key ?? 'prometheus.yml'
    return (
      <div>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={`本次变更影响 ${affected.size}/${tabs.length} 个配置文件（受影响文件 Tab 带「变更」标记，默认聚焦首受影响）`}
        />
        <Tabs
          defaultActiveKey={defaultTab}
          type="card"
          items={tabs.map(({ key, label, affectedKey }) => ({
            key,
            label: (
              <Space size={4}>
                {label}
                {affectedKey && affected.has(affectedKey) ? <Tag color="error" style={{ marginInlineEnd: 0 }}>变更</Tag> : null}
              </Space>
            ),
            children: (
              <pre
                className="yaml-preview"
                style={{ margin: 0, maxHeight: 480, overflow: 'auto', background: '#F7F8FA', padding: 12, borderRadius: 8, fontSize: 13 }}
              >
                {previewFileText(detail, key) ?? '（当前无此产物）'}
              </pre>
            ),
          }))}
        />
      </div>
    )
  }

  const renderDiffTab = () => {
    if (!detail) return null
    if (!detail.source_version) {
      return <Empty description="无历史版本可对比（该变更暂无基础版本）" />
    }
    if (sourceVersionLoading) {
      return (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Text type="secondary">加载源版本产物…</Text>
        </div>
      )
    }
    // MEDIUM-2：无法拉取到源版本产物时明确降级，而非把草稿全量标为新增
    if (!sourceOrigin) {
      return (
        <Alert
          type="warning"
          showIcon
          message="无历史版本可对比"
          description="当前无法拉取源版本（source_version）产物，仅展示草稿本次变更；历史版本确认后仍可在「查看发布记录」查看。"
        />
      )
    }
    const fileTabs = previewTabsFor(detail).map(({ key, label }) => {
      const newText = previewFileText(detail, key)
      const oldText = fileTextByKey(sourceOrigin, key)
      const rows = computeDiff(oldText, newText)
      return {
        key,
        label,
        children:
          rows.length === 0 || (rows.length === 1 && rows[0].type === 'same') ? (
            <Empty description="当前文件无差异" />
          ) : (
            <pre style={{ margin: 0, maxHeight: 480, overflow: 'auto', background: '#F7F8FA', padding: 12, fontSize: 13 }}>
              {rows.map((r) => (
                <div
                  key={r.line}
                  style={{ color: r.type === 'added' ? '#237804' : r.type === 'removed' ? '#CF1322' : 'rgba(0,0,0,0.65)' }}
                >
                  {r.type === 'added' ? '+ ' : r.type === 'removed' ? '- ' : '  '}
                  {r.oldLine ?? r.newLine}
                </div>
              ))}
            </pre>
          ),
      }
    })
    return (
      <div>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="版本对比为草稿产物 vs 生效版本（按文件 diff）；targets/*.json 与 YAML 均参与对比。作用域为当前 source_version，仅列出存在差异的文件。"
        />
        <Tabs type="card" items={fileTabs} />
      </div>
    )
  }

  return (
    <MainLayout>
      <ConfigProvider locale={config}>
        {permissionDenied || domainError ? (
        <Card>
          <Empty description={permissionDenied ? '当前账号无此页面查看权限' : '网域列表加载失败，请稍后重试'} />
        </Card>
      ) : (
        <Card
          title="配置变更确认"
          extra={
            <Space wrap>
              <Select
                // LOW-2：以显式「全部网域」选项替代 allowClear（清空后不再被默认 effect 强制重选）
                placeholder="选择网域"
                style={{ minWidth: 200 }}
                value={domainId ?? ALL_DOMAINS_ID}
                onChange={(v) => setDomainId(v as string | undefined)}
                options={[
                  { value: ALL_DOMAINS_ID, label: '全部网域' },
                  ...domains.map((d) => ({ value: d.id, label: `${d.name}（${channelLabel[d.channel as 'local' | 'agent_pull']}）` })),
                ]}
              />
              <Select
                style={{ width: 120 }}
                value={status}
                onChange={(v) => setStatus(v)}
                options={[
                  { value: 'pending', label: '待确认' },
                  { value: 'confirmed', label: '已确认' },
                  { value: 'discarded', label: '已废弃' },
                  { value: 'all', label: '全部' },
                ]}
              />
            </Space>
          }
        >
          {error && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 12 }}
              message="配置变更列表加载失败，请稍后重试"
              description={error}
              action={<Button size="small" onClick={reload}>重新加载</Button>}
            />
          )}

          {/* 变更检测状态区（决策 20 引导性状态，不记历史） */}
          <Alert
            style={{ marginBottom: 12 }}
            type={pendingCount > 0 ? (pendingHighRisk ? 'warning' : 'info') : 'success'}
            showIcon={false}
            message={
              pendingCount > 0
                ? `检测到 ${pendingCount} 个待确认变更${pendingHighRisk ? '（含高风险，请重点确认）' : ''}：请前往下方列表逐项确认后发布`
                : '当前无待确认变更：策略或资源变更后配置会自动生成；内容无实际影响的变更已自动过滤，无需确认'
            }
          />

          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Text type="secondary">加载中…</Text>
            </div>
          ) : data.items.length === 0 ? (
            <Empty description="当前网域暂无配置变更" />
          ) : (
            <Table<ConfigDraft>
              rowKey="change_no"
              dataSource={data.items}
              loading={false}
              columns={columns}
              scroll={{ ...TABLE_SCROLL_X, x: 'max-content' }}
              pagination={{ ...TABLE_PAGINATION, current: page, pageSize, total: data.total, onChange: (p, pz) => onPageSizeChange(p, pz) }}
            />
          )}
        </Card>
      )}

      <Drawer
        title={
          detail ? (
            <Space direction="vertical" size={2}>
              <Space size={8}>
                <Text strong style={{ fontSize: 15 }}>{detail.change_no}</Text>
                <Tag color={draftStatusColor[detail.status]}>{draftStatusLabel[detail.status]}</Tag>
                <Tag color={riskColor[detail.change_items?.some((i) => i.risk === 'high') ? 'high' : 'low']}>
                  {riskLabel[detail.change_items?.some((i) => i.risk === 'high') ? 'high' : 'low']}
                </Tag>
              </Space>
              <Text type="secondary" style={{ fontSize: 13 }}>{detail.summary}</Text>
            </Space>
          ) : (
            '变更详情'
          )
        }
        width={920}
        open={detail !== null}
        loading={detailLoading}
        onClose={() => setDetail(null)}
        extra={
          detail && (
            <Space size={8}>
              {isPending ? (
                <>
                  {canRevalidate && (
                    <Button icon={<ReloadOutlined />} loading={revalidating} onClick={handleRevalidate}>
                      重新校验
                    </Button>
                  )}
                  {canFixUserConfig && (
                    <Button
                      icon={<EditOutlined />}
                      onClick={() => {
                        setDetail(null)
                        navigate(`/scrape-jobs`)
                      }}
                    >
                      前往修改
                    </Button>
                  )}
                  <Button danger icon={<DeleteOutlined />} loading={discarding} onClick={handleDiscard}>
                    废弃变更
                  </Button>
                  <Tooltip
                    title={
                      validationPassed
                        ? '确认后立即 reload / 发布配置包生效'
                        : detail?.validation_status === 'failed'
                          ? '下发前校验未通过，禁止确认'
                          : '下发前校验未通过（待校验），禁止确认'
                    }
                  >
                    <Button type="primary" icon={<CheckOutlined />} disabled={!canConfirm} loading={confirming} onClick={handleConfirm}>
                      确认发布
                    </Button>
                  </Tooltip>
                </>
              ) : (
                <>
                  <Button
                    icon={<HistoryOutlined />}
                    onClick={() => navigate(`/deployments?change_no=${detail.change_no}&network_domain=${detail.network_domain_id}`)}
                  >
                    查看发布记录
                  </Button>
                  <Tag color="default">历史变更仅只读</Tag>
                </>
              )}
            </Space>
          )
        }
      >
        {detail && detail.metadata?.superseded_by_change_no && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={`该变更单已被新变更单 ${detail.metadata.superseded_by_change_no} 取代`}
            description="网域内产生了新的配置变更，本单已自动废弃。请前往列表打开新变更单进行确认。"
          />
        )}
        {detail && (
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              { key: 'summary', label: '变更摘要', children: renderSummaryTab() },
              { key: 'changes', label: '变更清单', children: renderChangeListTab() },
              { key: 'preview', label: '配置预览', children: renderPreviewTab() },
              { key: 'diff', label: '版本对比', children: renderDiffTab() },
            ]}
          />
        )}
      </Drawer>
      </ConfigProvider>
    </MainLayout>
  )
}
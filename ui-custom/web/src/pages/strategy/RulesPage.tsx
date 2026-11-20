import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { ColumnsType } from 'antd/es/table'
import { monitoringRuleApi } from '../../api/monitoringRules'
import type { ApiResponse } from '../../types/api'
import type { MonitoringRule } from '../../types/strategy'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { EllipsisText } from '../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { MainLayout } from '../../layouts/MainLayout'
import { CONTENT_MODE_MAP } from './strategyConstants'
import { useCollectionTemplateCatalog } from './useCollectionTemplateCatalog'
import SyncStatusTag from './SyncStatusTag'
import { aggregateJobSyncStatus } from './syncStatus'
import { RuleMountDrawer } from './RuleMountDrawer'
import { useSyncPolling } from './useSyncPolling'
import { triggerConfigDraftsForAllDomains } from '../config-center/preview/triggerConfigDraft'

const { Text } = Typography

/** 单个规则条数统计：按 rule_content 中规则条目标记（- alert / - record）粗统计；列表不返回 rule_content 时显示占位 */
function countRules(content?: string): number | null {
  if (!content) return null
  const m = content.match(/-\s*(?:alert|record)\s*:/g)
  return m ? m.length : 0
}

function formatTime(iso?: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 变更进度（M09 管线追踪视角，与采集 Job 列同词表，避免与「生效状态」撞车） */
interface RulesState {
  list: MonitoringRule[]
  total: number
}

const EMPTY_RULES: RulesState = { list: [], total: 0 }

/**
 * 规则编辑（文件挂载）页（Module_01 §3.1/§5.5/§6.2.4/§11.1/§11.2，F6）。
 * - 列表：规则名 / 内容形态 / 采集模板 / 规则条数 / 更新时间 / 变更进度 / 生效状态；
 * - 操作：详情 / 启停（文字按钮 + Popconfirm 二次确认）/ 删除（YAML 只读 Drawer）；
 * - 「变更进度」= M09 管线视角，「生效状态」= 用户视角生命周期，与采集 Job 列同源同机制（F21 对齐）；
 * - 保存成功提示 M09 变更引导 + 乐观待下发；加载 / 空态「暂无规则」/ 错误态。
 */
export function RulesPage() {
  const templateCatalog = useCollectionTemplateCatalog()
  const navigate = useNavigate()
  const [rules, setRules] = useState<RulesState>(EMPTY_RULES)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState<string | undefined>()
  const [enabled, setEnabled] = useState<boolean | undefined>()
  const [templateCode, setTemplateCode] = useState<string | undefined>()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [refresh, setRefresh] = useState(0)
  const [mountOpen, setMountOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<MonitoringRule | null>(null)
  const [detail, setDetail] = useState<MonitoringRule | null>(null)

  /** 采集模板 code → 展示名；模板已删除时回落展示 code，避免历史规则显示空白 */
  const templateName = useCallback(
    (code: string) => templateCatalog.templates.find((t) => t.code === code)?.name ?? code,
    [templateCatalog.templates],
  )

  const templateOptions = useMemo(
    () => templateCatalog.templates.map((t) => ({ value: t.code, label: t.name })),
    [templateCatalog.templates],
  )

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
      setError(null)
    }
    try {
      const res = await monitoringRuleApi.list({
        keyword,
        enabled,
        template_code: templateCode,
        page,
        page_size: pageSize,
      })
      setRules(res.data ?? EMPTY_RULES)
    } catch (e) {
      if (!silent) {
        setError(e instanceof Error ? e.message : '规则加载失败，请稍后重试')
        setRules(EMPTY_RULES)
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [keyword, enabled, templateCode, page, pageSize])

  useEffect(() => {
    // 异步请求回调后 setState；沿用本模块既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, refresh])

  const reload = useCallback(() => setRefresh((n) => n + 1), [])
  const startSyncPolling = useSyncPolling(
    useCallback(() => {
      void load(true)
    }, [load]),
  )

  // 规则为全局 scope（central/both），保存后 best-effort 即时触发中心规则重算；
  // 失败由 30s watcher 兜底。
  const notifyChangeGuide = useCallback(() => {
    void triggerConfigDraftsForAllDomains({ onNavigate: () => navigate('/config-preview') })
  }, [navigate])

  const openDetail = async (record: MonitoringRule) => {
    try {
      const res: ApiResponse<MonitoringRule> = await monitoringRuleApi.get(record.id)
      setDetail(res.data ?? record)
    } catch {
      setDetail(record)
    }
  }

  /** 打开规则编辑抽屉（编辑模式回显；停用/已生效规则均可编辑，pending 由操作列禁用兜底） */
  const openEdit = useCallback((rule: MonitoringRule) => {
    setEditingRule(rule)
    setMountOpen(true)
  }, [])

  const toggleEnabled = useCallback(
    async (rule: MonitoringRule, next: boolean) => {
      try {
        await monitoringRuleApi.update(rule.id, {
          name: rule.name,
          enabled: next,
        })
        notifyChangeGuide()
        reload()
        startSyncPolling()
      } catch (e) {
        message.error(e instanceof Error ? e.message : '操作失败，请稍后重试')
      }
    },
    [notifyChangeGuide, reload, startSyncPolling],
  )

  const removeRule = useCallback(
    async (rule: MonitoringRule) => {
      try {
        await monitoringRuleApi.remove(rule.id)
        notifyChangeGuide()
        reload()
        startSyncPolling()
      } catch (e) {
        message.error(e instanceof Error ? e.message : '删除失败，请稍后重试')
      }
    },
    [notifyChangeGuide, reload, startSyncPolling],
  )

  const columns: ColumnsType<MonitoringRule> = useMemo(() => {
    return [
      {
        title: '规则名',
        dataIndex: 'name',
        key: 'name',
        fixed: 'left',
        width: 220,
        render: (v: string, r) => <EllipsisText>{v || `规则 #${r.id}`}</EllipsisText>,
      },
      {
        title: '内容形态',
        dataIndex: 'content_mode',
        key: 'content_mode',
        width: 110,
        render: (v: string) => CONTENT_MODE_MAP[v as keyof typeof CONTENT_MODE_MAP] ?? v,
      },
      {
        // M01 v2.0：规则归属由「监控对象类型」改为「采集模板」（可选）
        title: '采集模板',
        dataIndex: 'template_code',
        key: 'template_code',
        width: 150,
        render: (v: string) =>
          v ? templateName(v) : <Text type="secondary">-</Text>,
      },
      {
        title: '规则条数',
        key: 'count',
        width: 90,
        render: (_: unknown, r: MonitoringRule) => {
          const n = countRules(r.rule_content)
          return n === null ? <Text type="secondary">-</Text> : String(n)
        },
      },
      {
        title: '更新时间',
        dataIndex: 'updated_at',
        key: 'updated_at',
        width: 160,
        render: (v: string) => <Text type="secondary">{formatTime(v)}</Text>,
      },
      {
        title: '启用状态',
        key: 'enabled',
        width: 100,
        render: (_: unknown, r: MonitoringRule) => (
          <Tag color={r.enabled ? 'green' : 'default'}>{r.enabled ? '已启用' : '已停用'}</Tag>
        ),
      },
      {
        title: '同步状态',
        key: 'sync',
        width: 120,
        render: (_: unknown, r: MonitoringRule) => (
          <SyncStatusTag sync={r.sync} draftStatus={r.draft_status} enabled={r.enabled} />
        ),
      },
      {
        title: '操作',
        key: 'actions',
        fixed: 'right',
        width: 200,
        render: (_: unknown, r: MonitoringRule) => {
          return (
            <Space size={0}>
              <Tooltip>
                <Button type="link" size="small" onClick={() => openEdit(r)}>
                  编辑
                </Button>
              </Tooltip>
              <Button type="link" size="small" onClick={() => void openDetail(r)}>
                详情
              </Button>
              <Popconfirm
                title={r.enabled ? '停用规则' : '启用规则'}
                description={
                  r.enabled
                    ? `停用后「${r.name}」将从下发配置中移除，相关监控中断；需到配置变更页确认后生效。`
                    : `启用后「${r.name}」将重新纳入配置下发；需到配置变更页确认后生效。`
                }
                okText={r.enabled ? '确认停用' : '确认启用'}
                okButtonProps={r.enabled ? { danger: true } : undefined}
                cancelText="取消"
                onConfirm={() => void toggleEnabled(r, !r.enabled)}
              >
                <Button type="link" size="small" danger={r.enabled}>
                  {r.enabled ? '停用' : '启用'}
                </Button>
              </Popconfirm>
              <Popconfirm
                title="删除规则"
                description="删除后该规则将不再参与求值，确定删除？"
                okText="删除"
                cancelText="取消"
                onConfirm={() => void removeRule(r)}
              >
                <Button type="link" size="small" danger>
                  删除
                </Button>
              </Popconfirm>
            </Space>
          )
        },
      },
    ]
  }, [toggleEnabled, removeRule, openEdit, templateName])

  return (
    <MainLayout>
      <Card
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={reload}>
              刷新
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditingRule(null)
                setMountOpen(true)
              }}
            >
              挂载规则
            </Button>
          </Space>
        }
      >
      {error && (
        <Alert
          type="error"
          showIcon
          message="规则加载失败，请稍后重试"
          description={error}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={reload}>
              重新加载
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      )}
      {/* D-1b ⓐ：规则编辑页顶部定位文案——本页同时承载告警规则与记录规则，
          回答「告警用户找不到规则入口」的心智问题（导航归属不变，方案丙）。 */}
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        本页同时承载告警规则与记录规则：告警规则决定「什么情况算异常」，触发后由「告警配置」决定发给谁；
        记录规则把查询结果落成新的时间序列，不参与告警。
      </Text>
      <FilterBar>
        <FilterItem label="启用状态" width={170}>
          <Select
            allowClear
            placeholder="全部状态"
            style={{ width: 130 }}
            value={enabled}
            onChange={(v) => {
              setEnabled(v ?? undefined)
              setPage(1)
            }}
          >
            <Select.Option value={true as unknown as string}>启用</Select.Option>
            <Select.Option value={false as unknown as string}>停用</Select.Option>
          </Select>
        </FilterItem>
        <FilterItem label="采集模板" width={230}>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="全部模板"
            style={{ width: 190 }}
            value={templateCode}
            // 采集模板是数据（可新增/停用）：每次展开下拉都重新拉取，避免选项滞后
            onOpenChange={(open) => {
              if (open) templateCatalog.reload()
            }}
            onChange={(v) => {
              setTemplateCode(v ?? undefined)
              setPage(1)
            }}
            options={templateOptions}
          />
        </FilterItem>
        <FilterItem label="关键字" width={260}>
          <Input.Search
            allowClear
            placeholder="搜索规则名"
            style={{ width: 220 }}
            value={keyword}
            onSearch={(v) => {
              setKeyword(v || undefined)
              setPage(1)
            }}
          />
        </FilterItem>
      </FilterBar>

      <Table<MonitoringRule>
        rowKey="id"
        dataSource={rules.list}
        loading={loading}
        columns={columns}
        size="small"
        scroll={TABLE_SCROLL_X}
        locale={{ emptyText: <Empty description="暂无规则" /> }}
        pagination={{
          ...TABLE_PAGINATION,
          current: page,
          pageSize,
          total: rules.total,
          onChange: setPage,
          onShowSizeChange: (_c, s) => setPageSize(s),
        }}
      />

      <RuleMountDrawer
        open={mountOpen}
        onCancel={() => {
          setMountOpen(false)
          setEditingRule(null)
        }}
        onSuccess={() => {
          reload()
          startSyncPolling()
          // 抽屉内部决定何时关闭：干净保存在保存分支直接 onCancel；
          // 存在规则 job 引用提示（决策 66）时保持抽屉打开供阅读，用户手动关闭。
        }}
        editingRule={editingRule}
      />

      <Drawer
        title="规则详情"
        open={detail !== null}
        onClose={() => setDetail(null)}
        width={600}
        footer={
          <div style={{ textAlign: 'right' }}>
            <Button onClick={() => setDetail(null)}>关闭</Button>
          </div>
        }
      >
        {detail && (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <Space wrap>
              <Text strong>规则名：</Text>
              <Text>{detail.name || `规则 #${detail.id}`}</Text>
            </Space>
            <Space wrap>
              <Text strong>内容形态：</Text>
              <Text>{CONTENT_MODE_MAP[detail.content_mode] ?? detail.content_mode}</Text>
              <Text strong style={{ marginLeft: 16 }}>
                采集模板：
              </Text>
              <Text>{detail.template_code ? templateName(detail.template_code) : '-'}</Text>
              <Text strong style={{ marginLeft: 16 }}>
                同步状态：
              </Text>
              <Text>{aggregateJobSyncStatus(detail).label}</Text>
            </Space>
            <Typography.Title level={5}>rules.yml 内容</Typography.Title>
            <pre
              style={{
                margin: 0,
                width: '100%',
                background: '#f5f5f5',
                padding: 12,
                borderRadius: 6,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {detail.rule_content || '（无内容）'}
            </pre>
          </Space>
        )}
      </Drawer>
      </Card>
    </MainLayout>
  )
}

export default RulesPage
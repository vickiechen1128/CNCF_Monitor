import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { PlusOutlined, ReloadOutlined, InfoCircleOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { monitoringRuleApi } from '../../api/monitoringRules'
import type { ApiResponse } from '../../types/api'
import type { MonitoringRule } from '../../types/strategy'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { EllipsisText } from '../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { MainLayout } from '../../layouts/MainLayout'
import { CONTENT_MODE_MAP, MONITOR_TYPE_CASCADE, MONITOR_TYPE_MAP, EFFECTIVE_STATUS_TOOLTIP, CHANGE_PROGRESS_TOOLTIP } from './strategyConstants'
import { aggregateJobStatus } from './jobStatus'
import { RuleMountDrawer } from './RuleMountDrawer'

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
const CHANGE_PROGRESS_MAP: Record<string, string> = {
  none: '无变更',
  pending: '待确认',
  confirmed: '已确认待下发',
  deployed: '已下发',
}

interface RulesState {
  list: MonitoringRule[]
  total: number
}

const EMPTY_RULES: RulesState = { list: [], total: 0 }

/**
 * 规则编辑（文件挂载）页（Module_01 §3.1/§5.5/§6.2.4/§11.1/§11.2，F6）。
 * - 列表：规则名 / 内容形态 / 监控对象类型 / 规则条数 / 更新时间 / 变更进度 / 生效状态；
 * - 操作：详情 / 启停（文字按钮 + Popconfirm 二次确认）/ 删除（YAML 只读 Drawer）；
 * - 「变更进度」= M09 管线视角，「生效状态」= 用户视角生命周期，与采集 Job 列同源同机制（F21 对齐）；
 * - 保存成功提示 M09 变更引导 + 乐观待下发；加载 / 空态「暂无规则」/ 错误态。
 */
export function RulesPage() {
  const [rules, setRules] = useState<RulesState>(EMPTY_RULES)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState<string | undefined>()
  const [enabled, setEnabled] = useState<boolean | undefined>()
  const [monitorType, setMonitorType] = useState<string | undefined>()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [refresh, setRefresh] = useState(0)
  const [mountOpen, setMountOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<MonitoringRule | null>(null)
  const [detail, setDetail] = useState<MonitoringRule | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await monitoringRuleApi.list({
        keyword,
        enabled,
        monitor_type: monitorType,
        page,
        page_size: pageSize,
      })
      setRules(res.data ?? EMPTY_RULES)
    } catch (e) {
      setError(e instanceof Error ? e.message : '规则加载失败，请稍后重试')
      setRules(EMPTY_RULES)
    } finally {
      setLoading(false)
    }
  }, [keyword, enabled, monitorType, page, pageSize])

  useEffect(() => {
    // 异步请求回调后 setState；沿用本模块既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, refresh])

  const reload = useCallback(() => setRefresh((n) => n + 1), [])

  const notifyChangeGuide = useCallback(() => {
    message.success('变更将由 M09 生成变更单并下发')
  }, [])

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
      } catch (e) {
        message.error(e instanceof Error ? e.message : '操作失败，请稍后重试')
      }
    },
    [notifyChangeGuide, reload],
  )

  const removeRule = useCallback(
    async (rule: MonitoringRule) => {
      try {
        await monitoringRuleApi.remove(rule.id)
        notifyChangeGuide()
        reload()
      } catch (e) {
        message.error(e instanceof Error ? e.message : '删除失败，请稍后重试')
      }
    },
    [notifyChangeGuide, reload],
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
        title: '监控对象类型',
        dataIndex: 'monitor_type',
        key: 'monitor_type',
        width: 130,
        render: (v: string) =>
          v ? MONITOR_TYPE_MAP[v as keyof typeof MONITOR_TYPE_MAP] ?? v : <Text type="secondary">-</Text>,
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
        // 相对「变更进度」靠前：先回答用户「当前是否已真正生效」，再看挂在 M09 管线哪一环（与采集 Job 列表对齐）。
        title: (
          <Tooltip title={EFFECTIVE_STATUS_TOOLTIP}>
            <Space size={4}>
              生效状态
              <InfoCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
            </Space>
          </Tooltip>
        ),
        key: 'status',
        width: 120,
        render: (_: unknown, r: MonitoringRule) => {
          const s = aggregateJobStatus(r)
          return (
            <Badge
              status={s.badgeStatus}
              text={<Text type={s.disabled ? 'secondary' : undefined}>{s.label}</Text>}
            />
          )
        },
      },
      {
        // 角标指引：确认不必逐条规则进行，可待所有监控配置调好后一次性到 M09 批量确认（与采集 Job 列表对齐）。
        title: (
          <Tooltip title={CHANGE_PROGRESS_TOOLTIP}>
            <Space size={4}>
              变更进度
              <InfoCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
            </Space>
          </Tooltip>
        ),
        dataIndex: 'change_status',
        key: 'change_progress',
        width: 110,
        render: (v: string) => CHANGE_PROGRESS_MAP[v] ?? v,
      },
      {
        title: '操作',
        key: 'actions',
        fixed: 'right',
        width: 200,
        render: (_: unknown, r: MonitoringRule) => {
          // 决策 F-25：change_status=pending 的规则已挂起变更单，禁止编辑，避免变更单内容与源数据脱节
          // （与采集 Job F-19 / 决策 44-1 锁定语义一致）；停用规则可编辑，编辑不改变启停状态。
          const isPending = r.change_status === 'pending'
          const pendingTip = '该规则存在待确认变更单，请先前往配置变更确认页处理'
          return (
            <Space size={0}>
              <Tooltip title={isPending ? pendingTip : undefined}>
                <Button type="link" size="small" disabled={isPending} onClick={() => openEdit(r)}>
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
  }, [toggleEnabled, removeRule, openEdit])

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
        <FilterItem label="监控对象类型" width={230}>
          <Select
            allowClear
            placeholder="全部类型"
            style={{ width: 190 }}
            value={monitorType}
            onChange={(v) => {
              setMonitorType(v ?? undefined)
              setPage(1)
            }}
          >
            {MONITOR_TYPE_CASCADE.flatMap((g) => g.types).map((t) => (
              <Select.Option key={t} value={t}>
                {MONITOR_TYPE_MAP[t]}
              </Select.Option>
            ))}
          </Select>
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
          setMountOpen(false)
          setEditingRule(null)
          reload()
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
                监控对象类型：
              </Text>
              <Text>
                {detail.monitor_type
                  ? MONITOR_TYPE_MAP[detail.monitor_type as keyof typeof MONITOR_TYPE_MAP] ?? detail.monitor_type
                  : '-'}
              </Text>
              <Text strong style={{ marginLeft: 16 }}>
                生效状态：
              </Text>
              <Text>{aggregateJobStatus(detail).label}</Text>
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
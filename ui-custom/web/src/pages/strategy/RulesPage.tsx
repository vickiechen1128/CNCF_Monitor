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
  Switch,
  Table,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { monitoringRuleApi } from '../../api/monitoringRules'
import type { ApiResponse } from '../../types/api'
import type { MonitoringRule } from '../../types/strategy'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { EllipsisText } from '../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { CHANGE_STATUS_MAP, CONTENT_MODE_MAP } from './strategyConstants'
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

interface RulesState {
  list: MonitoringRule[]
  total: number
}

const EMPTY_RULES: RulesState = { list: [], total: 0 }

/**
 * 规则编辑（文件挂载）页（Module_01 §3.1/§5.5/§6.2.4/§11.1/§11.2，F6）。
 * - 列表：规则名 / 规则条数 / 更新时间 / 启用状态 / 下发状态（change_status）；
 * - 操作：启停 / 删除 / 详情（YAML 只读 Drawer）；
 * - 保存成功提示 M09 变更引导 + 乐观待下发；加载 / 空态「暂无规则」/ 错误态。
 */
export function RulesPage() {
  const [rules, setRules] = useState<RulesState>(EMPTY_RULES)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState<string | undefined>()
  const [enabled, setEnabled] = useState<boolean | undefined>()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [refresh, setRefresh] = useState(0)
  const [mountOpen, setMountOpen] = useState(false)
  const [detail, setDetail] = useState<MonitoringRule | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await monitoringRuleApi.list({
        keyword,
        enabled,
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
  }, [keyword, enabled, page, pageSize])

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
          <Badge status={r.enabled ? 'success' : 'default'} text={r.enabled ? '启用' : '停用'} />
        ),
      },
      {
        title: '下发状态',
        dataIndex: 'change_status',
        key: 'change_status',
        width: 100,
        render: (v: string) => CHANGE_STATUS_MAP[v] ?? v,
      },
      {
        title: '操作',
        key: 'actions',
        fixed: 'right',
        width: 160,
        render: (_: unknown, r: MonitoringRule) => (
          <Space size={0}>
            <Button type="link" size="small" onClick={() => void openDetail(r)}>
              详情
            </Button>
            <Tooltip title={r.enabled ? '点击停用' : '点击启用'}>
              <Switch
                size="small"
                checked={r.enabled}
                onChange={(checked) => void toggleEnabled(r, checked)}
                aria-label="启停"
              />
            </Tooltip>
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
        ),
      },
    ]
  }, [toggleEnabled, removeRule])

  return (
    <Card
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={reload}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setMountOpen(true)}>
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
        onCancel={() => setMountOpen(false)}
        onSuccess={() => {
          setMountOpen(false)
          reload()
        }}
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
                下发状态：
              </Text>
              <Text>{CHANGE_STATUS_MAP[detail.change_status] ?? detail.change_status}</Text>
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
  )
}

export default RulesPage
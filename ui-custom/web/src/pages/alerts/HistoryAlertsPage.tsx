/**
 * 历史告警页（Module_08 历史告警：webhook 留痕 + 分钟级对账）。
 *
 * 一行 = 一次告警发生（按 Alertmanager fingerprint 合并），不是通知流水账：
 * 未恢复期间重复推送不新增行；恢复回填同一行；恢复后再次触发新开一行。
 *
 * 六态：告警中 / 静默中 / 抑制中 / 已恢复 / 静默期间结束 / 恢复信息丢失。
 * 恢复时间只有「已恢复」是真实值；后两类是恢复通知缺失时的如实标记（留空不伪造）。
 *
 * 筛选：网域 / 告警名 / 摘要 / 状态 / 触发时间范围；服务端分页。
 */
import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Collapse,
  ConfigProvider,
  DatePicker,
  Empty,
  Input,
  Select,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import config from 'antd/locale/zh_CN'
import { InfoCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { EllipsisText } from '../../components/EllipsisText'
import { RuleGuideEmpty } from '../../components/RuleGuideLink'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { MainLayout } from '../../layouts/MainLayout'
import type { AlertEventItem, AlertEventStatus } from '../../types/alertmanager'
import { useHistoryAlerts, useNetworkDomains, defaultTimeRange } from './useHistoryAlerts'
import { alertEventStatusColor, alertEventStatusLabel } from './alertmanagerConstants'
import { useSkin } from '../../skinContext'

const { Text } = Typography
const { RangePicker } = DatePicker

/** 时间展示：ISO 转本地可读串 */
function formatTime(iso?: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('zh-CN', { hour12: false })
}

/** 持续时长展示：秒 → "2h 3m" / "45s" */
function formatDuration(seconds?: number): string {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) return '-'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`
}

/**
 * 实例名展示（M08 v1.15 决策 70）：M01 资源清单口径，由后端按告警标签 resource_id
 * 回连资源表回填。无 resource_id（拨测 / 聚合 / 自写规则）时显示 '-'。
 */
function instanceNameOf(item: AlertEventItem): string {
  return item.resource_name || '-'
}

/** 采集地址展示：后端语义化字段优先，缺失回落标签链。 */
function instanceAddressOf(item: AlertEventItem): string {
  if (item.instance_address) return item.instance_address
  if (item.instance_display) return item.instance_display
  if (item.labels?.instance) return item.labels.instance
  return '全局/聚合'
}

/** 「采集地址」列表头：挂提示直接消解 `:9100`（exporter 端口）被误读为业务端口 */
function InstanceAddressTitle() {
  return (
    <span>
      采集地址
      <Tooltip title="采集器地址，非业务端口（如 :9100 为 exporter 监听端口，不是您填写的业务端口）">
        <InfoCircleOutlined style={{ marginLeft: 4, color: 'rgba(0,0,0,0.35)', fontSize: 12 }} />
      </Tooltip>
    </span>
  )
}

/**
 * 「恢复时间」列表头：只有「已恢复」是真实恢复时刻；「静默期间结束 / 恢复信息丢失」
 * 是恢复通知缺失时的如实标记，恢复时间留空（不伪造）。
 */
function RecoveryTimeTitle() {
  return (
    <span>
      恢复时间
      <Tooltip title="仅「已恢复」记录有真实恢复时间；告警被静默吞掉恢复通知、或平台未收到恢复消息时，记录会标记为「静默期间结束 / 恢复信息丢失」，恢复时间留空。">
        <InfoCircleOutlined style={{ marginLeft: 4, color: 'rgba(0,0,0,0.35)', fontSize: 12 }} />
      </Tooltip>
    </span>
  )
}

const STATUS_OPTIONS: Array<{ value: 'all' | AlertEventStatus; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'firing', label: alertEventStatusLabel.firing },
  { value: 'silenced', label: alertEventStatusLabel.silenced },
  { value: 'inhibited', label: alertEventStatusLabel.inhibited },
  { value: 'resolved', label: alertEventStatusLabel.resolved },
  { value: 'silenced_closed', label: alertEventStatusLabel.silenced_closed },
  { value: 'lost', label: alertEventStatusLabel.lost },
]

export function HistoryAlertsPage() {
  const { tokens } = useSkin()
  const domains = useNetworkDomains()
  const [networkDomain, setNetworkDomain] = useState<string>('all')
  const [alertName, setAlertName] = useState('')
  const [summary, setSummary] = useState('')
  const [status, setStatus] = useState<'all' | AlertEventStatus>('all')
  const [timeRange, setTimeRange] = useState<[Dayjs, Dayjs]>(defaultTimeRange())

  const query = useMemo(
    () => ({
      networkDomain,
      alertName,
      summary,
      status,
      timeRange,
      page: 1,
      pageSize: 20,
    }),
    [networkDomain, alertName, summary, status, timeRange],
  )

  const { items, total, page, pageSize, loading, error, permissionDenied, reload, setPage, setPageSize } =
    useHistoryAlerts(query)

  // 网域 ID → 名称：优先使用告警标签中的中文展示名 network_domain_name（生成期注入），
  // 存量记录无该标签时按网域 ID 映射 M06 名称；过滤仍传 ID，不受展示影响。
  const domainNameById = useMemo(() => new Map(domains.map((d) => [d.id, d.name])), [domains])

  const columns: ColumnsType<AlertEventItem> = [
    {
      title: '告警名称',
      dataIndex: 'alert_name',
      key: 'alert_name',
      fixed: 'left',
      width: 180,
      render: (v: string) => <EllipsisText maxWidth={160}>{v || '-'}</EllipsisText>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (v: AlertEventStatus) => (
        <Tag color={alertEventStatusColor[v]}>{alertEventStatusLabel[v] ?? v}</Tag>
      ),
    },
    {
      title: '网域',
      dataIndex: 'network_domain',
      key: 'network_domain',
      width: 120,
      render: (_: unknown, record: AlertEventItem) => {
        const display = record.labels?.network_domain_name
        if (display) return <Text>{display}</Text>
        const id = record.network_domain
        return <Text>{id ? (domainNameById.get(id) ?? id) : 'default'}</Text>
      },
    },
    {
      title: '实例名',
      key: 'resource_name',
      width: 150,
      render: (_: unknown, record: AlertEventItem) => (
        <EllipsisText maxWidth={130}>{instanceNameOf(record)}</EllipsisText>
      ),
    },
    {
      title: <InstanceAddressTitle />,
      key: 'instance_address',
      width: 170,
      render: (_: unknown, record: AlertEventItem) => (
        <EllipsisText maxWidth={150}>{instanceAddressOf(record)}</EllipsisText>
      ),
    },
    {
      title: '触发时间',
      dataIndex: 'starts_at',
      key: 'starts_at',
      width: 170,
      render: (v?: string) => <Text>{formatTime(v)}</Text>,
    },
    {
      title: <RecoveryTimeTitle />,
      dataIndex: 'ends_at',
      key: 'ends_at',
      width: 170,
      render: (v?: string) => <Text>{formatTime(v)}</Text>,
    },
    {
      title: '持续时长',
      dataIndex: 'duration_seconds',
      key: 'duration_seconds',
      width: 120,
      render: (v?: number) => <Text>{formatDuration(v)}</Text>,
    },
    {
      title: '摘要',
      dataIndex: 'summary',
      key: 'summary',
      render: (v?: string) => <EllipsisText maxWidth={260}>{v || '-'}</EllipsisText>,
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 170,
      render: (v?: string) => <Text>{formatTime(v)}</Text>,
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
        <Collapse
          ghost
          size="small"
          style={{ marginBottom: 16 }}
          items={[
            {
              key: 'history-note',
              label: (
                <span>
                  <InfoCircleOutlined style={{ color: tokens.colorInfo, marginRight: 8 }} />
                  <Text strong>一次告警发生只保留一行，恢复时回填</Text>
                  <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                    点击展开说明
                  </Text>
                </span>
              ),
              children: (
                <Text>
                  告警触发时留一行；未恢复期间的重复通知不会新增记录；恢复时回填同一行的真实恢复时间。
                  被静默/抑制的告警通知不会发出，由每分钟对账对齐状态；恢复通知缺失时标记「静默期间结束 /
                  恢复信息丢失」，恢复时间留空。历史记录受保留策略限制，超过保留期的记录无法查询。
                </Text>
              ),
            },
          ]}
        />

        {error && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="历史告警加载失败"
            description={error}
            action={
              <Button size="small" onClick={reload}>
                重试
              </Button>
            }
          />
        )}

        <Card>
          <FilterBar>
            <FilterItem label="网域">
              <Select
                style={{ width: 180 }}
                value={networkDomain}
                onChange={setNetworkDomain}
                options={[{ value: 'all', label: '全部网域' }, ...domains.map((d) => ({ value: d.id, label: d.name }))]}
              />
            </FilterItem>
            <FilterItem label="告警名称">
              <Input
                style={{ width: 160 }}
                placeholder="按告警名筛选"
                value={alertName}
                onChange={(e) => setAlertName(e.target.value)}
                allowClear
              />
            </FilterItem>
            <FilterItem label="摘要">
              <Input
                style={{ width: 180 }}
                placeholder="按摘要关键字筛选"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                allowClear
              />
            </FilterItem>
            <FilterItem label="状态">
              <Select
                style={{ width: 150 }}
                value={status}
                onChange={setStatus}
                options={STATUS_OPTIONS}
              />
            </FilterItem>
            <FilterItem label="触发时间">
              <RangePicker
                style={{ width: 340 }}
                showTime={{ format: 'HH:mm' }}
                format="YYYY-MM-DD HH:mm"
                value={timeRange}
                onChange={(vals) => {
                  if (vals && vals[0] && vals[1]) {
                    let start = vals[0]
                    const end = vals[1]
                    if (end.diff(start, 'hour') > 30 * 24) {
                      start = end.subtract(30 * 24, 'hour')
                    }
                    setTimeRange([start, end])
                  }
                }}
                disabledDate={(current) => current && current > dayjs().endOf('day')}
              />
            </FilterItem>
            <FilterItem label="操作">
              <Button icon={<ReloadOutlined />} onClick={reload} loading={loading}>
                刷新
              </Button>
            </FilterItem>
          </FilterBar>

          <Table<AlertEventItem>
            rowKey={(r) => String(r.id)}
            dataSource={items}
            loading={loading}
            columns={columns}
            scroll={TABLE_SCROLL_X}
            pagination={{
              ...TABLE_PAGINATION,
              current: page,
              pageSize,
              total,
              onChange: (p, ps) => {
                setPage(p)
                if (ps) setPageSize(ps)
              },
            }}
            locale={{
              emptyText: loading ? (
                '加载中…'
              ) : error ? (
                <Empty description="暂无历史告警" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : items.length === 0 ? (
                <RuleGuideEmpty description="暂无历史告警" />
              ) : (
                <Empty description="无匹配历史告警" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ),
            }}
          />
        </Card>
      </ConfigProvider>
    </MainLayout>
  )
}

export default HistoryAlertsPage

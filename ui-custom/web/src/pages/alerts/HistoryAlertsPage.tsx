/**
 * 历史告警页（Module_08 v1.13 MVP 增量）。
 * 独立页面展示规则级告警触发/恢复历史（含已恢复），数据由 M02 /api/v1/alerts/history 提供。
 * 列表：告警名称、状态、网域、实例名、采集地址、触发时间、恢复时间（估算）、持续时长、摘要。
 * 筛选：网域 / 告警名 / 实例 / 状态 / 时间范围；默认 24h、最大 7d；手动刷新。
 * 提示：恢复时间为估算值（默认收起的折叠栏 + 列头角标 hover 双入口），
 * 历史深度受 Prometheus TSDB 保留策略限制。
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
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { MainLayout } from '../../layouts/MainLayout'
import type { AlertHistoryItem, AlertHistoryState } from '../../types/alertmanager'
import { useHistoryAlerts, useNetworkDomains, defaultTimeRange } from './useHistoryAlerts'
import { alertHistoryStateColor, alertHistoryStateLabel } from './alertmanagerConstants'

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
 * 回连资源表回填。无 resource_id（拨测 / 聚合 / 自写规则）时显示 '-'——
 * **不回落成地址**，否则与「采集地址」列同值。
 */
function instanceNameOf(item: AlertHistoryItem): string {
  return item.resource_name || '-'
}

/**
 * 采集地址展示（原「实例」列的取值）：优先后端语义化字段 instance_address，
 * 回落兼容字段 instance_display 与既有顶层 instance；聚合 / 全局告警显示「全局/聚合」。
 */
function instanceAddressOf(item: AlertHistoryItem): string {
  if (item.instance_address) return item.instance_address
  if (item.instance_display) return item.instance_display
  if (item.instance) return item.instance
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
 * 「恢复时间」列表头：估算口径 + 保留深度说明降级为列头角标
 * （用户反馈 2026-09-11：独立说明大框没有必要；技术细节仅留本注释，
 * 实现上恢复时间 = 最后一个 firing 样本时间 + 一个求值步长，基于 ALERTS 序列重建）。
 */
function RecoveryTimeTitle() {
  return (
    <span>
      恢复时间（估算）
      <Tooltip title="由系统根据告警最后一次触发状态自动推算，可能与实际恢复时间略有偏差；告警记录只保留一段时间，超过保留期的记录无法查询。">
        <InfoCircleOutlined style={{ marginLeft: 4, color: 'rgba(0,0,0,0.35)', fontSize: 12 }} />
      </Tooltip>
    </span>
  )
}

export function HistoryAlertsPage() {
  const domains = useNetworkDomains()
  const [networkDomain, setNetworkDomain] = useState<string>('all')
  const [alertname, setAlertname] = useState('')
  const [instance, setInstance] = useState('')
  const [state, setState] = useState<'all' | AlertHistoryState>('all')
  const [timeRange, setTimeRange] = useState<[Dayjs, Dayjs]>(defaultTimeRange())

  const query = useMemo(
    () => ({
      networkDomain,
      alertname,
      instance,
      state,
      timeRange,
      page: 1,
      pageSize: 50,
    }),
    [networkDomain, alertname, instance, state, timeRange],
  )

  const { items, total, page, pageSize, loading, error, permissionDenied, reload, setPage, setPageSize } =
    useHistoryAlerts(query)

  const columns: ColumnsType<AlertHistoryItem> = [
    {
      title: '告警名称',
      dataIndex: 'alertname',
      key: 'alertname',
      fixed: 'left',
      width: 180,
      render: (v: string) => <EllipsisText maxWidth={160}>{v || '-'}</EllipsisText>,
    },
    {
      title: '状态',
      dataIndex: 'state',
      key: 'state',
      width: 110,
      render: (v: AlertHistoryState) => <Tag color={alertHistoryStateColor[v]}>{alertHistoryStateLabel[v]}</Tag>,
    },
    {
      title: '网域',
      dataIndex: 'network_domain',
      key: 'network_domain',
      width: 120,
      render: (v: string) => <Text>{v || 'default'}</Text>,
    },
    {
      title: '实例名',
      key: 'resource_name',
      width: 150,
      render: (_: unknown, record: AlertHistoryItem) => <EllipsisText maxWidth={130}>{instanceNameOf(record)}</EllipsisText>,
    },
    {
      title: <InstanceAddressTitle />,
      key: 'instance_address',
      width: 170,
      render: (_: unknown, record: AlertHistoryItem) => (
        <EllipsisText maxWidth={150}>{instanceAddressOf(record)}</EllipsisText>
      ),
    },
    {
      title: '触发时间',
      dataIndex: 'fired_at',
      key: 'fired_at',
      width: 170,
      render: (v: string) => <Text>{formatTime(v)}</Text>,
    },
    {
      title: <RecoveryTimeTitle />,
      dataIndex: 'resolved_at',
      key: 'resolved_at',
      width: 200,
      render: (v?: string) => <Text>{formatTime(v)}</Text>,
    },
    {
      title: '持续时长',
      dataIndex: 'duration_seconds',
      key: 'duration_seconds',
      width: 120,
      render: (v: number) => <Text>{formatDuration(v)}</Text>,
    },
    {
      title: '摘要',
      dataIndex: 'summary',
      key: 'summary',
      render: (v?: string) => <EllipsisText maxWidth={260}>{v || '-'}</EllipsisText>,
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
        <Card style={{ marginBottom: 16 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            历史告警
          </Typography.Title>
        </Card>

        {/* 恢复时间估算口径 / 历史保留深度：低频须知，默认收起的折叠栏指引
            （用户反馈 2026-09-11：页头独立说明板块不需要，折叠栏指引需要）。
            实现细节（ALERTS 序列重建、求值步长、TSDB 保留策略）仅留代码注释，不下沉为用户文案。 */}
        <Collapse
          ghost
          size="small"
          style={{ marginBottom: 16 }}
          items={[
            {
              key: 'recovery-time-note',
              label: (
                <span>
                  <InfoCircleOutlined style={{ color: '#1677ff', marginRight: 8 }} />
                  <Text strong>恢复时间是估算值，仅供参考</Text>
                  <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                    点击展开说明
                  </Text>
                </span>
              ),
              children: (
                <Text>
                  「恢复时间」由系统根据告警最后一次触发状态自动推算，可能与实际恢复时间略有偏差；
                  告警记录只保留一段时间（受系统存储策略限制），超过保留期的记录将无法查询。
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
                value={alertname}
                onChange={(e) => setAlertname(e.target.value)}
                allowClear
              />
            </FilterItem>
            <FilterItem label="实例">
              <Input
                style={{ width: 180 }}
                placeholder="按实例名或采集地址筛选"
                value={instance}
                onChange={(e) => setInstance(e.target.value)}
                allowClear
              />
            </FilterItem>
            <FilterItem label="状态">
              <Select
                style={{ width: 140 }}
                value={state}
                onChange={setState}
                options={[
                  { value: 'all', label: '全部' },
                  { value: 'firing', label: alertHistoryStateLabel.firing },
                  { value: 'resolved', label: alertHistoryStateLabel.resolved },
                ]}
              />
            </FilterItem>
            <FilterItem label="时间范围">
              <RangePicker
                style={{ width: 340 }}
                showTime={{ format: 'HH:mm' }}
                format="YYYY-MM-DD HH:mm"
                value={timeRange}
                onChange={(vals) => {
                  if (vals && vals[0] && vals[1]) {
                    let start = vals[0]
                    let end = vals[1]
                    if (end.diff(start, 'hour') > 7 * 24) {
                      // 超出最大 7d，自动压缩到 7d
                      start = end.subtract(7 * 24, 'hour')
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

          <Table<AlertHistoryItem>
            rowKey={(r) => `${r.alertname}|${r.resource_id || instanceAddressOf(r)}|${r.fired_at}`}
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
              emptyText: loading ? '加载中…' : <Empty description="暂无历史告警" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
            }}
          />
        </Card>
      </ConfigProvider>
    </MainLayout>
  )
}

export default HistoryAlertsPage

/**
 * 历史告警页（Module_08 v1.13 MVP 增量）。
 * 独立页面展示规则级告警触发/恢复历史（含已恢复），数据由 M02 /api/v1/alerts/history 提供。
 * 列表：告警名称、实例、网域、状态、触发时间、恢复时间（按 Prometheus 求值）、持续时长、摘要。
 * 筛选：网域 / 告警名 / 实例 / 状态 / 时间范围；默认 24h、最大 7d；手动刷新。
 * 提示：恢复时间为 Prometheus 求值视角近似值，历史深度受 Prometheus TSDB 保留策略限制。
 */
import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  ConfigProvider,
  DatePicker,
  Empty,
  Input,
  Select,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import config from 'antd/locale/zh_CN'
import { ReloadOutlined } from '@ant-design/icons'
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

/** 实例展示：优先后端 instance_display，否则按常见标签键依次回落；聚合告警显示「全局/聚合」 */
function instanceDisplay(item: AlertHistoryItem): string {
  if (item.instance_display) return item.instance_display
  if (item.instance) return item.instance
  return '全局/聚合'
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
      title: '实例',
      dataIndex: 'instance',
      key: 'instance',
      width: 170,
      render: (_: string, record: AlertHistoryItem) => <EllipsisText maxWidth={150}>{instanceDisplay(record)}</EllipsisText>,
    },
    {
      title: '触发时间',
      dataIndex: 'fired_at',
      key: 'fired_at',
      width: 170,
      render: (v: string) => <Text>{formatTime(v)}</Text>,
    },
    {
      title: '恢复时间（按 Prometheus 求值）',
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
          <Text type="secondary">
            查看规则级告警的触发与恢复历史（含已恢复），回答「这条告警什么时候触发、什么时候恢复」。
          </Text>
        </Card>

        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="恢复时间为 Prometheus 求值视角的近似值"
          description={
            <span>
              历史告警基于 Prometheus <code>ALERTS</code> 时间序列重建触发区间；「恢复时间」为最后一个 firing 样本时间加一个求值步长，
              <strong>不等同于故障真实恢复时间</strong>。历史深度受中心 Prometheus TSDB 保留策略限制，超过保留期的告警将无法查询。
            </span>
          }
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
                style={{ width: 160 }}
                placeholder="按实例筛选"
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
            rowKey={(r) => `${r.alertname}|${r.instance}|${r.fired_at}`}
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

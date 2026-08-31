import { useMemo, useState } from 'react'
import {
  Card,
  Table,
  Tag,
  Select,
  Space,
  Typography,
  Tooltip,
  Drawer,
  Descriptions,
  Row,
  Col,
  Alert,
} from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, QuestionCircleOutlined, LineChartOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { useTenant } from '../contexts/TenantContext'
import { scrapeTargets, coverageStats, type TargetStatus, type ScrapeTarget } from '../mocks/module-02'

const { Text } = Typography

const statusConfig: Record<TargetStatus, { color: string; icon: React.ReactNode; label: string }> = {
  up: { color: 'success', icon: <CheckCircleOutlined />, label: 'Up' },
  down: { color: 'error', icon: <CloseCircleOutlined />, label: 'Down' },
  unknown: { color: 'default', icon: <QuestionCircleOutlined />, label: 'Unknown' },
}

const networkDomains = Array.from(new Set(scrapeTargets.map((t) => t.network_domain)))
const jobs = Array.from(new Set(scrapeTargets.map((t) => t.job)))

export function TargetsPage() {
  const { multiSiteEnabled } = useTenant()
  const [domainFilter, setDomainFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<TargetStatus | 'all'>('all')
  const [jobFilter, setJobFilter] = useState<string>('all')
  const [selected, setSelected] = useState<ScrapeTarget | null>(null)

  // 单网域模式：仅展示 default 网域目标，网域筛选固定 default（对用户透明）
  const effectiveDomains = useMemo(() => (multiSiteEnabled ? networkDomains : ['default']), [multiSiteEnabled])
  const activeDomain = multiSiteEnabled ? domainFilter : 'default'

  const filteredTargets = useMemo(() => {
    return scrapeTargets.filter((target) => {
      if (!effectiveDomains.includes(target.network_domain)) return false
      const matchDomain = activeDomain === 'all' || target.network_domain === activeDomain
      const matchStatus = statusFilter === 'all' || target.status === statusFilter
      const matchJob = jobFilter === 'all' || target.job === jobFilter
      return matchDomain && matchStatus && matchJob
    })
  }, [statusFilter, jobFilter, effectiveDomains, activeDomain])

  // 采集覆盖率（PRD 3.1，决策 47-3 提前到 MVP：M07 三态 badge 数据来源）
  const coverage = useMemo(() => {
    return coverageStats
      .filter((s) => effectiveDomains.includes(s.domain))
      .reduce(
        (acc, s) => ({
          monitored_up: acc.monitored_up + s.monitored_up,
          monitored_down: acc.monitored_down + s.monitored_down,
          unmonitored: acc.unmonitored + s.unmonitored,
        }),
        { monitored_up: 0, monitored_down: 0, unmonitored: 0 },
      )
  }, [effectiveDomains])

  const coverageTotal = coverage.monitored_up + coverage.monitored_down + coverage.unmonitored

  return (
    <MainLayout>
      <Space direction="vertical" size="large" style={{ display: 'flex' }}>
        {/* 决策 47-4：目标状态页由 P0 → P1（配置场景知情权由 M01 回显、资产场景由 M07 badge 承接），本页收敛为跨 Job 全局排障入口 */}
        <Alert
          type="info"
          showIcon
          message="本页为跨 Job 全局排障入口"
          description="单个 Job 的实例采集状态请在「监控策略（Module_01）」Job 详情/编辑抽屉中查看；资源维度的采集状态请在「资源列表（Module_07）」查看。两类场景均有专属入口后，本页定位收敛为全局排障视图。"
        />

        {/* 采集覆盖率（决策 47-3：健康度/覆盖率查询 API 由 v0.2 提前到 MVP） */}
        <Card size="small" title="监控覆盖率" extra={<Tag color="blue">MVP · M07 三态 badge 联动</Tag>}>
          <Row gutter={16}>
            <Col span={8}>
              <Card size="small" className="bg-success-light">
                <Space direction="vertical" size={4}>
                  <Text type="secondary">已监控且 Up</Text>
                  <Text strong style={{ fontSize: 24, color: '#00B578' }}>
                    {coverage.monitored_up}
                  </Text>
                </Space>
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small" className="bg-error-light">
                <Space direction="vertical" size={4}>
                  <Text type="secondary">已监控但 Down</Text>
                  <Text strong style={{ fontSize: 24, color: '#FF4C3A' }}>
                    {coverage.monitored_down}
                  </Text>
                </Space>
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small" className="bg-info-light">
                <Space direction="vertical" size={4}>
                  <Text type="secondary">未监控</Text>
                  <Text strong style={{ fontSize: 24, color: '#1481FD' }}>
                    {coverage.unmonitored}
                  </Text>
                </Space>
              </Card>
            </Col>
          </Row>
          <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
            覆盖率：{((coverage.monitored_up + coverage.monitored_down) / Math.max(coverageTotal, 1)) * 100}% ｜ 基于
            `up` 指标聚合，MVP 起由 Module_02 提供查询 API（决策 47-3 提前），Module_07 Resource 列表消费做三态 badge。
          </Text>
        </Card>

        <Card
          title="目标状态（Targets）"
          extra={
            <Space>
              <span className="text-secondary">网域：</span>
              <Select
                value={activeDomain}
                onChange={setDomainFilter}
                style={{ width: 160 }}
                disabled={!multiSiteEnabled}
                options={[{ value: 'all', label: '全部' }, ...effectiveDomains.map((d) => ({ value: d, label: d }))]}
              />
              <span className="text-secondary">Job：</span>
              <Select
                value={jobFilter}
                onChange={setJobFilter}
                style={{ width: 160 }}
                options={[{ value: 'all', label: '全部' }, ...jobs.map((j) => ({ value: j, label: j }))]}
              />
              <span className="text-secondary">状态：</span>
              <Select
                value={statusFilter}
                onChange={setStatusFilter}
                style={{ width: 120 }}
                options={[
                  { value: 'all', label: '全部' },
                  { value: 'up', label: 'Up' },
                  { value: 'down', label: 'Down' },
                  { value: 'unknown', label: 'Unknown' },
                ]}
              />
            </Space>
          }
        >
          {!multiSiteEnabled && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="单网域模式：仅展示 default 网域目标（租户无网域概念，注入对用户透明）"
            />
          )}
          <Table
            dataSource={filteredTargets}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 10 }}
            onRow={(record) => ({ onClick: () => setSelected(record), style: { cursor: 'pointer' } })}
            columns={[
              { title: 'Job', dataIndex: 'job', key: 'job' },
              { title: 'Instance', dataIndex: 'instance', key: 'instance' },
              {
                title: '状态',
                dataIndex: 'status',
                key: 'status',
                render: (status: TargetStatus) => {
                  const cfg = statusConfig[status]
                  return (
                    <Tag color={cfg.color} icon={cfg.icon}>
                      {cfg.label}
                    </Tag>
                  )
                },
              },
              { title: '最后采集', dataIndex: 'last_scrape', key: 'last_scrape' },
              {
                title: '采集时长',
                dataIndex: 'scrape_duration_seconds',
                key: 'scrape_duration_seconds',
                render: (v: number) => <Text type="secondary">{v.toFixed(2)}s</Text>,
              },
              {
                title: '拨测结果',
                key: 'probe',
                render: (_: unknown, t: ScrapeTarget) =>
                  typeof t.probe_success === 'boolean' ? (
                    <Space size={4}>
                      <Tag color={t.probe_success ? 'success' : 'error'} icon={<LineChartOutlined />}>
                        {t.probe_success ? '成功' : '失败'}
                      </Tag>
                      {typeof t.probe_duration_seconds === 'number' && (
                        <Text type="secondary">{t.probe_duration_seconds.toFixed(2)}s</Text>
                      )}
                    </Space>
                  ) : (
                    <Text type="secondary">-</Text>
                  ),
              },
              {
                title: '最后错误',
                dataIndex: 'last_error',
                key: 'last_error',
                render: (error: string) =>
                  error ? (
                    <Tooltip title={error}>
                      <Text type="danger" ellipsis style={{ maxWidth: 220 }}>
                        {error}
                      </Text>
                    </Tooltip>
                  ) : (
                    <Text type="secondary">-</Text>
                  ),
              },
              { title: '网域', dataIndex: 'network_domain', key: 'network_domain' },
              {
                title: '标签',
                dataIndex: 'labels',
                key: 'labels',
                render: (labels: Record<string, string>) => (
                  <Space size={[0, 4]} wrap>
                    {Object.entries(labels).map(([key, value]) => (
                      <Tag key={key} color="blue">{`${key}=${value}`}</Tag>
                    ))}
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      </Space>

      {/* 采集诊断（PRD 3.2：lastError / HTTP 状态码 / 抓取时长） */}
      <Drawer title="目标详情 / 采集诊断" open={!!selected} onClose={() => setSelected(null)} width={480}>
        {selected && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Job">{selected.job}</Descriptions.Item>
            <Descriptions.Item label="Instance">{selected.instance}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={statusConfig[selected.status].color} icon={statusConfig[selected.status].icon}>
                {statusConfig[selected.status].label}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="所属网域">{selected.network_domain}</Descriptions.Item>
            <Descriptions.Item label="最后采集">{selected.last_scrape}</Descriptions.Item>
            <Descriptions.Item label="采集时长">{selected.scrape_duration_seconds.toFixed(2)}s</Descriptions.Item>
            {typeof selected.probe_http_status_code === 'number' && (
              <Descriptions.Item label="HTTP 状态码">{selected.probe_http_status_code}</Descriptions.Item>
            )}
            <Descriptions.Item label="抓取错误">
              {selected.last_error ? <Text type="danger">{selected.last_error}</Text> : <Text type="secondary">无</Text>}
            </Descriptions.Item>
            <Descriptions.Item label="标签">
              <Space size={[0, 4]} wrap>
                {Object.entries(selected.labels).map(([key, value]) => (
                  <Tag key={key} color="blue">{`${key}=${value}`}</Tag>
                ))}
              </Space>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </MainLayout>
  )
}

export default TargetsPage

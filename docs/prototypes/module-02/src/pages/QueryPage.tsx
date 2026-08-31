import { useState } from 'react'
import { Card, Input, Button, Table, Tabs, Select, Space, Tag, Empty, message, Alert, Typography, Descriptions } from 'antd'
import { HistoryOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { ReviewNote } from '../components/ReviewNote'
import { useTenant } from '../contexts/TenantContext'
import { queryEnvelope, queryTemplates, type QueryRecord, type DataSourceType } from '../mocks/module-02'

const { Text } = Typography

export function QueryPage() {
  const [expr, setExpr] = useState('node_cpu_seconds_total{mode="idle"}')
  const [activeTab, setActiveTab] = useState('table')
  const [dataSourceDemo, setDataSourceDemo] = useState<DataSourceType>('central_scrape')
  const [authScope, setAuthScope] = useState<'all' | 'subset'>('all')
  const { multiSiteEnabled } = useTenant()

  const dataSource = queryEnvelope.data.result as QueryRecord[]
  const allowedDomains = multiSiteEnabled ? ['default', 'gov-cloud-a'] : ['default']
  // 网域授权集合收敛（决策 56 语义）：授权=全部网域时信封回显全部授权网域；仅授权部分网域时信封只回显已授权网域
  const envelopeDomains = authScope === 'all' ? allowedDomains : ['gov-cloud-a']

  // 动态 envelope：MVP 恒 central_scrape；v0.2 演示 edge_remote_write（数据来源细化到网域）
  const displayEnvelope = {
    ...queryEnvelope,
    meta: {
      ...queryEnvelope.meta,
      data_source: dataSourceDemo,
      network_domains: envelopeDomains,
    },
  }

  const columns = [
    { title: '指标名', dataIndex: ['metric', '__name__'], key: '__name__' },
    { title: '实例', dataIndex: ['metric', 'instance'], key: 'instance' },
    { title: '模式', dataIndex: ['metric', 'mode'], key: 'mode' },
    { title: '网域', dataIndex: ['metric', 'network_domain'], key: 'network_domain' },
    { title: '来源类型', dataIndex: ['metric', 'source_type'], key: 'source_type' },
    {
      title: '数值',
      key: 'value',
      render: (_: unknown, record: QueryRecord) => {
        const last = record.values[record.values.length - 1]
        return last ? last[1] : '-'
      },
    },
  ]

  const handleExecute = () => {
    message.success('查询已执行')
  }

  const handleTemplateSelect = (value: string) => {
    setExpr(value)
  }

  return (
    <MainLayout>
      <Card title="PromQL 查询中心">
        <Space direction="vertical" size="large" style={{ display: 'flex' }}>
          {/* 自动注入提示（PRD 5.2：系统注入 = 权限隔离；决策 56 注入三层语义） */}
          <Card
            size="small"
            title="查询上下文注入（服务端强制）"
            extra={
              <Space>
                <span className="text-secondary">网域授权范围：</span>
                <Select
                  value={authScope}
                  onChange={setAuthScope}
                  style={{ width: 180 }}
                  options={[
                    { value: 'all', label: '授权全部网域' },
                    { value: 'subset', label: '仅授权部分网域' },
                  ]}
                />
              </Space>
            }
          >
            <Space direction="vertical" size={8} style={{ display: 'flex' }}>
              <Space wrap>
                <Tag color="red" style={{ fontWeight: 600 }}>
                  租户隔离（硬边界）
                </Tag>
                <Tag color="red">tenant_id="tenant-a"</Tag>
                <Text type="secondary">服务端强制注入，用户不可见、不可改，始终生效</Text>
              </Space>
              <Space wrap>
                <Tag color="purple" style={{ fontWeight: 600 }}>
                  网域授权（软边界）
                </Tag>
                {authScope === 'all' ? (
                  <>
                    <Tag color="green">不注入网域 matcher</Tag>
                    <Text type="secondary">
                      授权=全部网域，与裸查 Prometheus 一致，跨网域业务聚合（如 sum by (biz)）天然成立
                    </Text>
                  </>
                ) : (
                  <>
                    <Tag color="purple">network_domain=~"gov-cloud-a"</Tag>
                    <Text type="secondary">收敛到已授权网域，超出部分服务端过滤、返回空</Text>
                  </>
                )}
              </Space>
              <Space wrap>
                <Tag color="blue" style={{ fontWeight: 600 }}>
                  前端网域筛选
                </Tag>
                <Text type="secondary">纯交互体验，在已授权网域内下钻/聚合，不承担任何安全职责</Text>
              </Space>
            </Space>
          </Card>

          <ReviewNote title="设计说明：注入三层语义与上下游边界">
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li>租户隔离：tenant_id 服务端强制注入，是平台硬隔离边界，用户不可见不可改；MVP 恒为 tenant-a，v0.2 多租户启用后由登录身份自动解析。</li>
              <li>网域授权集合收敛：服务端强制校验「查询结果不得越出用户授权网域集合」。授权集合=全部网域时不注入任何 matcher，与裸查 Prometheus 一致，跨网域业务聚合天然成立；用户显式 matcher 收敛于授权集合，越权部分返回空。</li>
              <li>前端筛选 = 视觉遮蔽（curl 即绕过），不构成权限；安全必须服务端执行（红线）。</li>
              <li>告警语义（决策 55）：告警状态页归 Module_08「告警域工作台」；Module_02 仅交付 /api/v1/alerts 注入代理 API，告警完全退出本模块 UI 叙事（原「当前告警」改为跨模块入口跳转 M08）。</li>
              <li>M08 侧约束（决策 56 托盘）：AM 代理读路径服务端强制注入授权 filter，写路径创建静默/抑制时校验 matcher 收敛于授权网域（防跨租户写武器），不信任前端传参。</li>
              <li>拓扑与存储（决策 57）：「1 控制面 + N 采集节点」扁平拓扑；中心存储预留替换 VictoriaMetrics——M02 注入代理作防腐层，替换时消费方零改动；隔离契约保持标签制（tenant_id/network_domain 由 M09 external_labels 写入侧打标、M02 查询侧校验），换存储不改契约；M08 前期维持文件化配置形态。</li>
            </ul>
          </ReviewNote>

          <Space.Compact style={{ width: '100%' }}>
            <Select
              defaultValue="instant"
              style={{ width: 120 }}
              options={[
                { value: 'instant', label: 'Instant' },
                { value: 'range', label: 'Range' },
              ]}
            />
            <Input value={expr} onChange={(e) => setExpr(e.target.value)} placeholder="输入 PromQL 表达式" />
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleExecute}>
              执行查询
            </Button>
          </Space.Compact>

          {/* 查询辅助（PRD 3.1，v0.3 交付：指标名补全 / 标签建议 / 常用模板） */}
          <Space>
            <HistoryOutlined style={{ color: '#86909C' }} />
            <span className="text-secondary">常用模板：</span>
            <Select
              placeholder="选择查询模板"
              style={{ width: 320 }}
              options={queryTemplates.map((q) => ({ value: q.expr, label: q.name }))}
              onChange={handleTemplateSelect}
              allowClear
            />
            <Tag color="orange">查询辅助 v0.3</Tag>
          </Space>

          <ReviewNote title="设计说明：查询能力归属边界与跨网域语义">
            {/* 决策 51 / v1.6：三层归属（自研查询=M02 / 大屏嵌入=M05 / 告警规则=M08）+ 跨网域看板不受注入影响 */}
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li>自研查询（M02）：门户 PromQL 查询页 + 轻量实时图表（ECharts / AntV）消费 query_range；指标查询与轻量图表归本模块，复杂面板不自研。</li>
              <li>大屏 / 复杂看板嵌入（M05）：Grafana iframe 嵌入「监控大屏」入口；Grafana 数据源必须指向 M02 查询代理，禁止直连 Prometheus（否则租户 / 网域注入被绕过）。</li>
              <li>告警规则（M08）：规则求值、通知与分组静默，深链接入规则编辑；告警规则不引向 Grafana 看板，由规则模块独立承接。</li>
              <li>跨网域业务看板不受网域注入影响：系统注入用于权限收敛，未显式写网域筛选时查询默认覆盖全部授权网域，跨网域聚合（如 sum by (biz) 按业务维度汇总）天然成立；网域仅作为可选下钻维度使用。</li>
            </ul>
          </ReviewNote>

          {/* 数据来源与新鲜度演示（PRD 6.2/6.3） */}
          <Card size="small" title="响应 Envelope 与数据新鲜度">
            <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
              <Space wrap>
                <span className="text-secondary">演示数据来源：</span>
                <Select
                  value={dataSourceDemo}
                  onChange={setDataSourceDemo}
                  style={{ width: 200 }}
                  options={[
                    { value: 'central_scrape', label: 'central_scrape（MVP 默认）' },
                    { value: 'edge_remote_write', label: 'edge_remote_write（v0.2 演示）' },
                  ]}
                />
              </Space>
              {dataSourceDemo === 'edge_remote_write' && (
                <Alert
                  type="warning"
                  showIcon
                  message="数据为边缘异步写入，可能存在延迟"
                  description="区别于即时抓取，异步写入会导致 freshness_at 滞后；此时 UI 需要区分「无数据」与「数据旧」两种状态。"
                />
              )}
              <Descriptions
                size="small"
                column={1}
                items={[
                  {
                    key: 'ds',
                    label: 'data_source',
                    children: <Tag color={dataSourceDemo === 'central_scrape' ? 'blue' : 'orange'}>{dataSourceDemo}</Tag>,
                  },
                  { key: 'fa', label: 'freshness_at', children: displayEnvelope.meta.freshness_at },
                  {
                    key: 'nd',
                    label: 'network_domains',
                    children: (
                      <Space wrap>
                        {displayEnvelope.meta.network_domains.map((d) => (
                          <Tag key={d} color="purple">{d}</Tag>
                        ))}
                        <Text type="secondary">（MVP 单网域恒为 [default]；v1.2 由单值 network_domain 调整为数组，适配多网域）</Text>
                      </Space>
                    ),
                  },
                  {
                    key: 'sd',
                    label: 'data_source_by_domain',
                    children: (
                      <Space wrap>
                        {Object.entries(queryEnvelope.meta.data_source_by_domain ?? {}).map(([domain, src]) => (
                          <Tag key={domain}>{domain} → {src}</Tag>
                        ))}
                        <Text type="secondary">（v0.2：数据来源细化到网域维度）</Text>
                      </Space>
                    ),
                  },
                ]}
              />
            </Space>
          </Card>

          <ReviewNote title="设计说明：响应 envelope 元数据语义">
            {/* 决策 50 / v1.5 / PRD §8.2：MVP envelope 最小口径 */}
            <p style={{ margin: 0 }}>
              MVP 阶段 envelope 元数据按最小集落地：data_source 恒为 central_scrape、network_domains 恒为 [default]、freshness_at
              取查询结果中最新的样本时间戳（结果为空时为 null）；v0.2 起细化到网域 / 多数据源，结构在 MVP 即固定，避免下游改动。
            </p>
          </ReviewNote>

          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              {
                key: 'table',
                label: '表格',
                children: (
                  <Table<QueryRecord>
                    dataSource={dataSource}
                    rowKey={(record) => JSON.stringify(record.metric)}
                    columns={columns}
                    size="small"
                    pagination={{ pageSize: 10 }}
                  />
                ),
              },
              {
                key: 'json',
                label: 'JSON',
                children: (
                  <pre className="yaml-preview" style={{ margin: 0, maxHeight: 480, overflow: 'auto' }}>
                    {JSON.stringify(displayEnvelope, null, 2)}
                  </pre>
                ),
              },
              {
                key: 'chart',
                label: '简单折线',
                children: (
                  <Empty description="简单折线占位：集成图表库后可渲染时序曲线">
                    <div
                      style={{
                        height: 200,
                        background: '#F7F8FA',
                        borderRadius: 8,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <span className="text-tertiary">时序图表占位区域（首页 Dashboard 数据 v0.3）</span>
                    </div>
                  </Empty>
                ),
              },
            ]}
          />
        </Space>
      </Card>
    </MainLayout>
  )
}

export default QueryPage

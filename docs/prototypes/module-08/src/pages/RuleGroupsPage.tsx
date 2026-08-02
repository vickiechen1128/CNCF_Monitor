import { useState } from 'react'
import { Card, Table, Tag, Typography } from 'antd'
import { MainLayout } from '../layouts/MainLayout'
import { type AlertingRule, type AlertScope, type AlertSeverity, mockRuleGroups } from '../mocks/module-08'

const { Title } = Typography

const severityColors: Record<AlertSeverity, string> = {
  critical: '#FF4C3A',
  warning: '#FA8C16',
  info: '#1481FD',
}

const severityLabels: Record<AlertSeverity, string> = {
  critical: '严重',
  warning: '警告',
  info: '提示',
}

const scopeColors: Record<AlertScope, string> = {
  central: '#1481FD',
  edge: '#0ECDEB',
  both: '#7B61FF',
}

const scopeLabels: Record<AlertScope, string> = {
  central: '中心',
  edge: '边缘',
  both: '全域',
}

export default function RuleGroupsPage() {
  const [groups] = useState(mockRuleGroups)

  const expandedRowRender = (record: (typeof groups)[number]) => {
    const ruleColumns = [
      { title: '告警名称', dataIndex: 'alert_name', key: 'alert_name' },
      { title: '表达式', dataIndex: 'expr', key: 'expr', ellipsis: true },
      {
        title: '严重级别',
        dataIndex: 'severity',
        key: 'severity',
        render: (severity: AlertSeverity) => (
          <Tag color={severityColors[severity]}>{severityLabels[severity]}</Tag>
        ),
      },
      { title: '持续时间', dataIndex: 'duration', key: 'duration' },
      {
        title: '作用域',
        dataIndex: 'scope',
        key: 'scope',
        render: (scope: AlertScope) => scopeLabels[scope],
      },
      {
        title: '启用',
        dataIndex: 'enabled',
        key: 'enabled',
        render: (enabled: boolean) => (enabled ? '是' : '否'),
      },
    ]

    return (
      <Card size="small" title="组内规则" bordered={false}>
        <Table<AlertingRule>
          rowKey="id"
          dataSource={record.rules}
          columns={ruleColumns}
          pagination={false}
          size="small"
        />
      </Card>
    )
  }

  const columns = [
    {
      title: '规则组名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '网域',
      dataIndex: 'network_domain_id',
      key: 'network_domain_id',
    },
    {
      title: '评估间隔',
      dataIndex: 'interval',
      key: 'interval',
      render: (interval: number) => `${interval}s`,
    },
    {
      title: '规则数',
      key: 'ruleCount',
      render: (_: unknown, record: (typeof groups)[number]) => record.rules.length,
    },
    {
      title: '作用域分布',
      key: 'scopeDistribution',
      render: (_: unknown, record: (typeof groups)[number]) => {
        const scopes = Array.from(new Set(record.rules.map((r) => r.scope)))
        return (
          <>
            {scopes.map((scope) => (
              <Tag key={scope} color={scopeColors[scope]}>
                {scopeLabels[scope]}
              </Tag>
            ))}
          </>
        )
      },
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>规则组</Title>
      </div>
      <Card className="page-card">
        <Table
          rowKey="id"
          dataSource={groups}
          columns={columns}
          expandable={{ expandedRowRender }}
          pagination={{ pageSize: 10 }}
        />
      </Card>
    </MainLayout>
  )
}

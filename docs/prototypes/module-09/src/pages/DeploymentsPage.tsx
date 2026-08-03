import { useMemo, useState } from 'react'
import { Card, Table, Tag, Button, Space, Modal, message, Tooltip, Typography } from 'antd'
import { RollbackOutlined, EyeOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { configDeployments, configVersions, networkDomains, type ConfigDeployment, type DeploymentStatus } from '../mocks/module-09'

const { Text } = Typography

const statusColor: Record<DeploymentStatus, string> = {
  pending: 'default',
  running: 'processing',
  success: 'success',
  failed: 'error',
  rolled_back: 'warning',
}

const statusLabel: Record<DeploymentStatus, string> = {
  pending: '待执行',
  running: '执行中',
  success: '成功',
  failed: '失败',
  rolled_back: '已回滚',
}

export function DeploymentsPage() {
  const [data, setData] = useState<ConfigDeployment[]>(configDeployments)

  const versionMap = useMemo(() => {
    return Object.fromEntries(configVersions.map((v) => [v.id, v.id]))
  }, [])

  const domainMap = useMemo(() => {
    return Object.fromEntries(networkDomains.map((d) => [d.id, d.name]))
  }, [])

  const handleRollback = (record: ConfigDeployment) => {
    const previousVersions = configVersions
      .filter((v) => v.network_domain_id === record.network_domain_id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
    const previous = previousVersions.find((v) => v.id !== record.config_version_id)

    Modal.confirm({
      title: '回滚配置',
      content: previous ? (
        <>
          确定将网域 <Text strong>{domainMap[record.network_domain_id]}</Text> 回滚到版本{' '}
          <Text code>{previous.id}</Text> 吗？
        </>
      ) : (
        '未找到可回滚的历史版本。'
      ),
      okText: '确认回滚',
      okType: 'primary',
      cancelText: '取消',
      onOk: () => {
        if (!previous) {
          message.warning('无可用回滚版本')
          return
        }
        const now = new Date().toLocaleString('zh-CN', { hour12: false })
        const rollbackDeployment: ConfigDeployment = {
          id: `deploy-${Date.now()}`,
          network_domain_id: record.network_domain_id,
          config_version_id: previous.id,
          target_type: record.target_type,
          target_address: record.target_address,
          status: 'success',
          error_message: '',
          triggered_by: 'admin',
          triggered_at: now,
          completed_at: now,
          created_at: now,
        }
        setData((prev) =>
          prev.map((item) =>
            item.id === record.id ? { ...item, status: 'rolled_back' } : item
          )
        )
        setData((prev) => [rollbackDeployment, ...prev])
        message.success('已回滚到上一版本')
      },
    })
  }

  return (
    <MainLayout>
      <Card title="配置下发记录">
        <Table
          dataSource={data}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10 }}
          columns={[
            { title: '部署 ID', dataIndex: 'id', key: 'id' },
            {
              title: '网域',
              dataIndex: 'network_domain_id',
              key: 'network_domain_id',
              render: (id: string) => <Text>{domainMap[id] ?? id}</Text>,
            },
            {
              title: '配置版本',
              dataIndex: 'config_version_id',
              key: 'config_version_id',
              render: (id: string) => <Tag>{versionMap[id] ?? id}</Tag>,
            },
            {
              title: '目标类型',
              dataIndex: 'target_type',
              key: 'target_type',
              render: (type: string) => <Tag color="blue">{type}</Tag>,
            },
            { title: '目标地址', dataIndex: 'target_address', key: 'target_address' },
            {
              title: '状态',
              dataIndex: 'status',
              key: 'status',
              render: (status: DeploymentStatus) => <Tag color={statusColor[status]}>{statusLabel[status]}</Tag>,
            },
            {
              title: '错误信息',
              dataIndex: 'error_message',
              key: 'error_message',
              render: (error: string) =>
                error ? (
                  <Tooltip title={error}>
                    <Text type="danger" ellipsis style={{ maxWidth: 160 }}>
                      {error}
                    </Text>
                  </Tooltip>
                ) : (
                  <Text type="secondary">-</Text>
                ),
            },
            { title: '操作人', dataIndex: 'triggered_by', key: 'triggered_by' },
            { title: '开始时间', dataIndex: 'triggered_at', key: 'triggered_at' },
            { title: '结束时间', dataIndex: 'completed_at', key: 'completed_at' },
            {
              title: '操作',
              key: 'action',
              render: (_: unknown, record: ConfigDeployment) => (
                <Space>
                  <Tooltip title="查看详情（原型演示）">
                    <Button size="small" icon={<EyeOutlined />} />
                  </Tooltip>
                  <Button
                    size="small"
                    icon={<RollbackOutlined />}
                    disabled={record.status === 'rolled_back' || record.status === 'pending'}
                    onClick={() => handleRollback(record)}
                  >
                    回滚
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </MainLayout>
  )
}

export default DeploymentsPage

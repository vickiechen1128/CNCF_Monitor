import { useMemo, useState } from 'react'
import { Card, Table, Tag, Button, Space, Modal, message, Tooltip, Typography, Alert } from 'antd'
import { RollbackOutlined, EyeOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  configDeployments,
  configVersions,
  networkDomains,
  type ConfigDeployment,
  type DeploymentStatus,
  type DeploymentValidationStatus,
} from '../mocks/module-09'

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

const validationColor: Record<DeploymentValidationStatus, string> = {
  passed: 'success',
  failed: 'error',
  pending: 'default',
}

const validationLabel: Record<DeploymentValidationStatus, string> = {
  passed: '校验通过',
  failed: '校验失败',
  pending: '待校验',
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
    // {v1.20} 回滚生效语义按域类型区分：管理域立即 reload；边缘域待 Agent 下次心跳拉取
    const isEdge = networkDomains.find((d) => d.id === record.network_domain_id)?.domain_type === 'edge'

    Modal.confirm({
      title: '回滚配置',
      content: previous ? (
        <>
          确定将网域 <Text strong>{domainMap[record.network_domain_id]}</Text> 回滚到版本{' '}
          <Text code>{previous.id}</Text> 吗？
          {isEdge && (
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                边缘域回滚：确认后发布历史版本，待边缘 Agent 下次心跳拉取后生效（准实时 30s），进度可在 Agent 状态页查看。
              </Text>
            </div>
          )}
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
          source_change_no: previous.change_no,
          target_type: record.target_type,
          target_address: record.target_address,
          status: 'success',
          validation_status: 'passed',
          validation_error: '',
          includes_blackbox: record.includes_blackbox,
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
        // {v1.20} 回滚结果提示按域类型区分
        message.success(
          isEdge
            ? '已回滚：已发布历史版本，待边缘 Agent 下次心跳拉取生效'
            : '已回滚到上一版本，配置已 reload 生效'
        )
      },
    })
  }

  return (
    <MainLayout>
      <Alert
        type="info"
        showIcon
        message="本页定位：回滚中心 + 配置变更执行台账"
        description="每次「配置变更确认」发布到监控，以及每次回滚，都会在此自动留痕（谁 / 何时 / 发布或回滚了哪个配置版本 / 结果如何）。日常无需查看，但出问题时用于排查「配置最后一次生效时间与结果」，需要时可按历史版本一键回滚（回滚动作本身也是一条记录）。本页为 Module_09 的领域审计（配置版本执行历史）；平台级操作审计由 Module_06 统一负责，二者联动不重复。"
        style={{ marginBottom: 16 }}
      />
      <Card title="配置发布与回滚记录">
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
              title: (
                <Tooltip title="来源变更单号（CHG-…）：该配置版本由哪个变更单确认后发布；业务出问题时据此从变更确认页回溯「为什么变了、谁确认的」">
                  <Space size={4}>
                    来源变更单号
                    <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
                  </Space>
                </Tooltip>
              ),
              dataIndex: 'source_change_no',
              key: 'source_change_no',
              render: (no: string) => <Text code>{no}</Text>,
            },
            {
              title: '目标类型',
              dataIndex: 'target_type',
              key: 'target_type',
              render: (type: string) => <Tag color="blue">{type}</Tag>,
            },
            { title: '目标地址', dataIndex: 'target_address', key: 'target_address' },
            {
              title: '下发前校验',
              dataIndex: 'validation_status',
              key: 'validation_status',
              render: (validation: DeploymentValidationStatus, record) => (
                <Tooltip title={record.validation_error || '下发前校验（配置文件语法与目标格式检查）'}>
                  <Tag color={validationColor[validation]}>{validationLabel[validation]}</Tag>
                </Tooltip>
              ),
            },
            {
              title: '含 blackbox.yml',
              dataIndex: 'includes_blackbox',
              key: 'includes_blackbox',
              render: (includes: boolean) =>
                includes ? <Tag color="cyan">是</Tag> : <Text type="secondary">否</Text>,
            },
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
                  <Tooltip title="查看详情">
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

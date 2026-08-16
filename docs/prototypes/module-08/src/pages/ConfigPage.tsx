import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Drawer,
  Descriptions,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { HistoryOutlined, ReloadOutlined, EyeOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  currentAlertmanagerYaml,
  mockConfigVersions,
  type AlertmanagerConfigVersion,
} from '../mocks/module-08'

const { Title, Text } = Typography

function shortChecksum(checksum: string) {
  return checksum.length > 16 ? `${checksum.slice(0, 8)}...${checksum.slice(-8)}` : checksum
}

export default function ConfigPage() {
  const [versions] = useState<AlertmanagerConfigVersion[]>(mockConfigVersions)
  const [viewing, setViewing] = useState<AlertmanagerConfigVersion | null>(null)

  const latest = useMemo(
    () => versions.filter((v) => v.status === 'applied').sort((a, b) => b.applied_at.localeCompare(a.applied_at))[0],
    [versions]
  )

  const columns = [
    {
      title: '版本',
      dataIndex: 'version',
      key: 'version',
      width: 90,
      render: (version: string) => (
        <Text code>{version}</Text>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (status: AlertmanagerConfigVersion['status'], record: AlertmanagerConfigVersion) =>
        status === 'applied' ? (
          <Tooltip title={record.id === latest?.id ? '当前生效版本' : '历史已生效版本'}>
            <Tag color="success">{record.id === latest?.id ? '生效中' : '已生效'}</Tag>
          </Tooltip>
        ) : (
          <Tooltip title={record.error_msg}>
            <Tag color="error">reload 失败</Tag>
          </Tooltip>
        ),
    },
    { title: '应用时间', dataIndex: 'applied_at', key: 'applied_at', width: 170 },
    { title: '操作人', dataIndex: 'applied_by', key: 'applied_by', width: 130 },
    {
      title: '校验和（sha256）',
      dataIndex: 'checksum',
      key: 'checksum',
      render: (checksum: string) => <Text code style={{ fontSize: 12 }}>{shortChecksum(checksum)}</Text>,
    },
    {
      title: '错误信息',
      dataIndex: 'error_msg',
      key: 'error_msg',
      render: (errorMsg?: string) =>
        errorMsg ? (
          <Tooltip title={errorMsg}>
            <Text type="danger" ellipsis style={{ maxWidth: 280 }}>
              {errorMsg}
            </Text>
          </Tooltip>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 90,
      render: (_: unknown, record: AlertmanagerConfigVersion) => (
        <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => setViewing(record)}>
          查看
        </Button>
      ),
    },
  ]

  const handleReload = () => {
    message.success('已重新加载 Alertmanager 配置（POST /-/reload 成功）')
  }

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4} style={{ margin: 0 }}>
          Alertmanager 配置管理
        </Title>
        <Text type="secondary">
          `alertmanager.yml` 由 Module_08 直接管理并触发 reload，配置版本用于审计与回滚
        </Text>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="配置管理边界"
        description={
          <span>
            `alertmanager.yml`（路由 / 接收人 / 静默 / 抑制）由本模块写文件后通过 SIGHUP 或 HTTP{' '}
            <Text code>POST /-/reload</Text> 触发 Alertmanager 重载；MVP 单域阶段{' '}
            <Text strong>不进入</Text> Module_09 的配置变更确认流程（调整频繁、影响面可控）。
            `rules.yml` 的生成与下发由 Module_09 负责，本模块不生成。
          </span>
        }
      />

      <Card
        className="page-card"
        title={
          <Space size={8}>
            当前生效配置
            {latest && (
              <Tag color="success">
                v{latest.version}（{latest.applied_at} 由 {latest.applied_by} 应用）
              </Tag>
            )}
          </Space>
        }
        extra={
          <Button icon={<ReloadOutlined />} onClick={handleReload}>
            重新加载配置
          </Button>
        }
        style={{ marginBottom: 16 }}
      >
        <pre className="yaml-preview" style={{ margin: 0, maxHeight: 420, overflow: 'auto' }}>
          {currentAlertmanagerYaml}
        </pre>
        <Alert
          message="变更生效路径"
          description="接收人 / 路由 / 静默 / 抑制策略修改后，M08 重新生成 alertmanager.yml → 通过 amtool check-config 校验 → 写入配置目录并 reload。校验失败时保留上一生效版本并记录错误原因（见下方版本历史）。"
          type="info"
          showIcon
          style={{ marginTop: 12 }}
        />
      </Card>

      <Card
        className="page-card"
        title={
          <Space size={8}>
            <HistoryOutlined />
            配置版本历史
            <Tag>审计与回滚</Tag>
          </Space>
        }
      >
        <Table<AlertmanagerConfigVersion>
          rowKey="id"
          dataSource={versions}
          columns={columns}
          pagination={false}
          size="middle"
        />
      </Card>

      <Drawer
        title={`配置版本 ${viewing ? `v${viewing.version}` : ''} 内容`}
        width={720}
        open={viewing !== null}
        onClose={() => setViewing(null)}
      >
        {viewing && (
          <>
            <Descriptions bordered size="small" column={{ xs: 1, md: 2 }} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="版本">
                <Text code>{viewing.version}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                {viewing.status === 'applied' ? (
                  <Tag color="success">{viewing.id === latest?.id ? '生效中' : '已生效'}</Tag>
                ) : (
                  <Tag color="error">reload 失败</Tag>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="应用时间">{viewing.applied_at}</Descriptions.Item>
              <Descriptions.Item label="操作人">{viewing.applied_by}</Descriptions.Item>
              <Descriptions.Item label="校验和（sha256）">
                <Text code style={{ fontSize: 12 }}>
                  {viewing.checksum}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="版本 ID">
                <Text code>{viewing.id}</Text>
              </Descriptions.Item>
            </Descriptions>
            {viewing.error_msg && (
              <Alert
                message="reload 失败原因"
                description={viewing.error_msg}
                type="error"
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}
            <pre className="yaml-preview" style={{ margin: 0, maxHeight: 520, overflow: 'auto' }}>
              {viewing.content}
            </pre>
          </>
        )}
      </Drawer>
    </MainLayout>
  )
}

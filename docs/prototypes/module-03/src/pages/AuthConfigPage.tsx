import { useState } from 'react'
import {
  Card,
  Typography,
  Form,
  Select,
  Input,
  Table,
  Tag,
  Space,
  Button,
  message,
} from 'antd'
import { SaveOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  mockRolePermissions,
  mockAuthConfig,
  authModes,
  type AuthMode,
} from '../mocks/module-03'

const { Title, Text } = Typography
const { Option } = Select

const AUTH_MODE_LABELS: Record<AuthMode, string> = {
  none: '无认证（MVP 默认）',
  basic_auth: 'Basic Auth',
  token: 'Token 认证',
  sso: 'SSO 单点登录',
}

export function AuthConfigPage() {
  const [authMode, setAuthMode] = useState<AuthMode>(mockAuthConfig.mode)
  const [sessionTtl, setSessionTtl] = useState<number | string>(mockAuthConfig.sessionTtlMinutes)
  const [ssoCallback, setSsoCallback] = useState(mockAuthConfig.ssoCallbackUrl)

  const handleSave = () => {
    message.success('认证配置已保存（原型演示，未提交后端）')
  }

  const columns = [
    {
      title: '角色标识',
      dataIndex: 'role',
      key: 'role',
      render: (role: string) => <Tag color="#0ECDEB">{role}</Tag>,
    },
    {
      title: '角色名称',
      dataIndex: 'roleName',
      key: 'roleName',
    },
    {
      title: '可访问页面',
      dataIndex: 'pages',
      key: 'pages',
      render: (pages: string[]) => (
        <Space size={[0, 4]} wrap>
          {pages.map((page) => (
            <Tag key={page} color="blue">
              {page}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '可操作权限',
      dataIndex: 'actions',
      key: 'actions',
      render: (actions: string[]) => (
        <Space size={[0, 4]} wrap>
          {actions.map((action) => (
            <Tag key={action}>{action}</Tag>
          ))}
        </Space>
      ),
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>认证配置</Title>
      </div>
      <Space direction="vertical" size="large" style={{ display: 'flex' }}>
        <Card className="page-card" title="认证模式">
          <Form layout="vertical">
            <Form.Item label="当前认证模式">
              <Select value={authMode} onChange={setAuthMode} style={{ width: 280 }}>
                {authModes.map((mode) => (
                  <Option key={mode} value={mode}>
                    {AUTH_MODE_LABELS[mode]}
                  </Option>
                ))}
              </Select>
            </Form.Item>
            {authMode === 'sso' && (
              <Form.Item label="SSO 回调地址">
                <Input
                  value={ssoCallback}
                  onChange={(e) => setSsoCallback(e.target.value)}
                  placeholder="https://metric-center.example.com/auth/sso/callback"
                />
              </Form.Item>
            )}
            {(authMode === 'token' || authMode === 'sso') && (
              <Form.Item label="会话有效期（分钟）">
                <Input
                  type="number"
                  value={sessionTtl}
                  onChange={(e) => setSessionTtl(e.target.value)}
                  style={{ width: 200 }}
                />
              </Form.Item>
            )}
            <Form.Item>
              <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>
                保存配置
              </Button>
            </Form.Item>
          </Form>
        </Card>
        <Card className="page-card" title="角色权限矩阵">
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            定义不同角色在 MetricCenter 中的页面访问与操作权限，实际鉴权由网关中间件执行。
          </Text>
          <Table
            rowKey="role"
            dataSource={mockRolePermissions}
            columns={columns}
            pagination={false}
          />
        </Card>
      </Space>
    </MainLayout>
  )
}

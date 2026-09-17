import { useState } from 'react'
import { Button, Card, Form, Input, Typography, message } from 'antd'
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { apiClient, setStoredUser, setToken } from '../../api/client'
import type { LoginResult } from '../../types/auth'

const { Title, Text } = Typography

interface LoginFormValues {
  username: string
  password: string
}

/**
 * 由 searchParams.redirect 解析回跳目标。
 * 仅接受站内相对路径；拒绝跨站绝对地址（防开放重定向）以及再次指向 /login 的循环。
 */
function resolveRedirectTarget(searchParams: URLSearchParams): string {
  const raw = searchParams.get('redirect')
  if (raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/login')) {
    return raw
  }
  return '/'
}

/**
 * 登录页（module-06 认证，共享基础层 f-01）。
 * - 成功后 Token / 用户信息落 localStorage，跳回 redirect 原页面（无则首页）。
 * - 失败统一提示「用户名或密码错误」，不区分账号 / 密码原因（防账号枚举）。
 * 单页渲染，不套 MainLayout。
 */
export function LoginPage() {
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const onFinish = async (values: LoginFormValues) => {
    setLoading(true)
    try {
      const res = await apiClient.post<LoginResult>('/api/v2/platform/auth/login', {
        body: { username: values.username, password: values.password },
      })
      if (res.data?.token) {
        setToken(res.data.token)
        setStoredUser(res.data.user)
      }
      message.success('登录成功')
      navigate(resolveRedirectTarget(searchParams), { replace: true })
    } catch {
      // 登录失败统一文案，不暴露账号不存在 / 密码错误等细节
      message.error('用户名或密码错误')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f0f2f5',
      }}
    >
      <Card style={{ width: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Title level={3} style={{ marginBottom: 4 }}>
            MetricCenter
          </Title>
          <Text type="secondary">指标采集与查询中心</Text>
        </div>
        <Form<LoginFormValues> name="login" onFinish={onFinish} autoComplete="off" size="large">
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" autoComplete="username" allowClear />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" autoComplete="current-password" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" loading={loading} block>
              登 录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}

export default LoginPage
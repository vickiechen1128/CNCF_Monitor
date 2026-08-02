import { useNavigate } from 'react-router-dom'
import { Card, Col, Row, Typography, Button, Space } from 'antd'
import {
  DatabaseOutlined,
  TagOutlined,
  InfoCircleOutlined,
  TagsOutlined,
  TeamOutlined,
  GlobalOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'

const { Title, Text } = Typography

interface SettingGroup {
  title: string
  icon: React.ReactNode
  description: string
  links: { label: string; path: string }[]
}

const settingGroups: SettingGroup[] = [
  {
    title: 'CMDB Provider',
    icon: <DatabaseOutlined style={{ color: '#0ECDEB' }} />,
    description: '管理 BlueKing、HTTP、Nacos、Kubernetes 等外部 CMDB 数据源。',
    links: [{ label: '进入 Provider 配置', path: '/providers' }],
  },
  {
    title: 'CI 类型映射',
    icon: <TagOutlined style={{ color: '#00B578' }} />,
    description: '维护 BlueKing bk_obj_id 与 MetricCenter resource_type 的映射关系。',
    links: [
      { label: '进入 Provider 配置', path: '/providers' },
      { label: '查看待分类 CI', path: '/pending-ci' },
    ],
  },
  {
    title: '状态映射字典',
    icon: <InfoCircleOutlined style={{ color: '#FA8C16' }} />,
    description: '定义 CMDB 状态到监控状态的映射规则。',
    links: [],
  },
  {
    title: '标签模板',
    icon: <TagsOutlined style={{ color: '#1481FD' }} />,
    description: '配置资源字段到 Prometheus 标签的转换模板。',
    links: [{ label: '进入标签模板', path: '/label-templates' }],
  },
  {
    title: '租户与网域',
    icon: <TeamOutlined style={{ color: '#0ECDEB' }} />,
    description: '管理租户、网域归属以及平台管理员权限。',
    links: [
      { label: '租户管理', path: '/tenants' },
      { label: '网域管理', path: '/network-domains' },
    ],
  },
  {
    title: '平台配置',
    icon: <GlobalOutlined style={{ color: '#FF4C3A' }} />,
    description: 'TSDB  retention、remote write 转发、全局 scrape 限制等。',
    links: [{ label: '进入平台配置', path: '/platform-settings' }],
  },
]

export function SettingsPage() {
  const navigate = useNavigate()

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>系统设置</Title>
        <Text type="secondary">快速导航到各模块配置入口。</Text>
      </div>
      <Row gutter={[16, 16]}>
        {settingGroups.map((group) => (
          <Col xs={24} md={12} lg={8} key={group.title}>
            <Card className="page-card" title={<Space>{group.icon}<span>{group.title}</span></Space>}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                {group.description}
              </Text>
              <Space direction="vertical" style={{ width: '100%' }}>
                {group.links.length > 0 ? (
                  group.links.map((link) => (
                    <Button
                      key={link.path}
                      type="link"
                      icon={<ArrowRightOutlined />}
                      onClick={() => navigate(link.path)}
                      style={{ paddingLeft: 0 }}
                    >
                      {link.label}
                    </Button>
                  ))
                ) : (
                  <Text type="secondary">即将上线</Text>
                )}
              </Space>
            </Card>
          </Col>
        ))}
      </Row>
    </MainLayout>
  )
}

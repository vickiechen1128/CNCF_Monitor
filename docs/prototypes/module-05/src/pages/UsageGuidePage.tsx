import { Card, Col, Row, Steps, Tag, Typography, Space } from 'antd'
import {
  GlobalOutlined,
  ImportOutlined,
  ApiOutlined,
  SendOutlined,
  LineChartOutlined,
} from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'

const { Title, Text } = Typography

const guideSteps = [
  {
    title: '登记网域',
    desc: '注册网络域并生成 Edge Agent Token，开启采集下发通道。',
    icon: <GlobalOutlined style={{ fontSize: 20, color: '#1481FD' }} />,
  },
  {
    title: '导入资源',
    desc: '录入或导入主机 / 中间件 / 应用服务等监控对象。',
    icon: <ImportOutlined style={{ fontSize: 20, color: '#00B578' }} />,
  },
  {
    title: '建采集 Job',
    desc: '选择 CI-Exporter 模板并关联资源实例，生成采集任务。',
    icon: <ApiOutlined style={{ fontSize: 20, color: '#FA8C16' }} />,
  },
  {
    title: '下发配置',
    desc: '预览生成的 prometheus.yml，人工确认后下发至采集面。',
    icon: <SendOutlined style={{ fontSize: 20, color: '#722ED1' }} />,
  },
  {
    title: '查指标',
    desc: '在查询页执行 PromQL，或在可视化大屏查看实时面板。',
    icon: <LineChartOutlined style={{ fontSize: 20, color: '#0ECDEB' }} />,
  },
]

const quickLinks = [
  { label: '资源管理', href: '../module-07/index.html' },
  { label: '采集 Job', href: '../module-01/index.html' },
  { label: '查询中心', href: '../module-02/index.html' },
  { label: '可视化大屏', href: '#/grafana-dashboard' },
]

export function UsageGuidePage() {
  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>使用引导</Title>
        <Text type="secondary">
          新用户开箱动线：登记网域 → 导入资源 → 建采集 Job → 下发 → 查指标。
        </Text>
      </div>

      <Card className="page-card">
        <Steps
          direction="vertical"
          current={guideSteps.length}
          items={guideSteps.map((s) => ({
            title: (
              <Space align="center">
                {s.icon}
                <Text strong>{s.title}</Text>
              </Space>
            ),
            description: s.desc,
          }))}
        />
      </Card>

      <Card className="page-card" style={{ marginTop: 16 }} title="快捷入口">
        <Row gutter={[16, 16]}>
          {quickLinks.map((l) => (
            <Col xs={24} sm={12} md={6} key={l.label}>
              <a href={l.href} style={{ textDecoration: 'none' }}>
                <Card className="page-card" hoverable style={{ textAlign: 'center' }}>
                  <Text>{l.label}</Text>
                  <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
                    <Tag color="#0ECDEB">立即前往</Tag>
                  </Text>
                </Card>
              </a>
            </Col>
          ))}
        </Row>
      </Card>
    </MainLayout>
  )
}
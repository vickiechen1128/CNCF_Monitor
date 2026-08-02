import { useState } from 'react'
import {
  Card,
  Typography,
  Form,
  InputNumber,
  Switch,
  Button,
  Space,
  message,
  Divider,
} from 'antd'
import { SaveOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { mockPlatformSettings, type PlatformSettings } from '../mocks/module-06'

const { Title, Text } = Typography

export function PlatformSettingsPage() {
  const [settings, setSettings] = useState<PlatformSettings>(mockPlatformSettings)
  const [form] = Form.useForm()

  const handleSave = (values: PlatformSettings) => {
    setSettings(values)
    message.success('平台配置已保存（原型演示，未提交后端）')
  }

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>平台配置</Title>
      </div>
      <Card className="page-card">
        <Form
          form={form}
          layout="vertical"
          initialValues={settings}
          onFinish={handleSave}
          style={{ maxWidth: 600 }}
        >
          <Divider orientation="left">TSDB 与 Remote Write</Divider>
          <Form.Item
            label="TSDB 数据保留天数"
            name="tsdbRetentionDays"
            rules={[{ required: true, message: '请输入保留天数' }]}
          >
            <InputNumber min={1} max={3650} style={{ width: 200 }} />
          </Form.Item>
          <Form.Item
            label="Remote Write 转发"
            name="remoteWriteForwardEnabled"
            valuePropName="checked"
          >
            <Switch
              checkedChildren="开启"
              unCheckedChildren="关闭"
            />
          </Form.Item>
          <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
            开启后，采集端写往本地 TSDB 的数据会同时转发到远端 Prometheus 集群。
          </Text>

          <Divider orientation="left">全局 Scrape 限制</Divider>
          <Space size="large">
            <Form.Item
              label="最小采集间隔（秒）"
              name="minScrapeIntervalSeconds"
              rules={[{ required: true, message: '请输入最小间隔' }]}
            >
              <InputNumber min={1} max={3600} />
            </Form.Item>
            <Form.Item
              label="最大采集间隔（秒）"
              name="maxScrapeIntervalSeconds"
              rules={[{ required: true, message: '请输入最大间隔' }]}
            >
              <InputNumber min={1} max={86400} />
            </Form.Item>
          </Space>

          <Form.Item style={{ marginTop: 24 }}>
            <Button type="primary" icon={<SaveOutlined />} htmlType="submit">
              保存配置
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </MainLayout>
  )
}

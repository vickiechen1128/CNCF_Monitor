import { Card, Button, message, Steps, Alert } from 'antd'
import { useState } from 'react'
import { MainLayout } from '../layouts/MainLayout'
import { generatedConfig } from '../mocks/config'

export function ConfigPreviewPage() {
  const [currentStep] = useState(1)

  const handleApply = () => {
    message.success('配置已下发并触发 Prometheus reload（原型演示）')
  }

  return (
    <MainLayout>
      <Card title="配置生成与下发">
        <Steps
          current={currentStep}
          items={[
            { title: '资源准备' },
            { title: '配置生成' },
            { title: '配置校验' },
            { title: '配置下发' },
          ]}
          style={{ marginBottom: 24 }}
        />
        <Alert
          message="配置预览"
          description="下方为根据当前资源、标签模板、采集 Job 和拨测配置自动生成的 prometheus.yml 内容。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <pre
          style={{
            background: '#f6f8fa',
            padding: 16,
            borderRadius: 8,
            overflow: 'auto',
            maxHeight: 500,
          }}
        >
          {generatedConfig}
        </pre>
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <Button type="primary" onClick={handleApply}>
            一键下发到 Prometheus
          </Button>
        </div>
      </Card>
    </MainLayout>
  )
}

export default ConfigPreviewPage

import { Card, Steps } from 'antd'

interface OnboardingStep {
  title: string
  description: string
  href: string
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  { title: '登记网域', description: '注册网络域并配置 Edge Agent', href: '/domain-onboarding' },
  { title: '导入资源', description: '导入主机、中间件、应用资源', href: '/resources' },
  { title: '建采集 Job', description: '创建采集任务并选择实例', href: '/scrape-jobs' },
  { title: '下发', description: '预览并下发 Prometheus 配置', href: '/config-preview' },
  { title: '查指标', description: '使用 PromQL 查询指标数据', href: '/query' },
]

export function OnboardingSteps() {
  return (
    <Card title="使用指引" data-testid="onboarding-steps-card" style={{ marginTop: 16 }}>
      <Steps
        direction="horizontal"
        size="small"
        current={-1}
        items={ONBOARDING_STEPS.map((step) => ({
          title: <a href={step.href}>{step.title}</a>,
          description: step.description,
        }))}
      />
    </Card>
  )
}

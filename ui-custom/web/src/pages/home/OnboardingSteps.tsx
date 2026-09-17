/**
 * 首页使用指引区（Module_05 §3.1 决策 72-1 六步监控闭环）。
 *
 * 六步：登记网域 → 导入资源 → 建采集 Job → 下发 → 配置告警通知 → 查指标 / 看告警。
 * 第 5 步「配置告警通知」深链 /alert-config（补齐闭环，把告警配置显性化）；
 * 第 6 步主入口 /query（自定义指标查询页）、次入口 /alert-status（告警状态页）。
 * 完成态标识当前为静态未勾选，v0.3 接入真实数据后自动打勾（决策 72-1）。
 */
import { Space, Steps, Typography } from 'antd'
import { Link } from 'react-router-dom'
import { SurfaceCard } from './SurfaceCard'

interface OnboardingStep {
  /** 主入口文案与深链 */
  title: string
  href: string
  description: string
  /** 次入口（第 6 步「查指标 / 看告警」并列提供两个入口） */
  secondary?: { title: string; href: string }
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  { title: '登记网域', description: '注册网络域并配置 Edge Agent', href: '/domain-onboarding' },
  { title: '导入资源', description: '导入主机、中间件、应用资源', href: '/resources' },
  { title: '建采集 Job', description: '创建采集任务并选择实例', href: '/scrape-jobs' },
  { title: '下发', description: '预览并下发 Prometheus 配置', href: '/config-preview' },
  { title: '配置告警通知', description: '挂载并校验告警通知配置', href: '/alert-config' },
  {
    title: '查指标',
    description: '查询指标并查看告警',
    href: '/query',
    secondary: { title: '看告警', href: '/alert-status' },
  },
]

function StepTitle({ step }: { step: OnboardingStep }) {
  if (!step.secondary) {
    return <Link to={step.href}>{step.title}</Link>
  }
  return (
    <Space size={4}>
      <Link to={step.href}>{step.title}</Link>
      <Typography.Text type="secondary">/</Typography.Text>
      <Link to={step.secondary.href}>{step.secondary.title}</Link>
    </Space>
  )
}

export function OnboardingSteps() {
  return (
    <SurfaceCard title="使用指引" data-testid="onboarding-steps-card">
      <Typography.Text type="secondary" style={{ fontSize: 14, display: 'block', marginBottom: 12 }}>
        按以下步骤完成首次监控闭环，大约需要 5 分钟
      </Typography.Text>
      <Steps
        direction="horizontal"
        size="small"
        current={-1}
        items={ONBOARDING_STEPS.map((step) => ({
          title: <StepTitle step={step} />,
          description: step.description,
        }))}
      />
    </SurfaceCard>
  )
}

export default OnboardingSteps

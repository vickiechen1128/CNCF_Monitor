/**
 * 首页使用指引区（Module_05 §3.1 决策 72-1 六步监控闭环；决策 93 改纵向六步；
 * **2026-10-17 走查改回一行横排**）。
 *
 * 六步（M05 SRS v1.1 FR-07，2026-11-16 对齐 M09 去确认化）：
 * 登记网域 → 纳管网域并安装采集节点 → 导入资源 → 建采集 Job → 配置告警通知 → 查指标 / 看告警。
 * 不再包含人工「下发」步骤（M09 配置自动同步，D25）；第 2 步落网域纳管页
 * （纳管 + 安装采集节点 + 等待心跳上线），第 5 步「配置告警通知」深链 /alert-config，
 * 第 6 步主入口 /query、次入口 /alert-status。
 * 完成态当前静态未勾选，v0.3 接入真实数据后自动打勾。
 *
 * 一行横排口径（2026-10-17 走查，产品负责人裁定）：「使用指引改成一行」——
 * 六步是**闭环动线**（从登记到看告警的一次完整路径），纵向六步占近半屏高、
 * 把拨测 / 采集健康等数据面板挤出首屏；横排一行后动线一眼看完，页面高度也让位给数据。
 * 手机竖屏（≤767px）六步一行放不下 → 卡片内横向滚动（隐藏滚动条，触屏可左右滑），
 * 与模块导航 / 矩阵表格同一滚动模式；不给手机单独做卡片化（那会退回多行）。
 */
import { Steps, theme } from 'antd'
import type { ReactNode } from 'react'
import {
  ApiOutlined,
  BellOutlined,
  CloudServerOutlined,
  GlobalOutlined,
  ImportOutlined,
  LineChartOutlined,
} from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { SurfaceCard } from './SurfaceCard'
import { HOME_FONT } from './homeTypography'
import { useNarrowLayout } from './homeResponsive'

interface OnboardingStep {
  /** 主入口文案与深链 */
  title: string
  href: string
  description: string
  /** 步骤图标（品牌色，视觉定版） */
  icon: ReactNode
  /** 次入口（第 6 步「查指标 / 看告警」并列提供两个入口） */
  secondary?: { title: string; href: string }
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  { title: '登记网域', description: '注册网络域并完成基础配置', href: '/domain-onboarding', icon: <GlobalOutlined /> },
  {
    title: '纳管网域并安装节点',
    description: '纳管网域、安装采集节点并确认心跳上线',
    href: '/domain-onboarding',
    icon: <CloudServerOutlined />,
  },
  { title: '导入资源', description: '导入主机、中间件、应用资源', href: '/resources', icon: <ImportOutlined /> },
  { title: '建采集 Job', description: '创建采集任务并选择实例', href: '/scrape-jobs', icon: <ApiOutlined /> },
  { title: '配置告警通知', description: '挂载并校验告警通知配置', href: '/alert-config', icon: <BellOutlined /> },
  {
    title: '查指标',
    description: '查询指标并查看告警',
    href: '/query',
    icon: <LineChartOutlined />,
    secondary: { title: '看告警', href: '/alert-status' },
  },
]

function StepTitle({ step }: { step: OnboardingStep }) {
  if (!step.secondary) {
    return <Link to={step.href}>{step.title}</Link>
  }
  return (
    <>
      <Link to={step.href}>{step.title}</Link>
      {' / '}
      <Link to={step.secondary.href} style={{ color: 'inherit' }}>
        {step.secondary.title}
      </Link>
    </>
  )
}

export function OnboardingSteps() {
  const { token } = theme.useToken()
  const narrow = useNarrowLayout()
  return (
    <SurfaceCard
      title="使用指引"
      data-testid="onboarding-steps-card"
      style={{ height: '100%' }}
      styles={{ body: { display: 'flex', flexDirection: 'column' } }}
    >
      {/* 一行横排：宽屏六步等宽一行；窄屏卡片内横向滚动（隐藏滚动条），
          给 Steps 一个最小宽度防止六步被压缩到不可读。 */}
      <div style={{ overflowX: 'auto', overflowY: 'hidden' }}>
        <Steps
          direction="horizontal"
          size="small"
          current={-1}
          style={{ minWidth: narrow ? 760 : undefined }}
          items={ONBOARDING_STEPS.map((step) => ({
            title: <StepTitle step={step} />,
            description: (
              <span style={{ fontSize: HOME_FONT.body, color: token.colorTextSecondary }}>
                {step.description}
              </span>
            ),
            icon: <span style={{ color: token.colorPrimary }}>{step.icon}</span>,
          }))}
        />
      </div>
    </SurfaceCard>
  )
}

export default OnboardingSteps

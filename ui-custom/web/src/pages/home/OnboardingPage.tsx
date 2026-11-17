/**
 * 首页子菜单「使用引导」页（M05 SRS v1.1 FR-25）：
 * 把首页底部的六步动线提升为可独立访问的页面，方便从导航直接进入 /onboarding。
 * 内容与首页共用 OnboardingSteps，避免两处文案漂移。
 */
import { Typography } from 'antd'
import { MainLayout } from '../../layouts/MainLayout'
import { OnboardingSteps } from './OnboardingSteps'

export function OnboardingPage() {
  return (
    <MainLayout>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            使用引导
          </Typography.Title>
          <Typography.Text type="secondary">
            按六步完成从网域接入到指标查询的完整动线；配置由平台自动同步，无需人工下发。
          </Typography.Text>
        </div>
        <OnboardingSteps />
      </div>
    </MainLayout>
  )
}

export default OnboardingPage

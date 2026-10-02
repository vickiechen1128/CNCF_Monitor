/**
 * 页面说明区统一组件（Module_08，2026-10-02 用户拍板）。
 *
 * 起因：告警配置 / 路由规则 / 通知渠道 / 通知模板四页原先各写一套说明区——
 * 告警配置把说明塞进页头卡、路由规则用常驻 info Alert、通知渠道塞在卡片正文里、
 * 通知模板用标题带问号的折叠栏。四种形态、四种展开逻辑、同一事实常有 2~3 处表述。
 *
 * 统一后的结构（**页头 → 可折叠说明区 → 主内容**）：
 *   1. 页头：标题 + 一行副标（只说「这页管什么」，最长一句）+ 右上角操作位；
 *   2. 说明区：默认收起的折叠栏，标题「这个页面管什么」，展开 3~4 条要点；
 *   3. 主内容：各页自有卡片/表格/抽屉，不受本组件约束。
 *
 * 三条硬约束（写组件时按此取舍，不要在页内另起一套说明）：
 *   - **副标只做定位**，不解释机制；机制一律进要点列表。
 *   - **要点列表每条只说一个事实**，跨页重复的事实只在本页说一次（其余页链过来）。
 *   - **默认收起**：说明性内容不占常驻首屏；只有「当前模式 / 出错 / 待办」这类
 *     随状态变化的信息才允许常驻（由页面自己用 Alert 呈现，不进本组件）。
 *
 * 用法：
 * ```tsx
 * <PageIntro
 *   title="通知渠道"
 *   subtitle="登记告警送达的机器人渠道，告警分派只引用渠道。"
 *   extra={<Button type="primary" …>新增渠道</Button>}
 *   points={['…', '…']}
 * />
 * ```
 */
import type { ReactNode } from 'react'
import { Collapse, Space, Typography } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import { useSkin } from '../skinContext'

const { Text } = Typography

/** 说明区折叠标题（四页统一，避免各页自造问句式标题） */
export const PAGE_INTRO_GUIDE_TITLE = '这个页面管什么'

/** 说明区收起时的副标（点一下展开） */
export const PAGE_INTRO_GUIDE_HINT = '展开说明'

export interface PageIntroProps {
  /** 页名（一行） */
  title: string
  /** 一行副标：只说「这页管什么」，机制解释进points */
  subtitle?: ReactNode
  /** 右上角操作位（主按钮 / 状态标签等） */
  extra?: ReactNode
  /** 说明区要点，3~4 条为宜；为空则不渲染说明区 */
  points?: ReactNode[]
  /** 折叠区默认是否展开（默认收起——说明不占常驻首屏） */
  defaultOpen?: boolean
  /** 供测试定位 */
  testId?: string
}

export function PageIntro({
  title,
  subtitle,
  extra,
  points,
  defaultOpen = false,
  testId,
}: PageIntroProps) {
  const { tokens } = useSkin()
  const hasGuide = Array.isArray(points) && points.length > 0

  return (
    <div style={{ marginBottom: hasGuide ? 8 : 16 }} data-testid={testId}>
      {/* ① 页头：标题 + 一行副标 + 右侧操作位 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
          {subtitle ? (
            <Text type="secondary" style={{ display: 'block', marginTop: 4 }} data-testid={`${testId}-subtitle`}>
              {subtitle}
            </Text>
          ) : null}
        </div>
        {extra ? <div style={{ flexShrink: 0 }}>{extra}</div> : null}
      </div>

      {/* ② 可折叠说明区（默认收起）：3~4 条要点，每条只讲一个事实 */}
      {hasGuide && (
        <Collapse
          ghost
          size="small"
          defaultActiveKey={defaultOpen ? ['guide'] : []}
          style={{ marginTop: 8 }}
          data-testid={`${testId}-guide`}
          items={[
            {
              key: 'guide',
              label: (
                <Space size={8} wrap data-testid={`${testId}-guide-label`}>
                  <InfoCircleOutlined style={{ color: tokens.colorInfo }} />
                  <Text>{PAGE_INTRO_GUIDE_TITLE}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {defaultOpen ? '' : PAGE_INTRO_GUIDE_HINT}
                  </Text>
                </Space>
              ),
              children: (
                <ul
                  data-testid={`${testId}-guide-points`}
                  style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}
                >
                  {points?.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              ),
            },
          ]}
        />
      )}
    </div>
  )
}

export default PageIntro

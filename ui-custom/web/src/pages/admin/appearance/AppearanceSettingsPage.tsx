/**
 * 外观设置页（系统与平台管理 · 外观设置，路由 `/admin/appearance`）。
 *
 * 用户 2026-09-18 补充决策：
 * 1. 皮肤设置**不做在顶部栏**，改落在「系统与平台管理」模块——观感配置是低频设置项，
 *    与租户 / 用户 / 登录日志同属平台级设置，不该占用高频操作区；
 * 2. 同时支持**修改产品名称**（不再固定叫 MetricCenter），名称用于顶部栏品牌位、
 *    登录页标题与浏览器标签页标题。
 *
 * 两项设置的生效方式刻意不同：
 * - **皮肤**：点击即时生效（纯观感、可预期、可反复横跳，无需确认动作）；
 * - **产品名称**：文本框 + 「保存」后才生效——输入过程会逐字改掉全站品牌位（含顶栏与
 *   标签页标题），即时生效会让页面标题在打字时反复跳动；故输入期间只更新页内预览。
 *
 * 两项偏好均持久化在浏览器本地（见 skinPreference.ts / productNamePreference.ts），
 * 属「本机偏好」而非服务端配置：MVP 阶段无平台级设置接口，且不同部署 / 不同人可各取所需。
 */
import { useState } from 'react'
import { App, Button, Card, Input, Space, Typography } from 'antd'
import { CheckOutlined, UndoOutlined } from '@ant-design/icons'
import { MainLayout } from '../../../layouts/MainLayout'
import { useProductName, useSkin } from '../../../skinContext'
import { SKIN_ORDER, skinDefinition } from '../../../skins'
import type { SkinTokens } from '../../../skins'
import {
  DEFAULT_PRODUCT_NAME,
  PRODUCT_NAME_MAX_LENGTH,
  normalizeProductName,
} from '../../../productNamePreference'

const { Text } = Typography

/** 皮肤卡上的色样：主色 / 顶栏 / 语义红（语义红随皮肤切换是本次的明确决策，故一并展示） */
function swatches(tokens: SkinTokens) {
  return [
    { label: '主色', color: tokens.colorPrimary },
    { label: '顶栏', color: tokens.colorHeaderBg },
    { label: '语义红', color: tokens.colorError },
  ]
}

export function AppearanceSettingsPage() {
  const { message } = App.useApp()
  const { productName, setProductName, resetProductName } = useProductName()
  const { skin, setSkin, tokens } = useSkin()

  // 草稿态：仅驱动页内预览，保存后才写入上下文与本地持久化
  const [draft, setDraft] = useState(productName)

  const draftName = normalizeProductName(draft)
  const dirty = draftName !== productName

  const handleSave = () => {
    setProductName(draft)
    // 以规范化后的实际生效值回填草稿：避免输入框里留着多余空格而界面已按 trim 生效
    setDraft(normalizeProductName(draft))
    message.success(`产品名称已改为「${normalizeProductName(draft)}」`)
  }

  const handleReset = () => {
    resetProductName()
    setDraft(DEFAULT_PRODUCT_NAME)
    message.success(`产品名称已恢复默认「${DEFAULT_PRODUCT_NAME}」`)
  }

  return (
    <MainLayout>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card title="品牌名称">
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text type="secondary">
              用于顶部栏品牌位、登录页标题与浏览器标签页标题。留空或填写与默认名相同的值，
              即视为使用默认名称 {DEFAULT_PRODUCT_NAME}。
            </Text>

            <Space wrap>
              <Input
                data-testid="product-name-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onPressEnter={handleSave}
                maxLength={PRODUCT_NAME_MAX_LENGTH}
                showCount
                allowClear
                placeholder={DEFAULT_PRODUCT_NAME}
                aria-label="产品名称"
                style={{ width: 320 }}
              />
              <Button
                type="primary"
                data-testid="product-name-save"
                disabled={!dirty}
                onClick={handleSave}
              >
                保存
              </Button>
              <Button
                icon={<UndoOutlined />}
                data-testid="product-name-reset"
                disabled={productName === DEFAULT_PRODUCT_NAME && !dirty}
                onClick={handleReset}
              >
                恢复默认
              </Button>
            </Space>

            {/* 品牌位预览：用当前皮肤的真实顶栏色，让用户改名前就看到最终观感 */}
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                预览（顶部栏品牌位）
              </Text>
              <div
                data-testid="product-name-preview"
                style={{
                  marginTop: 6,
                  height: 48,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '0 16px',
                  borderRadius: 6,
                  background: tokens.colorHeaderBg,
                  color: tokens.colorHeaderText,
                  overflow: 'hidden',
                }}
              >
                <span style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {draftName}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: tokens.colorHeaderTab,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  首页 · 系统与平台管理 · 监控对象管理 · 采集策略
                </span>
              </div>
            </div>
          </Space>
        </Card>

        <Card title="界面皮肤">
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text type="secondary">
              切换后<Text strong>全站</Text>即时生效，含顶部栏、侧栏、按钮、语义色与告警级别配色；
              偏好保存在本机浏览器，刷新与切换模块均保持。
            </Text>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 12,
              }}
            >
              {SKIN_ORDER.map((key) => {
                const def = skinDefinition(key)
                const active = key === skin
                return (
                  <button
                    key={key}
                    type="button"
                    data-testid={`skin-option-${key}`}
                    aria-pressed={active}
                    onClick={() => setSkin(key)}
                    style={{
                      textAlign: 'left',
                      cursor: 'pointer',
                      padding: 14,
                      borderRadius: 8,
                      font: 'inherit',
                      background: active ? tokens.colorPrimaryBg : tokens.colorBgContainer,
                      border: `1px solid ${active ? tokens.colorPrimary : tokens.colorBorder}`,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <span style={{ fontSize: 14, fontWeight: 600, color: tokens.colorTextBase }}>
                        {def.label}
                      </span>
                      {active && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 12,
                            color: tokens.colorPrimary,
                          }}
                        >
                          <CheckOutlined />
                          使用中
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 12,
                        color: tokens.colorTextTertiary,
                      }}
                    >
                      {def.description}
                    </div>
                    <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
                      {swatches(def.tokens).map((s) => (
                        <span
                          key={s.label}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            fontSize: 11,
                            color: tokens.colorTextTertiary,
                          }}
                        >
                          <span
                            aria-hidden="true"
                            style={{
                              width: 14,
                              height: 14,
                              borderRadius: 3,
                              background: s.color,
                              border: `1px solid ${tokens.colorBorder}`,
                            }}
                          />
                          {s.label}
                        </span>
                      ))}
                    </div>
                  </button>
                )
              })}
            </div>

            <Text type="secondary" style={{ fontSize: 12 }}>
              语义色（成功 / 警告 / 错误）也随皮肤切换：仪电蓝下语义红取 {skinDefinition('inesa').tokens.colorError}，
              与蓝调主色同明度层级，避免高饱和红在简约配色里跳脱。
            </Text>
          </Space>
        </Card>
      </Space>
    </MainLayout>
  )
}

export default AppearanceSettingsPage

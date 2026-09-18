/**
 * 全站外观设置的上下文与消费 Hook（不含组件，故独立于 SkinProvider.tsx，
 * 规避 `react-refresh/only-export-components` 告警）。
 *
 * 「外观设置」目前含两项，由同一个 Provider 统一持有：
 * 1. **界面皮肤**（`skin` / `setSkin` / `tokens` / `themeConfig`）；
 * 2. **产品名称**（`productName` / `setProductName` / `resetProductName`）——
 *    用户 2026-09-18 补充：平台名可改成部署方自己的名字，见 productNamePreference.ts。
 * 两者共用一份上下文而非各起一个 Provider：它们同属「用户级外观偏好」，
 * 由同一个设置页（`pages/admin/appearance/AppearanceSettingsPage.tsx`）读写。
 * （文件名保留 `skinContext` 以免为纯改名而改动 20+ 处既有导入路径。）
 *
 * 为什么需要 Context 而不只依赖 antd token：
 * antd 的 `theme.useToken()` 只暴露 antd 自己派生的 token，取不到本平台特有的扩展项
 * （顶栏 accent、`colorErrorBg` 这类我们需要**逐字保真**的语义浅底），也拿不到产品名称。
 * 这些值必须随皮肤/名称切换，因此统一由此上下文供出。
 *
 * 默认值取火山青（`DEFAULT_SKIN`）+ 默认产品名而非 null：外观只影响观感，
 * 组件在测试或局部渲染中脱离 Provider 时也应能正常渲染，不该被迫抛错。
 */
import { createContext, useContext } from 'react'
import type { ThemeConfig } from 'antd'
import { DEFAULT_SKIN, buildSkinTheme, skinTokens } from './skins'
import type { SkinKey, SkinTokens } from './skins'
import { DEFAULT_PRODUCT_NAME } from './productNamePreference'

export interface AppearanceConfig {
  /** 当前皮肤标识 */
  skin: SkinKey
  /** 切换皮肤（内部已做合法性校验与持久化） */
  setSkin: (key: SkinKey) => void
  /** 当前皮肤的完整色值表（品牌 + 语义 + 顶栏扩展） */
  tokens: SkinTokens
  /** 由 tokens 派生、用于 antd ConfigProvider 的主题配置 */
  themeConfig: ThemeConfig
  /** 当前产品名称（始终非空，最小为 DEFAULT_PRODUCT_NAME） */
  productName: string
  /** 设置产品名称（内部规范化 + 持久化，空白值回落默认名） */
  setProductName: (name: string) => void
  /** 恢复默认产品名称并清除持久化偏好 */
  resetProductName: () => void
}

const DEFAULT_TOKENS = skinTokens(DEFAULT_SKIN)

export const AppearanceContext = createContext<AppearanceConfig>({
  skin: DEFAULT_SKIN,
  setSkin: () => {
    /* 脱离 Provider 时切换皮肤无意义，静默忽略 */
  },
  tokens: DEFAULT_TOKENS,
  themeConfig: buildSkinTheme(DEFAULT_TOKENS),
  productName: DEFAULT_PRODUCT_NAME,
  setProductName: () => {
    /* 脱离 Provider 时改名无意义，静默忽略 */
  },
  resetProductName: () => {
    /* 同上 */
  },
})

/**
 * 读取当前外观设置：`{ skin, setSkin, tokens, themeConfig, productName, ... }`。
 * 名称沿用 useSkin（既有消费方大量依赖），新代码若只关心产品名可用 useProductName()。
 */
export function useSkin(): AppearanceConfig {
  return useContext(AppearanceContext)
}

/** 只读产品名称相关字段（避免调用方多解构无关项） */
export function useProductName(): Pick<
  AppearanceConfig,
  'productName' | 'setProductName' | 'resetProductName'
> {
  const { productName, setProductName, resetProductName } = useContext(AppearanceContext)
  return { productName, setProductName, resetProductName }
}

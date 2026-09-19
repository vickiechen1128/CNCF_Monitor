/**
 * 全站外观 Provider：持有当前皮肤与产品名称、落盘偏好、派生 antd 主题、注入 CSS 变量。
 *
 * 挂载位置：`main.tsx` 的最外层（替代原先直接使用的 `ConfigProvider`），
 * 因此 antd 主题、`App.useApp()` 上下文、CSS 变量三者随皮肤同步切换。
 *
 * 关于「产品名称」（用户 2026-09-18 补充）：改名只影响**呈现层**（顶栏品牌位、
 * 登录页标题、浏览器标签页标题），不涉及任何接口或存储键；持久化见 productNamePreference.ts。
 * 由 Provider 统一持有而非各页自读 localStorage，是为了改名后三处文案在**同一帧**一起更新，
 * 避免「顶栏已变、登录页未变」的割裂。
 *
 * 为什么 CSS 变量由 JS 注入而不是写死在 App.css：
 * 自绘元素（深色顶栏、侧栏选中态、内容区底色）读不到 antd token；
 * 若在 CSS 里按 `html[data-skin="inesa"]` 再抄一份色值，就会出现**两处真相**，
 * 改色时必然漏改一处。这里按 `CSS_VAR_BY_TOKEN` 把 token 注入 `:root`，
 * CSS 侧只写 `var(--app-*, 火山青兜底值)`，兜底值兼作 JS 未执行时的降级。
 */
import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { CSS_VAR_BY_TOKEN, buildSkinTheme, isSkinKey, skinTokens } from './skins'
import type { SkinKey } from './skins'
import { AppearanceContext } from './skinContext'
import { readSkin, writeSkin } from './skinPreference'
import {
  DEFAULT_PRODUCT_NAME,
  clearProductName,
  readProductName,
  writeProductName,
} from './productNamePreference'

type CssVarName = keyof typeof CSS_VAR_BY_TOKEN

// 逐项显式读写（不用 Object.entries），保证 token 键名受类型约束：
// 将来给 SkinTokens 改名时会在此处编译报错，而不是静默注入 undefined。
const CSS_VARS = Object.keys(CSS_VAR_BY_TOKEN) as CssVarName[]

export function SkinProvider({ children }: { children: ReactNode }) {
  // 初始值直接来自持久化偏好：首次渲染即是用户上次选的皮肤 / 改过的名字
  const [skin, setSkinState] = useState<SkinKey>(() => readSkin())
  const [productName, setProductNameState] = useState<string>(() => readProductName())

  const tokens = useMemo(() => skinTokens(skin), [skin])
  const themeConfig = useMemo(() => buildSkinTheme(tokens), [tokens])

  const setSkin = useCallback((key: SkinKey) => {
    if (!isSkinKey(key)) return
    setSkinState(key)
    writeSkin(key)
  }, [])

  /**
   * 改名：以写入层返回的规范化值为准（`writeProductName` 会做 trim / 折叠空白 / 超长截断），
   * 避免「输入框显示草稿、实际生效值是另一样」的错位。
   */
  const setProductName = useCallback((name: string) => {
    setProductNameState(writeProductName(name))
  }, [])

  const resetProductName = useCallback(() => {
    clearProductName()
    setProductNameState(DEFAULT_PRODUCT_NAME)
  }, [])

  /**
   * 注入 CSS 变量与 `html[data-skin]`。
   * 用 `useLayoutEffect` 而非 `useEffect`：需在浏览器绘制前完成写入，
   * 否则使用非默认皮肤的用户每次刷新都会先看到一帧默认皮肤（顶栏闪色）。
   * 本应用为纯客户端渲染（Vite SPA，无 SSR），不存在 useLayoutEffect 的服务端告警。
   */
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.skin = skin
    for (const cssVar of CSS_VARS) {
      root.style.setProperty(cssVar, tokens[CSS_VAR_BY_TOKEN[cssVar]])
    }
  }, [skin, tokens])

  /**
   * 浏览器标签页标题跟随产品名。
   * `index.html` 的静态 `<title>` 仅作 JS 未执行时的兜底（值与 DEFAULT_PRODUCT_NAME 一致）。
   */
  useLayoutEffect(() => {
    document.title = productName
  }, [productName])

  const value = useMemo(
    () => ({
      skin,
      setSkin,
      tokens,
      themeConfig,
      productName,
      setProductName,
      resetProductName,
    }),
    [skin, setSkin, tokens, themeConfig, productName, setProductName, resetProductName],
  )

  return (
    <AppearanceContext.Provider value={value}>
      <ConfigProvider locale={zhCN} theme={themeConfig}>
        {/* antd App 上下文：App.useApp()（message/notification/modal）必须在其内使用，
            否则解构结果为 undefined（生产环境 message.success is not a function 的根因）。
            注意 <App />（App.tsx）是项目路由组件，不是 antd App。 */}
        <AntApp>{children}</AntApp>
      </ConfigProvider>
    </AppearanceContext.Provider>
  )
}

export default SkinProvider

/**
 * 回归守卫：antd App 上下文挂载检查。
 *
 * 背景（2026-09-11 生产 bug）：SilencesPage / CreateSilenceDrawer / AlertConfigPage 使用
 * App.useApp() 获取 message，但生产入口 main.tsx 从未用 antd <App> 包裹应用
 * （main.tsx 里的 <App /> 是项目路由组件 ./App.tsx，不是 antd 的 App）——
 * useApp 解构出的 message 为 undefined，调用 message.success() 抛
 * "message.success is not a function"，且发生在「创建已成功」之后，
 * 用户看到「创建失败」但静默实际已生效。
 *
 * 2026-09-18 变更：双皮肤 / 产品名称引入后，antd 的 <ConfigProvider theme> 与 <AntApp>
 * 一并收进 `SkinProvider`（二者必须在同一层随皮肤重建，否则换肤时 App 上下文会被重置）。
 * 因此「应用根被 antd App 包裹」这一保证由 main.tsx 移交到 SkinProvider——本守卫同时校验两处，
 * 任一处被拆掉（例如有人把 <AntApp> 从 Provider 里挪走、或 main.tsx 绕过 Provider）都会在此失败。
 *
 * 页面级测试均显式包裹 <App>（如 CreateSilenceDrawer.test.tsx），拦不住这个逃逸，
 * 故对入口与 Provider 源码做静态断言。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

// jsdom 环境 import.meta.url 非 file 协议，用 cwd（= web/ 根）定位
const read = (relPath: string) => readFileSync(resolve(process.cwd(), relPath), 'utf-8')
const mainSrc = read('src/main.tsx')
const providerSrc = read('src/SkinProvider.tsx')

describe('antd App 上下文挂载（入口守卫）', () => {
  it('main.tsx 必须把路由组件 <App /> 包在 SkinProvider 内', () => {
    const openIdx = mainSrc.indexOf('<SkinProvider>')
    const closeIdx = mainSrc.indexOf('</SkinProvider>')
    expect(openIdx).toBeGreaterThan(-1)
    expect(closeIdx).toBeGreaterThan(openIdx)
    // <App /> 必须位于 <SkinProvider> 之内（从开标签之后搜索，避开注释里的字面量）
    const appIdx = mainSrc.indexOf('<App />', openIdx)
    expect(appIdx).toBeGreaterThan(openIdx)
    expect(appIdx).toBeLessThan(closeIdx)
  })

  it('SkinProvider 必须用 antd <AntApp> 包裹 children', () => {
    const antAppIdx = providerSrc.indexOf('<AntApp>')
    const closeIdx = providerSrc.indexOf('</AntApp>')
    expect(antAppIdx).toBeGreaterThan(-1)
    expect(closeIdx).toBeGreaterThan(antAppIdx)
    // AntApp 必须真正包住子节点，而不是被写成自闭合 / 空标签
    const childrenIdx = providerSrc.indexOf('{children}', antAppIdx)
    expect(childrenIdx).toBeGreaterThan(antAppIdx)
    expect(childrenIdx).toBeLessThan(closeIdx)
  })

  it('antd ConfigProvider 与 AntApp 同层且由 SkinProvider 持有（换肤时一起重建）', () => {
    const configIdx = providerSrc.indexOf('<ConfigProvider')
    const antAppIdx = providerSrc.indexOf('<AntApp>')
    expect(configIdx).toBeGreaterThan(-1)
    expect(configIdx).toBeLessThan(antAppIdx)
    // main.tsx 不再直接使用 ConfigProvider，否则会出现两处主题来源
    expect(mainSrc).not.toContain('<ConfigProvider')
  })
})

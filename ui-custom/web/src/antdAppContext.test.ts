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
 * 页面级测试均显式包裹 <App>（如 CreateSilenceDrawer.test.tsx），拦不住这个逃逸，
 * 故对入口文件做静态断言。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

// jsdom 环境 import.meta.url 非 file 协议，用 cwd（= web/ 根）定位
const mainSrc = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf-8')

describe('antd App 上下文挂载（入口守卫）', () => {
  it('main.tsx 必须以 antd <AntApp> 包裹应用根组件', () => {
    expect(mainSrc).toContain('<AntApp>')
    expect(mainSrc).toContain('</AntApp>')
    // 且 AntApp 必须包住项目路由组件 <App />（从 <AntApp> 之后搜索，避开注释中的字面量）
    const antAppIdx = mainSrc.indexOf('<AntApp>')
    expect(mainSrc.indexOf('<App />', antAppIdx)).toBeGreaterThan(antAppIdx)
  })
})

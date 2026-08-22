import '@testing-library/jest-dom'

/**
 * 为 Ant Design v5 组件（Table / Modal / Select 等）在 jsdom 环境下的渲染
 * 补齐缺失的浏览器 API，避免组件测试报错。
 */
if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    // @ts-ignore
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })
  }
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
}

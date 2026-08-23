import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    // antd(rc-motion/Select/Popconfirm)+jsdom 在慢环境全量并行时渲染开销大，
    // 默认 5s 超时偶发被压爆；提升到 15s 避免时序波动（单测隔离时 <1.2s）
    testTimeout: 15000,
  },
})

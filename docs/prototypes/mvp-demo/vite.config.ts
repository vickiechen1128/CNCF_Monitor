import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  // dev 模式强制使用默认 base /，避免本地开发受 VITE_BASE_PATH 影响
  base: command === 'build' ? (process.env.VITE_BASE_PATH || '/') : '/',
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
  },
}))

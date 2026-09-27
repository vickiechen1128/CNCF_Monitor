import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  // GitHub Pages 用 /CNCF_Monitor/，Vercel/本地开发用 /
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // 放行 cloudflared 临时隧道的随机子域名，便于局域网/外网通过 trycloudflare.com 访问
    allowedHosts: ['.trycloudflare.com', 'metric.chenrt.dpdns.org'],
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
})

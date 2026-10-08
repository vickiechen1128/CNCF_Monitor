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

    // ---- 内存护栏（8 GB 机型实测）----
    // 实测：单个 jsdom+antd 测试文件峰值 RSS 达 680~770 MB（HomePage.test.tsx
    // 76K → 684 MB、ResourcesPage.test.tsx 48K → 772 MB）。全量 94 文件若按
    // CPU 核数（8 核 → 8 worker）并行，瞬时需求可超 8 GB 物理内存，触发 swap
    // 风暴（实测 Pageins 达 9213 万次、swap 占用 4.0/5.4 GB），表现为「测试
    // 卡住不动」；严重时进程被 macOS 直接 SIGKILL（exit 137）。
    //
    // 关键坑：vitest 2.x 的 minWorkers 默认等于 CPU 核数，**只设 maxWorkers 会报**
    // `RangeError: options.minThreads and options.maxThreads must not conflict`
    // （实测确认），因此两者必须成对显式设置。
    minWorkers: 1,
    maxWorkers: 2,
    // 单文件仍并行内的多个 describe；跨文件最多 2 个 worker。
    // 临时需要全速验证可 CLI 覆盖：
    //   pnpm vitest run --minWorkers=8 --maxWorkers=8
    fileParallelism: true,

    // 限制每个 fork 子进程的 V8 堆上限，让 V8 更早触发 GC，而不是无限膨胀
    // 到把系统 swap 撑爆。实测单文件峰值 RSS 684 MB → 396 MB（-42%）。
    //
    // 用 poolOptions.execArgv 而非 NODE_OPTIONS 环境变量：后者在 Windows 下
    // 需额外引入 cross-env 才能生效，而本项目支持 Win 平台（setup-windows.sh）。
    // 注：poolOptions.forks 需与 pool: 'forks' 配对。vitest 2.x 默认即 forks，
    // 这里显式声明，以免未来默认值变更导致护栏静默失效。
    pool: 'forks',
    poolOptions: {
      forks: {
        execArgv: ['--max-old-space-size=1024'],
      },
    },

    // 不为了省内存而牺牲正确性：isolate 保持默认 true（测试文件间环境隔离），
    // 不开启单文件复用环境。
  },
})

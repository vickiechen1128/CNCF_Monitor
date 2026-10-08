# MetricCenter 前端开发标准

> 文档类型：工程标准
> **目标读者**：前端开发工程师（编码前必读）、技术架构师（前端技术选型 / 部署渠道）
> 目标：统一 Custom UI 的开发规范，确保前端代码可维护、可协作。
> 更新日期：2026-08-17（v1.26 新增第 8–10 章：交互组件选型 / 列表与长文本 / 页面状态处理规范）

---

## 1. 技术栈

| 项目 | 选择 |
|------|------|
| 框架 | React 18 + TypeScript |
| 构建工具 | Vite |
| UI 组件库 | Ant Design 5 |
| 图表库 | ECharts |
| 状态管理 | Zustand 或 React Query |
| HTTP 客户端 | Axios |
| 路由 | React Router 6 |

---

## 2. 目录结构

```
ui-custom/web/
├── public/                  # 静态资源
├── src/
│   ├── api/                 # API 客户端与接口定义
│   │   ├── client.ts        # axios 实例
│   │   ├── targets.ts
│   │   ├── query.ts
│   │   └── auth.ts
│   ├── components/          # 通用组件
│   │   ├── Common/
│   │   └── Layout/
│   │       └── MainLayout.tsx
│   ├── pages/               # 页面组件
│   │   ├── Login/
│   │   ├── Dashboard/
│   │   ├── Targets/
│   │   ├── Query/
│   │   └── Settings/
│   ├── stores/              # 状态管理
│   ├── hooks/               # 自定义 Hooks
│   ├── utils/               # 工具函数
│   ├── types/               # 全局类型定义
│   └── main.tsx             # 入口
├── package.json
├── tsconfig.json
├── vite.config.ts
└── .env.development
```

---

## 3. 开发规范

### 3.1 组件编写

- 使用函数组件 + Hooks
- 组件文件使用 PascalCase：`TargetList.tsx`
- 工具文件使用 camelCase：`formatTime.ts`
- 每个页面一个目录，包含页面组件和样式

### 3.2 API 调用

- 所有 API 调用通过 `src/api/client.ts` 中的 axios 实例
- API 函数按业务模块分文件：`targets.ts`、`query.ts`
- 统一处理认证错误（401 跳转登录）

### 3.3 类型定义

- 优先使用 TypeScript 严格模式
- 后端返回的数据结构必须定义 interface
- DTO 类型放在 `src/types/` 或对应 API 文件中

### 3.4 环境变量

```
VITE_API_BASE_URL=http://localhost:8080/api
```

开发期 MetricCenter Gateway 监听端口为 8080。

---

## 4. 包管理与 workspace 配置

### 4.1 pnpm v11 配置约束

本项目前端使用 **pnpm v11**。pnpm v11 要求：

1. 若存在 `pnpm-workspace.yaml`，**必须包含 `packages` 字段**，否则 `pnpm install` 会报错 `packages field missing or empty`。
2. pnpm v11 把构建脚本白名单从 `onlyBuiltDependencies` 数组改为 **`allowBuilds` 字典**，且 `.npmrc` 中除 auth/registry 外的大部分设置不再生效（详见 [pnpm 11.x settings](https://pnpm.io/11.x/settings)）。
3. `esbuild` 等原生依赖需要显式授权 postinstall 脚本。

单包项目（非 monorepo）的 `pnpm-workspace.yaml` 正确写法示例：

```yaml
packages:
  - '.'
allowBuilds:
  esbuild: true
```

**禁止**使用以下已废弃或无效写法：

```yaml
# 错误：缺少 packages 字段
allowBuilds:
  esbuild: true

# 错误：v11 已废弃 onlyBuiltDependencies
onlyBuiltDependencies:
  - esbuild

# 错误：.npmrc 里的 only-built-dependencies 在 v11 中不被读取
only-built-dependencies=esbuild
```

### 4.2 CI 环境

GitHub Actions 中使用 `pnpm install --frozen-lockfile`，不能执行交互式 `pnpm approve-builds`。因此必须在 `pnpm-workspace.yaml` 中静态声明 `allowBuilds`，否则 CI 会报 `ERR_PNPM_IGNORED_BUILDS`。

## 5. 部署渠道分工

前端存在两条预览/部署渠道，必须严格区分：

| 渠道 | 触发分支 | 用途 | 入口 |
|------|----------|------|------|
| GitHub Pages | `design/*`、`feature/prototype-*` | 产品经理/设计师预览原型 | `.github/workflows/deploy-prototype.yml`、`deploy-pages.yml` |
| Vercel | `feature/module-*`、`develop`、`main` | 开发工程师提交模块功能预览 | Vercel Git 集成 |

### 5.1 Vercel 忽略原型分支

为避免设计/原型分支触发 Vercel 构建，在 `vercel.json` 中配置 `ignoreCommand`：

```json
{
  "ignoreCommand": "if [[ \"$VERCEL_GIT_COMMIT_REF\" == design/* ]] || [[ \"$VERCEL_GIT_COMMIT_REF\" == feature/prototype-* ]]; then echo 'Skip prototype branch'; exit 0; else exit 1; fi"
}
```

规则：返回 `0` 跳过构建，返回 `1` 继续构建。`VERCEL_GIT_COMMIT_REF` 为当前分支名。

**Agent 必须遵守**：任何涉及 `design/*` 或 `feature/prototype-*` 分支的提交，不得让 Vercel 产生预览链接；原型预览统一走 GitHub Pages。

## 6. 提交前验证

> **v1.25 去重**：测试 / lint / dev server 启动验证的完整命令与流程见 [`04_Testing_Standard.md`](04_Testing_Standard.md) §4（前端部分）；本节仅保留要点提醒。

- 除 `pnpm test` 和 `pnpm lint` 外，必须验证前端 dev server 能实际启动并访问（`curl` 首页返回 200）；
- 如果模块新增/修改了页面，必须额外访问对应路由验证；
- 验证完成后必须停止服务，避免端口占用；
- 完整命令见 [`04_Testing_Standard.md`](04_Testing_Standard.md) §4.2。

## 7. 与 Prometheus UI 的关系

| 场景 | 方案 |
|------|------|
| 完全产品化门户 | 使用 `ui-custom/`，独立部署 |
| 小改 Prometheus UI | 在 `patches/prometheus/ui/` 中管理 patch |
| 调试原生功能 | 直接访问 `http://localhost:9090` |

**第一版推荐独立 `ui-custom/` 门户。**

---

## 8. 交互组件选型决策表（跨模块强制）

为保证按模块开发时全局体验一致，容器与组件选型按下表统一，**所有模块共用**；模块 PRD / 原型偏离本表必须显式标注理由并记录到该模块 `docs/05-execution-records/module-XX/design-decisions.md`：

| 场景 | 统一选型 | 说明 |
|------|----------|------|
| 查看详情（结构化、字段多） | 右侧 Drawer，宽 ≥720px | 禁止用 Modal 承载多字段详情 |
| 创建 / 编辑表单（≤6 个字段） | Modal | 短表单不跳页面 |
| 创建 / 编辑表单（>6 个字段或需分组） | Drawer 内表单 | 分组多时可用 Tabs / Steps 分区 |
| 二次确认 / 破坏性操作 | `Modal.confirm` | 危险操作红色按钮；不可逆操作需输入名称确认 |
| 多步流程（向导） | 独立页面 + Steps | 禁止弹窗嵌套弹窗 |
| 关联清单 / 实例列表（百级以上） | Table + 分页 + 搜索 + 筛选，或大 Drawer 内嵌 Table | 禁止 Popover / Alert / 平铺 Tag 承载 |
| 状态语义（在线 / 离线 / 告警等） | Badge 语义色 + 文字标签 | 颜色不得作为唯一语义 |

## 9. 列表与长文本规范（跨模块强制）

1. **截断**：表格文本列默认 `ellipsis: { showTitle: true }`（截断 + 悬浮全文）；描述 / 摘要类字段统一截断 + Tooltip，完整内容进详情 Drawer；优先复用 `src/components/` 共享件（如 `EllipsisText`），禁止散点手写 `maxWidth` 内联样式。
2. **行高**：表格行内禁止渲染多行文本块；行内 Tag 最多 3 个，超出 `+n` 折叠（悬浮展示全部）。
3. **列数过多 → 横向滚动**：表格列超出一屏时，设置 `scroll={{ x: ... }}` 启用底部横向滚动条，并将主标识列 `fixed: 'left'`、「操作」列 `fixed: 'right'`；**禁止**通过压缩列宽迫使单元格换行来适配——换行会撑高行高、破坏扫读。列宽按内容类型定宽（时间、状态等固定窄宽）。
4. **列数治理**：列表页默认只展示扫读所需的关键列（建议 ≤8 列），其余字段下沉详情 Drawer（渐进式披露）。该条由 `scripts/check-prototype.py` 自动检查（阈值 8 列，超限输出结构警告）：它识别 `columns={[...]}`、`const cols: TableProps<X>['columns'] = [...]`、`const columns = [...]` 三种列定义形态，并**按列定义数组的顶层元素个数**计数——因此把列标题抽成列工厂（`identityColumn(...)`）不影响检测，但若列数组由函数动态返回（如 `columns={getColumns(type)}` 且数组定义在别处），需人工自查。

## 10. 页面状态处理规范（跨模块强制）

每个页面 / 区块必须覆盖以下状态，具体文案与行为以该模块 PRD「前端交互契约」章节为准：

| 状态 | 统一行为 |
|------|----------|
| 加载中 | Table / Card 用骨架屏或 `loading`；按钮提交中置 loading 防重复提交 |
| 空态 | 区分「无数据」与「无权限」；空态给出引导动作（如「去创建」按钮） |
| 接口错误 | `message.error` 提示 + 页面保留旧数据；列表加载失败展示错误态与「重试」按钮 |
| 权限不足 | 隐藏操作入口，或禁用 + Tooltip 说明原因；整页无权限展示 403 页 |
| 数据超量 / 边界 | 列表分页（默认 20/页）；下拉选项 >20 项用 `showSearch`；超长输入前端先行校验 |

## 11. 构建与测试类型隔离（跨模块强制）

`pnpm build` 的脚本为 `tsc && vite build`，其中 `tsc` 会按 `tsconfig.json` 的 `include` 对所有源码做类型检查。为避免生产构建把测试文件里的 Vitest / Chai `expect` 类型冲突也纳入检查，必须将测试文件从生产构建的类型检查中排除，测试类型由 Vitest（`vitest.config.ts`）独立检查：

`ui-custom/web/tsconfig.json`：

```json
{
  "compilerOptions": { ... },
  "include": ["src"],
  "exclude": [
    "src/setupTests.ts",
    "src/**/*.test.ts",
    "src/**/*.test.tsx"
  ],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- **生产构建**：`tsc` 仅检查业务代码，测试文件不参与**生产构建**的类型检查；
- **测试类型检查（独立配置，强制）**：测试文件**并非不受任何类型检查**，而是由 `tsconfig.test.json` 单独检查。`pnpm run typecheck:test` 为该配置的入口，且已前置串联进 `pnpm test`；CI 由 `.github/workflows/check-frontend.yml` 在 PR / push 到 `develop` 时强制执行。**禁止**用运行时对象字面量绕过类型层「伪证」某个字段已接通——这类伪证会在 `tsc` 报出 excess property 时现形（原 `resources.test.ts` 即因此掩盖过 `platform_code` 类型缺口）；
- **测试运行**：走 `vitest run`，不依赖 tsconfig 的 include，不受排除影响；
- **禁止**为了绕过构建而给测试加入 `@ts-ignore` / 任意 `any`，也不允许删除测试文件；
- 新增测试文件请沿用 `*.test.ts(x)` 命名，确保被统一排除规则覆盖。

`ui-custom/web/tsconfig.test.json`（测试文件专用，v1.34 起，跨模块强制）：

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": [
    "src/vite-env.d.ts",
    "src/setupTests.ts",
    "src/**/*.test.ts",
    "src/**/*.test.tsx"
  ],
  "exclude": []
}
```

- `exclude: []` 必须显式清空——父配置的 `exclude` 会被继承（其中排除 `*.test.ts(x)`，与本配置意图冲突）；
- `types` 引入 Vitest 全局 API，避免污染业务代码类型；
- `src/vite-env.d.ts` 必须显式纳入：它提供 `import.meta.env`（`vite/client`），生产构建靠 `include: ["src"]` 隐式带入，本配置 include 收窄后需显式列出；
- **此配置不改变生产构建口径**：`tsconfig.json` 与 `pnpm build` 的 `tsc` 均不因此改动。

**门禁层级（三层，缺一不可）**：

| 层 | 载体 | 覆盖 |
| --- | --- | --- |
| 本地单测 | `pnpm test`（= `typecheck:test` + `vitest run`） | 全量类型 + 单测 |
| 本地构建 | `pnpm build` | 生产 tsc + vite 打包 |
| 远端 CI | `.github/workflows/check-frontend.yml` | `typecheck:test` + `build`（刻意不含全量 vitest，见 workflow 内注释） |

`scripts/git-hooks/pre-commit` **不**包含前端类型门禁：单次 tsc 约 20~40 秒，与既有的秒级 `check-repo-map` 体验差异过大，且只护本地、不构成最终防线。最终防线以 CI 为准。

**ESLint 配套（v1.33 起，跨模块强制）**：`eslint.config.js` 必须与 tsconfig 排除口径一致，否则类型感知 lint 会对被排除的测试文件报 `The file was not found in any of the provided project(s)`。规则：

1. 主配置块（`files: ['src/**/*.{ts,tsx}']`）保留 `parserOptions.project: './tsconfig.json'`，仅对业务代码做类型感知解析；
2. 追加一个测试文件专用配置块（`files: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/setupTests.ts']`），将 `parserOptions.project` 置 `null` 禁用类型感知解析（typescript-eslint 官方支持），规则集与主块保持一致；
3. 项目级关闭核心规则 `no-undef`（`'no-undef': 'off'`）——TS 已做类型检查，避免误报 `ResponseInit` 等 TS/DOM 全局类型未定义；
4. 禁止使用 flat config 的 `excludes` 键（当前 `@eslint/config-array` 版本不支持，会报 `Unexpected key "excludes"`）。

> ⚠️ 注意：`excludes` 与 `project: null` 二选一时用后者；若升级 ESLint 后 `excludes` 可用，仍以 `project: null` 方案为准保持行为稳定。

## 12. 测试内存护栏（跨模块强制）

`jsdom` + `antd v5` 的组合单文件内存开销远高于直觉。**8 GB 机型实测**：

| 指标 | 实测值 |
| --- | --- |
| 单个测试文件峰值 RSS | 680~770 MB（`HomePage.test.tsx` 76K → 684 MB；`ResourcesPage.test.tsx` 48K → 772 MB） |
| 全量 94 文件按默认并发（8 核 → 8 worker） | 瞬时需求可超 8 GB 物理内存 → swap 风暴 |
| 换页计数 | `Pageins` 达 9213 万次、swap 占用 4.0 / 5.4 GB |
| 表现 | **测试「卡住不动」**（非变慢）；严重时进程被 macOS `SIGKILL`，退出码 **137** |

`vitest.config.ts` 已内置护栏（v1.35 起，跨模块强制）：

1. **`minWorkers: 1` + `maxWorkers: 2` 必须成对设置**。vitest 2.x 的 `minWorkers` 默认等于 CPU 核数，**只设 `maxWorkers` 会直接报错**：
   `RangeError: options.minThreads and options.maxThreads must not conflict`。
2. **`pool: 'forks'` + `poolOptions.forks.execArgv: ['--max-old-space-size=1024']`**：限制每个 fork 子进程的 V8 堆上限，让 V8 更早触发 GC 而不是无限膨胀。实测单文件峰值 **684 MB → 396 MB（-42%）**，且 GC 更及时反而更快（29s → 9.7s，单文件带 typecheck 口径）。
3. **用 `poolOptions.execArgv` 而非 `NODE_OPTIONS` 环境变量**：后者在 Windows 下需额外引入 `cross-env` 才能生效，而本项目支持 Win 平台（`setup-windows.sh` / `SETUP_WINDOWS.md`）。
4. **不牺牲正确性换内存**：`isolate` 保持默认 `true`（测试文件间环境隔离），不开启单文件复用环境；`testTimeout: 15000` 保持不变（护栏解决的是内存，不是超时）。

**诊断口诀**：`pnpm test` 卡住不动时，先看退出码——**137 = 被系统 SIGKILL（内存）**，不是测试本身有问题。再看 `sysctl vm.swapusage` 与 `memory_pressure | grep free percentage`；注意 `memory_pressure` 的"free percentage"在 swap 已耗尽时**仍可能报 40%+**，不能只看它。

临时需要全速验证可 CLI 覆盖（会失去内存护栏，8 GB 机型慎用）：

```bash
pnpm vitest run --minWorkers=8 --maxWorkers=8
```

> 补充：`/usr/bin/time -l` 的 `maximum resident set size` 是测单文件内存峰值的有效手段；但**不要用它跑全量**（`-l` 本身在长任务上会额外占用内存，且读数含 time 进程自身开销）。

### §12 补充：增量验证（`--changed`）实测行为

`pnpm vitest run --changed <base>` 由 vitest 依据 git diff 筛选受影响的测试文件（含依赖图传导），是**缩短反馈周期**的标准手段。实测（8 GB 机型）：

| base | 命中情况 | 表现 |
| --- | --- | --- |
| `--changed ../origin/develop`（工作区已全部提交） | 0 个文件 | exit 0，秒退。**不是 bug**——diff 为空故无命中 |
| `--changed HEAD~1`（该 commit 仅改 Go / 文档 / workflow） | 0 个文件 | exit 0，秒退。同上 |
| `--changed HEAD~5`（命中 C3 的 20 个前端文件） | 20 个文件 | 因含 `ResourcesPage.test.tsx`（34.5 s）而内存吃紧，**在系统 swap 已耗尽时被 SIGKILL（exit 137）** |

**要点**：
1. `--changed` 结果为空时**不要当成失败**——先看 `git diff --name-only <base>` 确认该范围内确无测试文件。
2. `--changed` 命中面**不含"改动文件对应的测试文件"以外的内容**，但**包含依赖传导**（改了 `src/api/resources.ts` 会带出 `resources.test.ts`）。
3. 基路径需为仓库内可解析的 ref。`ui-custom/web/` 不是仓库根，用 `../origin/develop` 或 `HEAD~N` 均可。
4. **exit 137 一律按内存问题处理**，不要重试到通过为止（见上文诊断口诀）。

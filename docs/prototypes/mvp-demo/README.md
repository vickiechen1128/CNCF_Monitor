# MetricCenter MVP 可点击原型

> 本目录为 `feature/prototype-mvp-demo` 历史原型按新规范迁移后的独立原型项目。
> 新规范下，所有模块原型统一放在 `docs/prototypes/<module-or-name>/`，不混入 `ui-custom/web/` 生产代码目录。

## 页面清单

| 路由 | 页面 | 说明 |
|------|------|------|
| `/` | 首页 Dashboard | 资源总数、采集覆盖率、当前告警、资源分布、最新告警、最近活动 |
| `/resources` | 资源管理 | 主机/中间件/应用服务列表，Excel 导入入口，新增资源按钮 |
| `/config` | 配置管理 | 标签模板、采集 Job、拨测配置三个标签页 |
| `/config-preview` | 配置生成/下发 | 生成 `prometheus.yml` 预览、一键下发按钮、步骤条 |
| `/query` | 指标查询 | PromQL 输入、指标建议、查询结果表格、常用查询 |
| `/collection` | 采集状态 | 采集目标状态、拨测结果 |
| `/alerts` | 告警状态 | 当前告警列表、级别、摘要、展开详情 |

## 技术栈

- React 18 + TypeScript
- Vite 5
- Ant Design 5
- React Router 6
- 本地 mock 数据（无真实 API 调用）

## 本地运行

```bash
cd /Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree/docs/prototypes/mvp-demo
pnpm install
pnpm dev
```

**本地开发访问地址：http://localhost:5173/**

> 注意：本地 `pnpm dev` 使用默认 base `/`，不要访问 `http://localhost:5173/CNCF_Monitor/`，否则会报 404 或 Internal Server Error。
> GitHub Pages 的 `/CNCF_Monitor/` 路径只在生产构建和线上部署时生效。

## 验证

```bash
pnpm lint
pnpm build
```

## 模拟 GitHub Pages 本地预览

如果你想在本地验证 GitHub Pages 部署效果（带 `/CNCF_Monitor/` 路径）：

```bash
pnpm preview:gh-pages
```

然后访问：http://localhost:4173/CNCF_Monitor/

## 与旧位置的区别

| 维度 | 旧位置 | 新位置 |
|------|--------|--------|
| 页面 | `ui-custom/web/src/pages/prototype/` | `docs/prototypes/mvp-demo/src/pages/` |
| mock 数据 | `ui-custom/web/src/mocks/prototype/` | `docs/prototypes/mvp-demo/src/mocks/` |
| 项目类型 | 生产前端项目的一部分 | 独立 Vite 原型项目 |
| 分支 | `feature/prototype-mvp-demo` | 随 `design/module-XX` 或独立维护 |

## 在线预览方案

### 方案一：Vercel（推荐，支持多分支 PR 预览）

Vercel 最适合本项目的分支模型，可为每个 `design/module-XX` / `feat/module-XX` 的 PR 自动生成独立预览链接，方便产品经理在线验收。

1. 访问 https://vercel.com/new 导入 `vickiechen1128/CNCF_Monitor`
2. 在导入配置中设置：
   - **Framework Preset**: Vite
   - **Root Directory**: `docs/prototypes/mvp-demo`
   - **Build Command**: `pnpm build`
   - **Output Directory**: `dist`
   - **Install Command**: `pnpm install`
3. 部署完成后，每次 push 到任意分支都会自动触发部署
4. 为 `design/module-XX` 分支发起 PR 时，Vercel 会自动在 PR 评论区生成预览链接

> `vercel.json` 已包含在目录中，Vercel 导入时会自动读取上述配置。

### 方案二：GitHub Pages（适合单一原型展示）

如果只需要一个固定在线地址展示 MVP 原型，可以使用 GitHub Pages。

1. 将本目录下的 `.github/workflows/deploy-pages.yml`（参考示例）复制到仓库根目录 `.github/workflows/`
2. 进入仓库 **Settings → Pages → Build and deployment**
3. **Source** 选择 **GitHub Actions**
4. 触发一次 push 到 `develop` 或 `main`，Actions 会自动构建 `docs/prototypes/mvp-demo/` 并部署
5. 访问地址：`https://vickiechen1128.github.io/CNCF_Monitor/`

> GitHub Pages 一次只能部署一个站点，无法为每个 PR 生成独立预览。如果团队需要按模块/PR 验收，请优先使用 Vercel。

### 路由说明

本原型使用 `HashRouter`，URL 格式为 `https://<domain>/#/resources`。这是为了兼容 GitHub Pages、Vercel 等静态托管服务，避免刷新 404。

## 注意事项

- 本原型仅用于演示和评审，所有数据均为 mock。
- 如需修改，请在对应的设计分支 `design/module-XX` 上操作，或单独维护 `docs/prototypes/mvp-demo/`。
- 禁止将本原型代码复制到 `platform/` 或 `ui-custom/web/` 作为生产代码。

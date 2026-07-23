# Prototype MVP Demo - 执行记录

> 日期：2026-07-21  
> 分支：`feature/prototype-mvp-demo`  
> Agent：`prototype-designer`  
> 目标：在正式功能开发前，快速产出 MetricCenter MVP 高保真可点击原型，用于向领导和团队展示未来整体效果。

---

## 1. 原型目标

基于 `docs/02-product-requirements/` 中的 PRD，构建一个可演示的 Web 门户原型，覆盖 MVP 核心用户故事：

- 运维工程师可以从门户总览资源、采集、告警状态
- 可以管理主机、中间件、应用服务三类资源
- 可以配置标签模板、采集 Job、拨测配置
- 可以预览并一键下发 `prometheus.yml`
- 可以执行 PromQL 查询并查看结果
- 可以查看采集目标状态和拨测结果
- 可以查看当前告警列表

---

## 2. 页面清单

| 路由 | 页面 | 展示内容 |
|------|------|----------|
| `/` | 首页 Dashboard | 资源总数、采集覆盖率、当前告警、资源分布、最新告警、最近活动 |
| `/resources` | 资源管理 | 主机/中间件/应用服务列表，Excel 导入入口，新增资源按钮 |
| `/config` | 配置管理 | 标签模板、采集 Job、拨测配置三个标签页 |
| `/config-preview` | 配置生成/下发 | 生成 `prometheus.yml` 预览、一键下发按钮、步骤条 |
| `/query` | 指标查询 | PromQL 输入、指标建议、查询结果表格、常用查询 |
| `/collection` | 采集状态 | 采集目标状态、拨测结果 |
| `/alerts` | 告警状态 | 当前告警列表、级别、摘要、展开详情 |

---

## 3. 技术实现

- 技术栈：React 18 + TypeScript + Vite + Ant Design 5 + React Router 6
- 所有数据均为本地 mock，位于 `ui-custom/web/src/mocks/prototype/`
- 原型页面位于 `ui-custom/web/src/pages/prototype/`
- 使用 `MainLayout` 提供统一顶部标题栏和左侧导航菜单
- 未调用真实后端 API，未修改 `platform/`

---

## 4. Mock 数据说明

| 数据文件 | 内容 |
|----------|------|
| `dashboard.ts` | Dashboard 统计数据、最新告警、最近活动 |
| `resources.ts` | 主机、中间件、应用服务示例数据 |
| `config.ts` | 标签模板、采集 Job、拨测配置、生成的 prometheus.yml |
| `query.ts` | PromQL 查询结果、指标建议、常用查询 |
| `collection.ts` | 采集目标状态、拨测结果 |
| `alerts.ts` | 当前告警列表 |

---

## 5. 运行方式

```bash
cd /Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree/ui-custom/web
pnpm install
exec ./node_modules/.bin/vite --host
```

访问地址：http://localhost:5173/

---

## 6. 验证结果

- `pnpm lint`：通过，0 errors, 0 warnings
- `pnpm test`：通过（现有测试未受影响）
- Vite dev server：启动成功
- 浏览器验证：
  - 首页 Dashboard 渲染正确
  - 资源管理页面渲染正确
  - 配置生成/下发页面渲染正确
  - 指标查询页面渲染正确
  - 告警状态页面渲染正确

---

## 7. 已知问题与下一步建议

1. **图表占位**：Dashboard 和指标查询中暂未加入 ECharts/AntV 图表，仅用表格和统计数字展示，后续可补充趋势图。
2. **表单交互**：新增/编辑表单目前仅展示按钮，点击无实际弹窗，后续可补充 Modal 表单。
3. **Excel 导入**：目前仅为 UI 占位，无实际上传解析逻辑。
4. **后端未连接**：所有数据为 mock，后续模块开发时按 `feature/module-XX-<功能名>` 分支逐步替换为真实 API。

---

## 8. 按新规范迁移（2026-07-23）

为符合更新后的管理规范，将 MVP 原型从生产代码目录迁移到独立原型目录：

- **旧位置**：
  - 页面：`ui-custom/web/src/pages/prototype/`
  - mock 数据：`ui-custom/web/src/mocks/prototype/`
  - 运行方式：`cd ui-custom/web && pnpm install && vite --host`

- **新位置**：
  - 项目根目录：`docs/prototypes/mvp-demo/`
  - 页面：`docs/prototypes/mvp-demo/src/pages/`
  - mock 数据：`docs/prototypes/mvp-demo/src/mocks/`
  - 运行方式：`cd docs/prototypes/mvp-demo && pnpm install && pnpm dev`

- **迁移内容**：
  - 新增独立 `package.json`、`vite.config.ts`、`tsconfig.json`、`eslint.config.js`、`index.html`
  - 迁移 `MainLayout` 组件到 `src/layouts/`
  - 迁移 7 个页面组件到 `src/pages/`
  - 迁移 6 个 mock 数据文件到 `src/mocks/`
  - 调整所有导入路径
  - 新增 `README.md` 说明迁移背景与使用方式

- **验证结果**：
  - `pnpm lint`：通过，0 errors, 0 warnings
  - `pnpm build`：通过
  - `pnpm dev`：启动成功，访问 http://localhost:5173/ 返回 HTTP 200

- **注意事项**：
  - `feature/prototype-mvp-demo` 分支上的旧文件保留作为历史记录
  - 后续新模块原型统一按 `docs/prototypes/module-XX/` 规范创建
  - 禁止将 `docs/prototypes/mvp-demo/` 下的原型代码直接复制到 `platform/` 或 `ui-custom/web/` 作为生产代码

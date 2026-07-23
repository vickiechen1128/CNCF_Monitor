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

访问地址：http://localhost:5173/

## 验证

```bash
pnpm lint
pnpm build
```

## 与旧位置的区别

| 维度 | 旧位置 | 新位置 |
|------|--------|--------|
| 页面 | `ui-custom/web/src/pages/prototype/` | `docs/prototypes/mvp-demo/src/pages/` |
| mock 数据 | `ui-custom/web/src/mocks/prototype/` | `docs/prototypes/mvp-demo/src/mocks/` |
| 项目类型 | 生产前端项目的一部分 | 独立 Vite 原型项目 |
| 分支 | `feature/prototype-mvp-demo` | 随 `design/module-XX` 或独立维护 |

## 注意事项

- 本原型仅用于演示和评审，所有数据均为 mock。
- 如需修改，请在对应的设计分支 `design/module-XX` 上操作，或单独维护 `docs/prototypes/mvp-demo/`。
- 禁止将本原型代码复制到 `platform/` 或 `ui-custom/web/` 作为生产代码。

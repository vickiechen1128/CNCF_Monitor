# integration/v0.1：联调计划

## 1. 验收动线

### 动线 A：基础管理链路

| 步骤 | 页面/模块 | 操作 | 期望结果 |
|------|-----------|------|----------|
| 1 | 网域管理（M06） | 登记 `default` 网域 | 网域状态为「已纳管监控」 |
| 2 | 资源管理（M07） | Excel 导入 / 手动新增 Host | 资源列表展示正确，标签模板可用 |
| 3 | 策略（M01） | 创建 `standard` ScrapeJob，绑定 `default` 网域与资源 | Job 状态正确，change_status = none |
| 4 | 配置中心（M09） | 生成配置 → diff/preview → 确认下发 | 生成 `ConfigVersion`，`local` 通道 reload 成功 |
| 5 | 首页 Dashboard | 查看资源数、待确认草稿数 | 数据真实 |

### 动线 B：blackbox 拨测链路

| 步骤 | 页面/模块 | 操作 | 期望结果 |
|------|-----------|------|----------|
| 1 | 策略（M01） | 创建 `blackbox` ScrapeJob | 生成对应 `blackbox.yml` |
| 2 | 配置中心（M09） | 确认下发 | `blackbox.yml` 写入，blackbox exporter 可重载 |
| 3 | 查询（M02） | 查询拨测指标 | 数据可见 |

## 2. 任务分工

| Agent | 任务 | 输出位置 |
|-------|------|----------|
| `planner` | 联调动线规划、验收用例 | 本文档 |
| `frontend-developer` | 统一布局/导航、首页状态卡片、错误与空态 | `ui-custom/web/src/layouts/`、`ui-custom/web/src/pages/home/` |
| `backend-developer` | 首页聚合数据 API | `platform/` 新增/调整聚合接口 |
| `frontend-reviewer` | 审查门户串联代码 | review 记录 |
| `build-resolver` | 解决端到端验证中构建/测试问题 | 问题记录到 `issues.md` |

## 3. 验收标准

- [x] 各页面可通过统一侧边栏导航流畅切换
- [x] 首页展示资源数量、待确认配置草稿数、最近下发记录（`/api/v2/platform/dashboard/summary` 聚合）
- [ ] 端到端主链路跑通：网域 → 资源 → 策略 → 配置生成 → 确认下发 → Prometheus reload → 指标可见
- [x] `go test ./platform/...`、`go vet ./platform/...` 通过
- [x] `pnpm vitest run`、`pnpm lint` 通过（1 例 flaky 已归因，见 issues）
- [ ] 后端服务与前端 dev server 均可启动并返回 200
- [ ] README / 部署文档补齐 MVP 启动步骤与范围说明

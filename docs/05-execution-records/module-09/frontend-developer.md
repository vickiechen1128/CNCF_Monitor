# frontend-developer 执行记录 — Module_09（Phase 4，MVP）

> 归属：MetricCenter 前端开发（frontend-developer）
> 分支：`feat/module-09-config-center`
> 目标：按 `docs/05-execution-records/module-09/task-sequence.yaml` 顺序执行 T09-F1~F7，页面功能块闭环即 commit；评估修复（review-fix）闭环。

## 执行环境与工具

- 前端目录：`ui-custom/web/`（Vite + React 18 + TS + antd5）。
- 校验命令：`cd ui-custom/web && pnpm lint` / `pnpm vitest run <文件>`（单任务）· `pnpm test` 全量（Phase 收尾）· `npx tsc --noEmit` / `pnpm build`（收尾）。
- dev server 验证：`exec ./node_modules/.bin/vite --host`，curl `http://localhost:5173/` 与受影响路由 200，验证完停服释放端口。

## 提交清单（含 commit hash + 任务 id）

| task id | 主题 | commit |
|---------|------|--------|
| T09-F1 | types + API client + 枚举/常量（config-center 契约落地） | `e46d5057` |
| T09-F2 | 网域纳管页：7 列 + 详情抽屉 + 行内纳管/编辑 + 安装指引占位 | `830d45be` |
| T09-F3 | 采集节点状态页：MVP 空态引导 | `f22f4689` |
| T09-F4 | 配置变更确认页：网域切换/mm 摘要/清单/预览/Diff + 确认/废弃/重校验 | `e96f4692` |
| T09-F5 | 下发记录页：列表 + 详情 + local 重试/回滚 + 定位参数 | `f622267c` |
| T09-F6~F7 | 导航挂载一级菜单组 + 四路由注册 + 集成收尾 | `a0a41c81` |
| review-fix HIGH-1/MEDIUM-1/LOW-1 | Token 明文仅一次性 Modal 展示，列表仅脱敏串（PlainTokenModal） | `599c6530` |
| review-fix MEDIUM-2/LOW-2 | 版本对比真实 diff source_version + 全部网域显式选项 | `e4f58487` |
| docs | frontend-prototype-map 凭据列偏离记录（review-fix） | `a97fc875` |

## 关键实现说明

- **契约优先**：类型与 API 以 `api-contract-snapshot.md` 为第一权威（snake_case），未反向读取 `platform/models/*.go`。Token 契约口径与后端确认：list 不返回明文 `token`（`json:"-"`），明文仅在 `/monitor`、`/reset-token` 单次返回 → 列表凭据列仅展示脱敏串、移除复制明文入口，明文经 `PlainTokenModal` 一次性展示。
- **T09-F6 导航**：MainLayout 支持 antd Menu 一级菜单组；`resolveActiveModule` 将 `/domain-onboarding`、`/node-status`、`/config-preview`、`/deployments` 归入一级 tab「系统与平台管理」（key=platform-admin）；Sider 两个组「网域与节点管理」「配置下发」；既有 M06「网域管理」(`/admin/domains`) 保留并存。
- **T09-F4 配置变更确认**：预览四 Tab（变更摘要/变更清单/配置预览条件 Tab/版本对比 diff）；30s 轮询变更检测；受影响配置文件高亮 + 默认聚焦首受影响 + 「影响 N/M 个文件」；技术信息（源数据版本/生成器版本/checksum）下沉折叠。版本对比 diff 依赖后端 `source_version` 回填（review-fix，见 backend-developer.md）。
- **T09-F5 下发记录**：local 且 failed 才展示「重试」；agent_pull 不展示；`?change_no` + `?network_domain` 深链定位。
- **共享组件**：长文本用 `EllipsisText`、表格列复刻原型、状态矩阵覆盖加载/空态/接口错误/权限不足。

## review-fix 修复说明

- **HIGH-1/MEDIUM-1/LOW-1（Token 明文安全）**：移除列表复制入口（`record.token || record.token_masked` 的根因复制脱敏串）；纳管 agent_pull 成功与 reset 成功均改用 `PlainTokenModal`（含复制明文 + 安全提示），不再 `message.success` 内嵌明文。
- **MEDIUM-2（版本对比真实 diff）**：`source_version` 存在时调用 `deploymentApi.getConfigVersion` 拉基线产物，`renderDiffTab` 三态（加载/真实 diff/降级 Alert）；修复 `computeDiff` 纯替换尾部漏行 bug（主循环 + 双收尾循环）；新增 `fileTextByKey` 兼容 Draft/Version 读产物。
- **LOW-2（全部网域）**：网域 Select 用显式「全部网域」显式选项替代 `allowClear`，值映射 `undefined` 跨域查询。

## 验证结果

- 单任务 `pnpm vitest run <目标文件>` 与 `pnpm lint` 通过。
- Phase 收尾全量：`pnpm test`（43 文件 / 305 用例）通过、`pnpm lint` 0 警告、`npx tsc --noEmit` 通过、`pnpm build` 成功（M09 四页独立懒加载 chunk）。
- dev server 验证：`/`、`/domain-onboarding`、`/node-status`、`/config-preview`、`/deployments` 均 200，验证后停服释放端口。

## 备注

- 后端契约口径（list 不返回明文 token、source_version 回填为上一确认版本 change_no、`/config-versions/{id}` 兼容 change_no）由 backend-developer 落实，前端按既有 `getConfigVersion` 拉取零改动；详见 `backend-developer.md` 与 `dev-feedback.md`。
- 前端原型映射表 `frontend-prototype-map.md` 的凭据列偏离记录已在 review-fix 更新。
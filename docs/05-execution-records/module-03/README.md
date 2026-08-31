# Module 03 执行记录索引

> 说明：Module_03（网关与认证）的**轻量认证 + 租户/用户管理**（决策 44，Track B/B+ 增量）原独立存放于 `module-06-tenant-user-auth/`。因该目录不属于任何独立模块命名规范，已**整体归拢**至 module-06 下的 `track-b-increment-decision-44/` 子目录（保留全部记录不变）。本模块相关的认证 / 会话 / 登录页记录，参见下方指向。

## Track B/B+ 增量（决策 44）记录位置

- **统一子目录**：`docs/05-execution-records/module-06/track-b-increment-decision-44/`
- 覆盖模块：Module_06（租户 / 用户管理 + 登录日志）+ **Module_03（轻量认证：login/logout/me/自助改密、认证中间件、会话、登录页）**

| 文件 | 说明 |
|------|------|
| `task-sequence.yaml` | L3 任务序列（tu-01~04 / au-01~02 / f-01~04 / sec-01），涵盖 M06 与 M03 认证任务 |
| `api-contract-snapshot.md` | API 契约快照，§1 认证（Module_03 §4.0）/ §2 用户 / §3 租户 |
| `backend-developer.md` | 后端实现记录（含 M03 认证 tu/au 任务） |
| `dev-feedback.md` | 开发反馈单（FB-01~07，Session 字段集等 M03 认证契约留痕） |
| `review-precheck.md` | 审查预检报告（sec-01 security-reviewer，Track B+ 强制关卡） |

## 关联文档

- `docs/02-product-requirements/Modules/Module_03_Gateway_and_Auth.md`
- `docs/prototypes/module-03/`
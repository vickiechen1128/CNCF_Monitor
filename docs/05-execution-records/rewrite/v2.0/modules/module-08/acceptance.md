# Module 08 验收标准（acceptance）

> **状态**：draft（B0 起草，待 owner 评审冻结）
> **分支**：`rewrite/v2.0`
> **权威需求**：M08 SRS v1.3 §5（FR-01~26）、§6（NFR-01~12）、§9（验收标准）
> **关联任务**：`backend-task-sequence.yaml`
> **说明**：证据列在任务完成后回填测试名 / 命令 / 记录；未达标项登记为 open。
> **NFR-08 口径**：加密存储按 D45 承接至全局凭据加密改造，本模块验收以「零明文暴露」为准，`deferred` 不计失败。

---

## 1. 功能验收（FR）

| FR | 需求 | 实现任务 | 验证方式 | 证据 | 状态 |
|---|---|---|---|---|---|
| FR-01 | 默认配置 seed 幂等（根路由 + default 空接收人 + global） | T08-B2-3 | 单测：两次启动 count 不变；默认内容可被保存覆盖 | 待回填 | pending |
| FR-02 | 路由树 → 整份 `alertmanager.yml`（global + route + 保留抑制 + 被引用 receivers） | T08-B4-1 / T08-B5-3 | golden：树转 YAML 稳定、checksum 可复现 | 待回填 | pending |
| FR-03 | 抑制规则与路由共用生成器，显式空数组清空，不覆盖路由段 | T08-B7-2 | 单测：抑制保存后 route 段逐字节不变 | 待回填 | pending |
| FR-04 | 任何保存必须过 `amtool check-config`，失败不落库不 reload，返回行级错误 | T08-B4-2 | 单测：失败路径无快照、无 reload 调用、`data.validation.items` 有行号 | 待回填 | pending |
| FR-05 | 告警配置页只读，无导入/手写/重挂/模式切换入口 | T08-B2-2 / T08-F1-2 | 路由清单 grep + 前端页面审查 | 待回填 | pending |
| FR-06 | 保留最近生效历史，只读展示，不支持回滚 | T08-B4-3 | 单测：历史不可编辑；grep 无 rollback/restore 端点 | 待回填 | pending |
| FR-07 | 内部 Reload：原子写 → reload → 验证 → 日志 → 失败回退；管理员可手动重载当前生效配置 | T08-B5-1 / T08-B5-2 / T08-B5-4 | 单测：成功/失败/回退/手动重载四路；`m08_reload_logs` 字段齐全；手动重载不产生新快照 | 待回填 | pending |
| FR-08 | 生效配置快照同步 M09 | T08-B8-1 | 单测：sink 入参正确；M09 落只读历史且不切 current | 待回填 | pending |
| FR-09 | 渠道 CRUD（飞书/钉钉/企微/Webhook）、SSRF、无 enabled、被引用 409 | T08-B3-1 | 单测：四类型 + SSRF 拒绝 + 409 | 待回填 | pending |
| FR-10 | 模板按类型 Tab、内置只读可复制、可变实体不进 yml、被绑定禁删 | T08-B3-2 | 单测：内置 403/绑定 409/语法错误 400 | 待回填 | pending |
| FR-11 | 仅物化 default 与被引用渠道 `notify-<id>` | T08-B4-1 | golden：未引用渠道不出现在 receivers | 待回填 | pending |
| FR-12 | 渲染桥 `webhooks/notify?id=`，IM 渲染加签、Webhook 原样转发、仅接受 ID | T08-B3-3 | 单测：URL 参数拒绝、未知 ID 404、正常投递 | 待回填 | pending |
| FR-13 | 树形路由新增/编辑/删除、matcher、接收人、分组、时长、continue、启用、根锁定 | T08-B4-1 / T08-B2-2 | handler 单测 + golden | 待回填 | pending |
| FR-14 | `base_checksum` 乐观锁，不一致 409 | T08-B4-3 | 单测：并发保存仅一成功；过期 409 | 待回填 | pending |
| FR-15 | 接收人候选 = `default` ∪ 全部渠道 `notify-<id>`，保存仅物化被引用 | T08-B4-1 | 单测：候选集与物化集分离 | 待回填 | pending |
| FR-16 | 静默 CRUD，走 AM v2 API 即时生效，不进 reload 链路；创建/删除留痕（含越权拒绝） | T08-B7-1 / T08-B7-4 | 单测：创建/列表/删除无 reload；审计两路落库；查询筛选生效 | 待回填 | pending |
| FR-17 | 静默 matcher 的 `network_domain_id` 必须 ∈ 授权集合，越权拒绝 | T08-B7-1 | 单测：越权 403、授权内成功 | 待回填 | pending |
| FR-18 | 抑制独立页面 CRUD + 启停 + 检索分页，字段 `source/target_matchers`/`equal`/`enabled`；规则独立持久化 | T08-B7-2 | 单测：四操作 + keyword/enabled 检索 + 字段完整 | 待回填 | pending |
| FR-19 | 预置「网域离线抑制次生告警」规则，可启停调参，不可删 | T08-B7-2 / T08-B2-3 | 单测：DELETE 预置 → 409；PATCH 成功 | 待回填 | pending |
| FR-20 | 抑制保存整份重建但保留路由；分段 pending 提示 | T08-B7-2 | 单测：`pending_sections=inhibit_rules_changed` | 待回填 | pending |
| FR-21 | 每个 receiver 追加内置 webhook `webhooks/alerts`，恒 2xx，不可删除 | T08-B6-1 / T08-B4-1 | 单测：畸形 payload 仍 200；yml 中恒存在 | 待回填 | pending |
| FR-22 | 分钟级对账：补插、关闭消失行、对齐静默/抑制，按 occurrence_key 去重 | T08-B6-2 | 单测：三类场景 + 去重 | 待回填 | pending |
| FR-23 | 当前告警默认展示未结三态，支持筛选分页，首页同源 | T08-B6-3 | 契约测试：字段与 legacy 一致 | 待回填 | pending |
| FR-24 | 历史告警七态、多维筛选、CSV 导出 | T08-B6-3 / T08-F1-2 | 单测：七态筛选；前端导出用例 | 待回填 | pending |
| FR-25 | 实例名按 `resource_id` 回连回填；采集地址取 `instance`；缺失显示 `-` | T08-B6-3 | 单测：命中/未命中/无 resource_id 三路 | 待回填 | pending |
| FR-26 | 保留 AM `/api/v2/alerts` 代理，四态归一 | T08-B7-3 | 单测：四态归一 + 上游错误映射 | 待回填 | pending |

---

## 2. 非功能验收（NFR）

| NFR | 需求 | 实现任务 | 验证方式 | 证据 | 状态 |
|---|---|---|---|---|---|
| NFR-01 | `route` 段唯一作者 = 平台 | T08-B4-1 / T08-B5-3 | 代码审查 + grep：无手写 route 入口 | 待回填 | pending |
| NFR-02 | 取消整份配置挂载逃生门 | T08-B2-2 / T08-F1-2 | 路由清单 + 页面审查：无导入/重挂/模式切换/`route-setting` | 待回填 | pending |
| NFR-03 | 原子写、失败回退、reload 记录持久化 | T08-B5-1 / T08-B5-2 | 单测：三路 + 日志字段 | 待回填 | pending |
| NFR-04 | 快照、reload 日志与静默留痕只读、不可回滚/删改 | T08-B4-3 / T08-B7-4 | 单测 + 路由清单 grep（无 PUT/DELETE audit 端点） | 待回填 | pending |
| NFR-05 | 校验即守门：未过校验不得 reload / 覆盖 | T08-B4-2 / T08-B5-3 | 单测：失败路径无 apply 调用 | 待回填 | pending |
| NFR-06 | 静默/抑制作用域隔离 | T08-B7-1 / T08-B7-2 | 单测：越权 matcher 拒绝 | 待回填 | pending |
| NFR-07 | SSRF 防护（私网/环回/link-local/云元数据，显式放行开关） | T08-B3-1 | 单测：四类地址全拒 + 开关生效 | 待回填 | pending |
| NFR-08 | 敏感信息保护 | T08-B3-1 | **本期口径**：接口/日志零明文 + `secret_set` 布尔；加密存储 `deferred → D45` | 待回填 | partial（deferred） |
| NFR-09 | `alert_events` 保留 180 天，未结不清 | T08-B6-4 | 单测：未结不删；超期删；天数可配 | 待回填 | pending |
| NFR-10 | 对账单轮 ≤30s；reload 保存后 5s 内完成 | T08-B6-2 / T08-B5-1 | 单测计时 + 集成观测 | 待回填 | pending |
| NFR-11 | 界面业务语言，技术术语仅折叠区/注释 | T08-F1-2 | 页面文案审查 | 待回填 | pending |
| NFR-12 | 错误提示可执行（校验/ reload /引用/越权） | T08-B4-2 / T08-B5-3 / T08-F1-2 | 错误文案用例 | 待回填 | pending |

---

## 3. 门禁

| 门禁 | 内容 | 命令 |
|---|---|---|
| G3-后端 | 目标测试 + 全量 + vet | `go test ./platform/modules/m08/...`；`make test-platform`；`go vet ./platform/...` |
| G3-迁移 | 00009 Up/Down ×2 | `go test ./platform/db -run TestMigrateV3M08` |
| G3-前端 | 目标测试 + 类型 + lint | `pnpm vitest run src/pages/alerts src/api`；`pnpm run typecheck:test`；`pnpm lint` |
| G3-启动 | v3-only 启动 + 冒烟 | `/api/v3/platform/system/modules` 含 m08 + 七组端点 curl |
| G4 | 新旧行为矩阵 + 迁移对账 | `module-08/regression.md`（V1-3 产出） |

---

## 4. 未达标处理

- `NFR-08` 标 `partial（deferred）`：不算 M08 验收失败，但必须在 handover 已知问题与发布前安全测评清单中显式列出（D45）。
- 其余 NFR / FR 未达标一律登记 open，禁止以「legacy 已实现」代替 v3 证据。
- 证据回填格式：`<测试名> + <命令> + <结果>`，不接受口头结论。

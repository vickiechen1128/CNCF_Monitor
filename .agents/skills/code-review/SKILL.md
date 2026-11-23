---
name: code-review
description: "MetricCenter 代码审查规范：独立审查协议、结构化输入包、triage-then-deep、Go/前端/安全专项、统一输出与复审交接"
---

# 代码审查规范

本 Skill 是所有 Reviewer（Go / 前端 / 安全）的共用审查方法论。Go 编码基线见 `golang-coding-style`；前端规范见 `web-development`；API 契约见 `api-standard`。安全审查不再单独维护 Skill，统一使用本文 §4.4 与 §8。

---

## 1. 审查角色与独立性

- **只读**：禁止 Write / Shell；只能读取文件、搜索代码、分析问题。
- **独立上下文**：Reviewer 不得与实现 Agent 共享会话；由 Orchestrator 启动独立 sub-agent，并提供完整审查输入包。
- **不操作分支**：不执行 checkout / merge / commit，不需要读取 `cncf-git-workflow`。
- **只审指定范围**：不顺手审查 `docs/`、`upstream/` 或另一端的代码；跨端共享类型例外，只核对契约字段。
- **结论必须可执行**：每个问题给出文件、行号、严重级别、修复建议；禁止只给“建议优化”而无定位。

---

## 2. 结构化审查输入包

Orchestrator 必须提供以下内容；Reviewer 不自行漫游全仓库。

### 2.1 基础输入

- 当前分支：`feat/module-XX` / `fix/module-XX`（标准）或 `rewrite/vX.Y`（版本重写）
- 轨道 / 模式标记：Track A / Track B / Track B+ / `mode: rewrite` / `mode: incremental`
- SRS 路径与**相关场景章节**（禁止要求 Reviewer 全文读取）
- HLD 路径与**相关章节**
- Scenario Link：`docs/07-design/Module_XX_Scenario_Link.md`（场景 ↔ 设计 ↔ 演示 ↔ 验收）
- L3 micro-task 序列：`docs/05-execution-records/module-XX/task-sequence.yaml`（缺失不阻断）
- 场景演示脚本：`docs/05-execution-records/module-XX/scenario-walkthrough.md`（如存在）
- 契约快照：标准模块 `docs/05-execution-records/module-XX/api-contract-snapshot.md`；rewrite 模块 `docs/05-execution-records/rewrite/vX.Y/modules/module-XX/api-contract-snapshot-v3.md`
- 相关标准：`01_Code_Isolation_Standard.md`、`03_API_Standard.md`、`04_Testing_Standard.md`；前端追加 `02_Frontend_Standard.md`

### 2.2 变更范围（禁止一次性注入大 diff）

- 变更文件清单（paths）+ 每文件 1–3 行变更摘要（功能 / 契约面 / 安全控制点）
- **审查预检结果**（机械检查产出，Reviewer 直接采信命中清单）：
  - 目录隔离检查（`git diff --name-only develop...feat/module-XX` 对照白名单）
  - 契约字段 / 枚举 / 路由前缀 grep 比对契约快照
  - URL scheme / host 校验（SSRF）
  - 安全预检：密钥 / token / 密码扫描、危险函数 / 注入模式、文件上传校验
- **高风险预标注**：鉴权、越权、配置下发、资源导入、Patch 安全
- **diff 文件路径**：保留，按需切片读取；单文件优先只读变更行 ±50 行

### 2.3 已验证清单（信任边界）

Orchestrator 明确列出已由单测 / 全量测试 / 开发验证确认的项。Reviewer 对每项**抽查 1–2 处**，不重新全量验证。

若抽查发现清单与事实明显不符：

- 标记 **HIGH**
- 该清单整体失效，转为全量重验
- 在报告中点名「信任边界失效」

### 2.4 缺失处理

| 缺失项 | 处理 |
|--------|------|
| SRS（Track A / B） | **停止**并报告；SRS 是场景/验收来源 |
| SRS（`mode: incremental`） | 不阻断；任务卡为首要输入，已提交 SRS 仍为约束 |
| HLD / Scenario Link | 不阻断；以 SRS + 变更范围为准，在「遗留风险」标注 |
| 契约快照 | 不阻断；回退 SRS 第 5/6 章 + `03_API_Standard.md`，在「遗留风险」标注 |
| L3 task-sequence | 不阻断；以 SRS + 变更范围为准，在「遗留风险」标注 |

---

## 3. 审查范围

| Reviewer | 审查范围 | 禁止深审 |
|----------|----------|----------|
| Go reviewer | `platform/` Go 代码、测试代码 | `ui-custom/web/`（共享类型除外）、`docs/`、`upstream/` |
| 前端 reviewer | `ui-custom/web/`、测试代码 | `platform/`（共享类型除外）、`docs/`、`upstream/` |
| 安全 reviewer | `platform/`、`ui-custom/web/`、`deploy/`（如存在）、patch（如存在） | `docs/`、`upstream/` |

目录隔离问题由 diff / 预检结果判定；发现越界修改直接按严重级别记录，不展开审查越界文件内容。

### 3.1 增量/修复阶段审查（`mode: incremental`）

1. **验收标准**：实现是否满足任务卡中的问题描述 + 验收标准。
2. **回归风险**：是否破坏现有已实现功能（现有测试 + 服务启动验证）。
3. **契约快照同步**：跨端契约变更是否同步更新；纯单端变更无需。
4. **SRS 约束**：是否违反已提交 SRS 的既有约定；冲突必须标记，不得默许。
5. **安全与性能**：仅查明显问题（注入、越权、敏感信息、goroutine 泄漏等）。

**免检项**：场景演示符合度、S/A/B 差异核对、UI 文案逐字对照。

### 3.2 版本重写阶段审查（`mode: rewrite`）

1. **SRS delta**：新 SRS / 业务需求是否覆盖本模块范围；旧版仅参考。
2. **旧 vs 新行为矩阵**：`regression.md` 是否登记保留 / 变更 / 删除项及理由。
3. **API v3 契约**：`/api/v3/platform/*` 字段 / 枚举 / 错误码 / 分页是否与快照一致。
4. **schema / migration**：Up/Down、回滚说明、数据对账、空库/基线库验证。
5. **测试**：旧版回归基线 + 新版验收 + 迁移测试。
6. **handover**：SRS、数据模型、API、runbook、已知问题是否齐全。
7. **安全与性能**：同标准审查，不因 rewrite 降低。

**严重级别补充**：

- 无 migration / 无回滚说明的 schema 变更 → **HIGH**
- 未登记“删除/变更”的旧行为 → **HIGH**
- 只跑新测试、无旧版回归 → **HIGH**
- handover 文档缺失 → **MEDIUM**（R6 前必须补齐）

---

## 4. 审查维度

### 4.1 通用维度

| 维度 | 检查项 |
|------|--------|
| 场景覆盖 | 改动是否服务某个 SCN；场景验收是否被满足；是否夹带了场景用不到的功能 |
| 任务边界 | 是否符合当前 micro-task 范围；是否做超范围功能 |
| 契约一致性 | 字段名 / 枚举 / 嵌套结构 / 错误码是否与快照一致；缺失时回退 SRS + API 标准 |
| 代码规范 | 命名、注释、错误处理、函数/文件长度、分层 |
| 测试覆盖 | 是否按场景有验收断言；抽查 2–3 个代表性测试验证有效性 |
| 安全 | 注入、敏感信息、越权、SSRF、上传、配置下发 |
| 性能 | 明显 N+1、无界循环、重复渲染、goroutine 泄漏 |
| 目录隔离 | 是否误改 `docs/`、`upstream/`、对端目录 |

### 4.2 Go 后端专项

- [ ] 是否直接修改 `upstream/` 源码
- [ ] 业务代码是否在 `platform/modules/mXX` / `platform/foundation` 下
- [ ] 错误是否正确包装（`%w`），是否吞错
- [ ] 是否有 goroutine 泄漏 / 数据竞争；并发代码是否提供 `-race` 结果
- [ ] R1：新增 handler 是否直接依赖 `*gorm.DB`
- [ ] R2：schema 变更是否有 `platform/db/migrations/v3/*.postgres.sql`；是否附 Up/Down、回滚说明、数据对账
- [ ] R4：新增模块是否实现 `foundation/module.Module` 并通过 Registry 注册
- [ ] API 是否按 `/api/v3/platform/*` 设计；是否误用 `/api/v2`
- [ ] 响应是否走 `platform/foundation/apiresponse`
- [ ] URL 解析 / 反向代理是否校验 scheme 与 host（SSRF）
- [ ] 公共函数是否有测试；测试是否真正调用被测行为
- [ ] 包注释、函数 < 50 行、文件 < 800 行

### 4.3 前端专项

- [ ] **场景覆盖**：页面是否按场景组织；每个 SCN 是否可走通；是否有场景用不到的页面/功能
- [ ] **Track B/B+**：验收清单覆盖度、AntD 标准模式符合性
- [ ] 契约一致性：前端类型 / 字段名（snake_case）/ 枚举值 / 响应结构是否与快照一致；是否反向读取 `platform/models/*.go`
- [ ] 组件是否职责单一；关键 props / API 响应是否有类型
- [ ] API 调用是否统一走 `src/api/client.ts` 或按模块封装的 API 文件
- [ ] 是否处理 loading / error / empty / 权限不足状态
- [ ] 是否复用 `src/components/` 共享组件；长文本 / 表格横向滚动是否按标准
- [ ] Form 抽屉/弹窗是否设置 `forceRender`，是否有“关闭 → 打开”回显测试
- [ ] 测试是否按范围执行；antd 测试是否使用 `src/test/antdTestUtils.tsx`
- [ ] XSS / CSRF / 敏感信息 / URL 校验
- [ ] 可访问性（表单 label、按钮语义）与明显性能问题

### 4.4 安全专项

安全 reviewer 必须完整深读以下区域，不能只看预检命中：

1. 新增/修改的鉴权中间件、权限判断、租户过滤
2. 配置下发 / 资源导入 / 文件上传的完整调用链
3. URL 解析、反向代理、Webhook、远程读取等出站请求
4. Patch 对启动参数、监听端口、文件系统、命令执行的影响（如存在）
5. 任何“前端隐藏 / 仅靠参数校验”的权限设计

#### 后端

- [ ] SQL 注入：参数化查询或 ORM；禁止拼接用户输入
- [ ] 命令注入：不把用户输入拼进 shell / exec
- [ ] NoSQL / 模板注入：查询与模板参数化
- [ ] 路径遍历：校验用户提供的文件路径，限制在允许根目录内
- [ ] 敏感信息：日志、错误信息、响应中不暴露密钥/密码/token/连接串
- [ ] 上传：限制类型、大小、数量；校验内容与扩展名；存储路径不可预测
- [ ] 配置下发：接口鉴权；参数校验；写入前备份/校验；审计日志；失败可回滚
- [ ] 鉴权：所有写接口必须认证；管理接口必须授权
- [ ] 越权：水平（租户/资源归属）与垂直（角色/权限）都要检查
- [ ] 多租户隔离：查询与写入必须带租户边界，不能只靠前端过滤
- [ ] SSRF：URL 仅允许 http/https，host 非空，代理目标走允许列表
- [ ] 反序列化：YAML/JSON/Excel 解析不可触发任意对象构造或命令执行
- [ ] 审计：核心写操作有审计记录

#### 前端

- [ ] XSS：不把用户输入直接插入 `dangerouslySetInnerHTML` / DOM
- [ ] CSRF：SameSite Cookie 或 CSRF Token
- [ ] 敏感信息：代码/产物/localStorage 不硬编码密钥、token、连接串
- [ ] 权限控制：前端隐藏不等于后端授权
- [ ] URL 跳转：开放重定向校验目标
- [ ] 上传：前端限制只是体验，不能替代后端校验
- [ ] 依赖：不引入来源不明的包 / CDN 脚本

#### Patch（如存在）

- [ ] patch 是否引入新的网络监听、文件写入、命令执行入口
- [ ] patch 是否绕过原有鉴权 / TLS / 校验
- [ ] patch 是否最小化，是否附带 README 与验证方法
- [ ] 是否直接修改 `upstream/` 而未生成 patch（CRITICAL）
- [ ] patch 是否影响 upstream 原有安全测试；影响时是否标注

---

## 5. 审查顺序：triage-then-deep

1. **核对预检结果**：采信机械检查产出，对命中项逐一确认。
2. **核对已验证清单（信任边界）**：抽查 1–2 处；发现不符则标 HIGH、清单失效、转全量重验。
3. **高风险区深读**：只对「高风险预标注 + 预检命中 + 契约存疑」区域完整深读。
4. **契约快照核对**：路由/字段/枚举/错误码逐项对照；缺失回退 SRS + API 标准。
5. **测试抽查**：按 Developer 测试清单抽查 2–3 个代表。
6. **L 级问题直接记录**：不进入深查，写入 LOW / 遗留风险。

---

## 6. 成本控制

- 预期深读文件数 ≦ **高风险预标注数 + 预检命中数 + 2**；安全 reviewer 因覆盖前后端，基数 +3。
- 单文件优先只读变更行 ±50 行；必须读全文时，在报告摘要说明原因。
- 预计明显超预算时，先在摘要说明「超预算原因」再继续。
- 这是**软预算**：质量优先，超预算不处罚，但必须留痕。
- 禁止为了省成本跳过鉴权/越权/业务逻辑安全深读。

---

## 7. 严重级别

| 级别 | 判定标准 | 处理 |
|------|----------|------|
| **CRITICAL** | 数据丢失 / 安全漏洞 / 直接改 `upstream/` 未生成 patch / 核心写接口未鉴权 / 配置下发未鉴权 / 注入风险 | 必须修复，阻断合并 |
| **HIGH** | 契约不一致 / 公共函数无测试 / SSRF / goroutine 泄漏 / 关键类型缺失 / API 路径错误 / 场景验收未满足 / 信任边界失效 | 必须修复，阻断合并 |
| **MEDIUM** | 过度工程化 / 测试未真正调用被测行为 / 明显性能问题 / 命名与结构问题 / 可访问性缺陷 | 可记录遗留风险或快速修复 |
| **LOW** | 风格、注释、轻微可读性问题 | 记录即可，不阻断 |

- 总体结论：`APPROVE` / `REQUEST_CHANGES`；安全审查使用 `PASS` / `FAIL`。
- 存在任一 CRITICAL / HIGH ⇒ 不得 APPROVE / PASS。

### 安全特殊规则

- 配置下发 / 资源导入等核心接口未鉴权 ⇒ **CRITICAL**
- 所有 `/api/v3/platform/*` 写接口未鉴权 ⇒ **CRITICAL**
- SQL / 命令 / NoSQL 注入 ⇒ **CRITICAL**
- 直接修改 `upstream/prometheus/` 且未生成 patch ⇒ **CRITICAL**
- URL 解析 / 反向代理未校验 scheme 与 host ⇒ **HIGH**（SSRF）
- 用户上传文件未校验类型/大小/路径 ⇒ **HIGH**
- 硬编码密钥、密码、token、数据库连接串 ⇒ **HIGH**
- patch 引入新的网络监听、文件写入或命令执行入口 ⇒ **HIGH**
- 安全控制点与场景业务意图明显不符 ⇒ **MEDIUM**

---

## 8. 统一输出模板

```markdown
## 审查结果：feat/module-XX

### 摘要
- 审查文件数：N（深读 M / 抽查 K）
- 总体结论：APPROVE / REQUEST_CHANGES（安全：PASS / FAIL）
- 最高严重级别：CRITICAL / HIGH / MEDIUM / LOW / NONE
- 执行度量：起止时间 / token 估算 / 重试次数

### CRITICAL
- [ ] 问题 1：文件 + 行号 + 问题描述 + 建议修复

### HIGH
- [ ] 问题 1：文件 + 行号 + 问题描述 + 建议修复

### MEDIUM
- [ ] 问题 1：文件 + 行号 + 问题描述 + 建议修复

### LOW
- [ ] 问题 1：文件 + 行号 + 问题描述 + 建议修复

### 遗留风险
- （如无则写“无”）
```

- 问题必须可定位、可修复；禁止只写“建议优化”。
- 审查文件数、深读数、抽查数必须真实；不得虚报。
- 执行度量用于后续审查成本优化，不参与质量评分。

---

## 9. 审查后交接与复审

- 审查完成后，将结构化报告返回 Orchestrator。
- **CRITICAL / HIGH**：打回原 Developer 或对应 specialist 修复；修复后必须重新执行相关验证。
- **MEDIUM / LOW**：记录为遗留风险，或让 Developer 快速修复。
- **无问题**：输出 APPROVE / PASS。

**修复后复审**：

- 复用同一 Reviewer 会话，注入 fix 摘要 + 变更 diff 片段，做**定向复审**。
- 只核对修复点与回归，不重开全新 Agent 全量重审。
- 复审通过即 APPROVE / PASS，不重复输出全量报告。
- 若修复引入新风险，按新问题重新分级。

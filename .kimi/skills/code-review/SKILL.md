---
name: code-review
description: "MetricCenter 代码审查规范：独立审查协议、结构化输入包、triage-then-deep、成本控制、统一输出模板、复审交接与 Go/前端专项检查"
---

# 代码审查规范

本 Skill 是所有 Reviewer（golang / frontend / security）的共用审查方法论。安全专项检查另见 `security-review`；Go 编码基线见 `golang-coding-style`；前端规范见 `web-development`；API 契约见 `api-standard`。

---

## 1. 审查角色与独立性

- **只读**：禁止 Write / Shell；只能读取文件、搜索代码、分析问题。Reviewer 不修改被审查代码。
- **独立上下文**：Reviewer 不得与实现 Agent 共享会话；Orchestrator 必须启动独立 sub-agent，并提供完整审查输入包。
- **不操作分支**：Reviewer 不执行 checkout / merge / commit，不需要读取 `cncf-git-workflow`。
- **只审指定范围**：不顺手审查 `docs/`、`upstream/` 或另一端的代码；跨端共享类型例外，但只核对契约字段。
- **结论必须可执行**：每个问题给出文件、行号、严重级别、修复建议；禁止只给“建议优化”而无定位。

---

## 2. 结构化审查输入包

Orchestrator 必须提供以下内容；Reviewer 不自行漫游全仓库。

### 2.1 基础输入

- 当前分支：`feat/module-XX`
- 轨道标记：Track A / Track B / Track B+
- PRD 路径与**相关章节**（禁止要求 Reviewer 全文读取）
- L3 micro-task 序列：`docs/05-execution-records/module-XX/task-sequence.yaml`
- 原型路径：`docs/prototypes/module-XX/`（Track A 优先；缺失不阻断）
- 前端原型映射表：`docs/05-execution-records/module-XX/frontend-prototype-map.md`（Track A 前端任务必读）
- 契约快照：`docs/05-execution-records/module-XX/api-contract-snapshot.md`
- 相关标准：`01_Code_Isolation_Standard.md`、`03_API_Standard.md`、`04_Testing_Standard.md`；前端追加 `02_Frontend_Standard.md`

### 2.2 变更范围（禁止一次性注入大 diff）

- 变更文件清单（paths）+ 每文件 1–3 行变更摘要（功能 / 契约面 / 安全控制点）
- **审查预检结果**（机械检查产出，Reviewer 直接采信命中清单）：
  - 目录隔离检查（`git diff --name-only develop...feat/module-XX` 对照白名单）
  - 契约字段 / 枚举 / 路由前缀 grep 比对契约快照
  - URL scheme / host 校验（SSRF）
  - 安全预检：密钥 / token / 密码扫描、危险函数 / 注入模式、文件上传校验
- **高风险预标注**：Orchestrator 认为需重点核查的文件 / 区域
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
| PRD（Track A / B） | **停止**并报告 Orchestrator；PRD 是契约 / 安全控制点来源 |
| PRD（`mode: incremental`） | 不阻断；任务卡为首要输入，已提交 PRD 仍为约束，按 §3.1 增量审查执行 |
| 契约快照 | 不阻断；回退 PRD 第 5/6 章 + `03_API_Standard.md`，在「遗留风险」标注 |
| L3 task-sequence | 不阻断；以 PRD + 变更范围为准，在「遗留风险」标注 |
| 原型 | 不阻断；以 PRD + 变更范围为准（Track A 需在遗留风险标注） |
| 前端原型映射表 | Track A 前端任务视为输入不完整；报告 Orchestrator，不自行猜列 / 导航 |

---

## 3. 审查范围

| Reviewer | 审查范围 | 禁止深审 |
|----------|----------|----------|
| golang-reviewer | `platform/` Go 代码、`patches/prometheus/`、测试代码 | `ui-custom/web/`（共享类型除外）、`docs/`、`upstream/` |
| frontend-reviewer | `ui-custom/web/`、测试代码 | `platform/`（共享类型除外）、`docs/`、`upstream/` |
| security-reviewer | `platform/`、`ui-custom/web/`、`deploy/`（如存在）、`patches/prometheus/` | `docs/`、`upstream/` |

目录隔离问题由 diff / 预检结果判定；发现越界修改直接按严重级别记录，不展开审查越界文件内容。

### 3.1 增量/修复阶段审查（`mode: incremental`）

任务卡标记 `mode: incremental`（PRD 滞后回填、原型可选）时，审查基线降级为：

1. **验收标准**：实现是否满足任务卡中的问题描述 + 验收标准（用户体验验收前置）。
2. **回归风险**：是否破坏现有已实现功能（现有测试 + 服务启动验证）。
3. **契约快照同步**：跨端契约变更是否同步更新了 `api-contract-snapshot.md`；纯单端变更无需。
4. **PRD 约束**：是否违反已提交 PRD 的既有约定；冲突必须标记，不得默许。
5. **安全与性能**：仅查明显问题（注入、越权、敏感信息、goroutine 泄漏等），不做全量安全深读。

**免检项**：原型符合度、`frontend-prototype-map.md`、S/A/B 差异核对、PRD 修订表、UI 文案与 PRD 字段表逐字对照。

技术债修复（commit 带 `debt:` 标记）：只验证「不影响现有已实现功能」（测试 + 服务启动通过即放行），不按新功能的完整清单审查。

---

## 4. 审查维度

### 4.1 通用维度

| 维度 | 检查项 |
|------|--------|
| L3 边界一致性 | 是否符合当前 micro-task 范围；是否做超范围功能 |
| 契约一致性 | 字段名 / 枚举 / 嵌套结构 / 错误码是否与 `api-contract-snapshot.md` 一致；缺失时回退 PRD 第 5/6 章 + API 标准 |
| 代码规范 | 命名、注释、错误处理、函数 / 文件长度、分层 |
| 测试覆盖 | 是否包含必要测试；抽查 2–3 个代表性测试验证有效性，不逐文件全读 |
| 安全 | 注入、敏感信息、越权、SSRF、上传、配置下发 |
| 性能 | 明显 N+1、无界循环、重复渲染、goroutine 泄漏 |
| 目录隔离 | 是否误改 `docs/`、`upstream/`、对端目录 |

### 4.2 Go 后端专项

- [ ] 是否直接修改 `upstream/` 源码
- [ ] 业务代码是否在 `platform/` 下
- [ ] patch 是否有文件 + README 说明
- [ ] 错误是否正确包装（`%w`），是否吞错
- [ ] 是否有 goroutine 泄漏 / 数据竞争；并发代码是否提供 `-race` 结果
- [ ] R1：新增 handler 是否直接依赖 `*gorm.DB`
- [ ] R2：schema 变更是否有 `platform/db/migrations/` 版本化 migration
- [ ] R3：是否新增 `GetResourceField` / `LegacyFieldMap` 调用
- [ ] R4：新增模块是否直接改 `main.go` 路由注册 / `AutoMigrate` 列表
- [ ] API 路由 / 响应信封 / 字段命名是否与 API 标准一致
- [ ] URL 解析 / 反向代理是否校验 scheme 与 host（SSRF）
- [ ] 公共函数是否有测试；测试是否真正调用被测行为
- [ ] Prometheus SDK 使用、扩展点优先级、性能
- [ ] 包注释、函数 < 50 行、文件 < 800 行

### 4.3 前端专项

- [ ] **Track A 原型符合度**：导航模型、列 / 区块完整性、UI 展示名、用户文案、交互组件、冲突留痕（详见 `web-development` §7）
- [ ] **Track B/B+**：验收清单覆盖度、AntD 标准模式符合性
- [ ] 契约一致性：前端类型 / 字段名（snake_case）/ 枚举值 / 响应结构是否与快照一致；是否反向读取 `platform/models/*.go`
- [ ] 组件是否职责单一；关键 props / API 响应是否有类型
- [ ] API 调用是否统一走 `src/api/client.ts`
- [ ] 是否处理 loading / error / empty / 权限不足状态
- [ ] 是否复用 `src/components/` 共享组件；长文本 / 表格横向滚动是否按标准
- [ ] Form 抽屉 / 弹窗是否设置 `forceRender`，是否有“关闭 → 打开”回显测试
- [ ] 测试是否按范围执行；antd 测试是否使用 `src/test/antdTestUtils.tsx`
- [ ] XSS / CSRF / 敏感信息 / URL 校验
- [ ] 可访问性（表单 label、按钮语义）与明显性能问题

---

## 5. 审查顺序：triage-then-deep

1. **核对预检结果**：采信机械检查产出，对命中项逐一确认；未命中项不再全文扫描。
2. **核对已验证清单（信任边界）**：抽查 1–2 处；发现不符则标 HIGH、清单失效、转全量重验。
3. **高风险区深读**：只对「高风险预标注 + 预检命中 + 契约存疑」区域完整深读。
4. **契约快照核对**：路由 / 字段 / 枚举 / 错误码逐项对照；缺失回退 PRD + API 标准。
5. **测试抽查**：按 Developer 测试清单抽查 2–3 个代表。
6. **L 级问题直接记录**：不进入深查，写入 LOW / 遗留风险。

---

## 6. 成本控制

- 预期深读文件数 ≦ **高风险预标注数 + 预检命中数 + 2**；security-reviewer 因覆盖前后端，基数 +3。
- 单文件优先只读变更行 ±50 行；必须读全文时，在报告摘要说明原因。
- 预计明显超预算时，先在摘要说明「超预算原因」再继续。
- 这是**软预算**：质量优先，超预算不处罚，但必须留痕。
- 禁止为了省成本跳过鉴权 / 越权 / 业务逻辑安全深读。

---

## 7. 严重级别

| 级别 | 判定标准 | 处理 |
|------|----------|------|
| **CRITICAL** | 数据丢失 / 安全漏洞 / 直接改 `upstream/` 未生成 patch / 核心写接口未鉴权 / 配置下发未鉴权 / 注入风险 | 必须修复，阻断合并 |
| **HIGH** | 契约不一致 / 公共函数无测试 / SSRF / goroutine 泄漏 / 关键类型缺失 / API 路径错误 / 原型映射未留痕偏离 / 信任边界失效 | 必须修复，阻断合并 |
| **MEDIUM** | 过度工程化 / 测试未真正调用被测行为 / 明显性能问题 / 命名与结构问题 / 可访问性缺陷 | 可记录遗留风险或快速修复 |
| **LOW** | 风格、注释、轻微可读性问题 | 记录即可，不阻断 |

- 总体结论：`APPROVE` / `REQUEST_CHANGES`；安全审查使用 `PASS` / `FAIL`。
- 存在任一 CRITICAL / HIGH ⇒ 不得 APPROVE / PASS。

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

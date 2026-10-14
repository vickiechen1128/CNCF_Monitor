# M07 前端 cluster 按类必填分化 + zone_env 残留清理

- 角色：frontend-developer
- 分支：`feat/module-08-alert-dispatch`
- 依据：`docs/05-execution-records/module-07/cluster-zone-env-and-platform-text-alignment.md` §1.5（前端遗留修复）与 §2.5（前端残留清单）；裁定原文见 `design-decisions.md` 决策 F
- 后端前置：commit `a260a39`（cluster 必填口径注释、废弃 `zone_env` 列、平台文案分化）
- 范围：仅 `ui-custom/web/`；未触碰 `platform/`、`upstream/`、PRD 与原型

---

## 1. 任务 A：cluster 必填性 —— 前端补上按类分化的 required 规则

### 1.1 裁定依据（三方同口径，前端此前唯独漏了 cluster）

| 来源 | 结论 |
| --- | --- |
| `design-decisions.md` 决策 F | 「`app_name` / `cluster` 对 **host、generic_target 放开为可空**（SNMP 交换机等设备无应用归属，强制必填会逼填假数据污染标签）；application / database / middleware 保持必填。空值不注入标签（与 5.15 规则 4 对齐）」 |
| PRD `Module_07_Monitoring_Object_Management.md` L372 | 「cluster 必填规则同 app_code（host / generic_target 可空，空值不注入标签）」 |
| 后端 `platform/config/resource/validate.go` L398-L464 | `validateDatabase` / `validateMiddleware` / `validateApplication` 三处 `cluster 必填`（`a260a39` 已补决策 F 注释） |

结论：**cluster 必填规则完全同 `app_code`**，`a260a39` 的后端行为是 PRD 落地结果而非遗漏，本轮不改后端口径。

### 1.2 原缺陷

`ResourceFormDrawer.tsx` 中 `app_code` 早已做过同口径的按类分化（`appCodeRequired`，L361-L363 + L594/L596），唯独 `cluster` 的 `Form.Item` 五类都没有 `rules`，且 placeholder 五类统一写死「集群名（可选）」——**必填的三类在表单侧看不出任何必填标记**，用户提交空值会被前端放行、再撞后端 400，属于静默失败。

### 1.3 最终形态

| 资源类型 | cluster 前端 rules | placeholder |
| --- | --- | --- |
| application | `[{ required: true, message: '请填写集群' }]` | `请填写集群` |
| database | 同上 | `请填写集群` |
| middleware | 同上 | `请填写集群` |
| host | 不挂 rules（可空） | `集群名（可选）` |
| generic_target | 不挂 rules（可空） | `集群名（可选）` |

实现取 `const clusterRequired = appCodeRequired`，与 `app_code` 判定**恒等**，确保后续任一侧改动不会出现两套口径漂移；placeholder 与 rules 同步分化（必填类标「可选」会与 rules 自相矛盾）。

`buildCreateInput` / `buildUpdateInput` 的 `cluster: values.cluster ? String(values.cluster) : undefined` 与 `recordToFormValues` 的 `cluster: record.cluster` **未改**；`ResourceDetailDrawer.tsx` 的 `record.cluster || '-'` 按要求**未改**。

### 1.4 测试

新增 7 条用例（`ResourceFormDrawer.test.tsx`，53 tests）：

- 三条必填类拦截：`application` / `database` / `middleware` 集群留空 → 断言 `.ant-form-item-explain-error` 出现「请填写集群」且 `createMock` 未被调用。为保证失败原因唯一，各用例的助手函数把**除 cluster 外的全部必填项填齐**（新增 `fillSharedRequiredFields` + 4 个 `...ExceptCluster` 助手）。
- 两条可空类护栏：`host` / `generic_target` 其余必填项填齐后留空 cluster 仍能提交，且 `payload.cluster` 为 `undefined`（防误加 required）。
- 一条正向护栏：`middleware` 填写 cluster 后校验通过且 payload 携带 `cluster: 'bj-01'`。
- 一条 placeholder 分化断言：host 为「集群名（可选）」、database 为「请填写集群」。

**因行为变更而补录 cluster 的既有用例（5 条，断言原始意图全部保留，仅在填写步骤补一行并注明「原特征」）**：`中间件端口越界时钳制到边界而非报错`、`中间件提交时携带端口值`、`submits application with endpoint + port and omits empty health_check_url`、`{T01-P5} database 登记填采集端口 9100`、`{T01-P5} middleware 登记填采集端口 9100`。补录原因是这 5 条只覆盖 app_code 与差异化字段，从前不填 cluster 也能提交成功，属行为变更导致的前置条件变化，**不是**为了让断言变绿而改断言。

> 实现注意：`fillMiddlewareRequiredFields()` 被多条既有用例复用，若新的 `...ExceptCluster` 助手复用它会连带填入 cluster，故后者独立展开填写步骤。

---

## 2. 任务 B：清理 `zone_env` 残留

后端已在 `a260a39` 落地：`TemplateColumns[host]` 14→13 列移除该列、`excel.go` 的 `removedTemplateColumns` 按列名剔除（存量 Excel 仍可导入）、`import.go` 不再写 `Host.ZoneEnv`。前端 4 处残留处理如下。

| 位置 | 处理 |
| --- | --- |
| `src/types/resource.ts` L60 | **删除** `zone_env: 'INT' \| 'GOV'` |
| `TemplateDownloadModal.tsx` `FILLING_TIPS.host` | 删除 host 第 4 条（整句移除，host 由 4 条变 3 条，语句通顺无残句） |
| `TemplateDownloadModal.tsx` 组件注释 | 改为说明「主机历史『可用区』列已废弃并从模板移除，故不再作任何介绍」；刻意不在注释里保留 `zone_env` 字面串，避免与清理护栏/后续 grep 混淆 |
| `TemplateDownloadModal.test.tsx` | 删除失效断言，改为断言 host 提示的实际内容；新增五类逐一校验的清理护栏 |

### 2.1 `types/resource.ts` 能否安全删除的核查

删前用 Grep 全量扫描 `ui-custom/web/src/`：改动前共 5 处命中 —— 类型声明 1 处（无任何 `record.zone_env` / `.zone_env` 读取点）、`TemplateDownloadModal` 2 处（文案 + 注释）、其测试 2 处。**无任何消费点**，故安全删除；删除后 `npx tsc --noEmit` 通过（exit 0）。

后端 `platform/models/host.go` L30 仍序列化 `json:"zone_env"`，但前端不读该字段，多返回/少声明都不影响编译与运行。

### 2.2 测试

- 改写 F-22 断言：删除「可用区 / zone_env」相关断言，改为断言 host 其余内容 `可留空：主机别名（hostname，与主机名二选一填一个即可）、所属集群（cluster）、负责人（owner）`。
- 新增护栏 `不再出现已废弃的 zone_env / 可用区字样（F-22 清理护栏，五类逐一校验）`：五类各渲染一次 Modal，断言 `document.body.textContent` 既不含 `zone_env` 也不含 `可用区`。
  - 实现注意：antd Modal 渲染在 `document.body` 的 portal 中，取 `view.container.textContent` 取不到内容，必须取 body。
- 未触碰「网域」相关说明与「分区权威值是所属网域」的表述（仅 host 的 `zone_env` 一句被删）。

---

## 3. 破坏验证（改坏 → 确认护栏变红 → 恢复）

| 编号 | 注入的破坏 | 结果 |
| --- | --- | --- |
| A-1 | `const clusterRequired = false && appCodeRequired`（五类全可选） | `Tests 10 failed \| 43 passed (53)`。失败含 3 条「cluster 必填报错」用例、`决策 F：middleware 填写集群后校验通过且 payload 携带 cluster`、placeholder 分化用例，以及 5 条补录 cluster 的既有用例；典型报错 `Unable to find an element with the text: 请填写集群, which matches selector '.ant-form-item-explain-error'` 与 `Unable to find an element with the placeholder text of: 请填写集群` |
| A-2 | `const clusterRequired = true`（五类全必填） | `Tests 15 failed \| 38 passed (53)`。host / generic_target 的全部提交用例与两条「可空类不得被误加 required」护栏转红 |
| B | 把 `zone_env` 那句加回 `FILLING_TIPS.host` | `Tests 1 failed \| 10 passed (11)`，失败为清理护栏用例，输出 `expected '下载模板 - 主机…' not to match /zone_env/` |

三次破坏均已恢复，恢复后重跑全绿。

---

## 4. 验证命令真实输出

```
$ npx tsc --noEmit
TSC_EXIT=0

$ npx vitest run src/pages/resources
 Test Files  12 passed (12)
      Tests  256 passed (256)
   Duration  103.38s (transform 605ms, setup 591ms, collect 16.32s, tests 134.88s, environment 5.81s, prepare 509ms)

$ npx eslint src/pages/resources
ESLINT_EXIT=0

$ make repo-map          # 在项目根目录执行
>>> Go already installed: <repo>/.tools/go/bin/go
go version go1.26.1 darwin/arm64
>>> Generating repo map
repo-map: docs/04-source-architecture/repo-map.md（Go 文件 400，TS/TSX 文件 174）
```

`ResourceFormDrawer.test.tsx` 单文件 53 tests（原 46 + 新增 7），`TemplateDownloadModal.test.tsx` 11 tests（原 10 + 新增 1），resources 目录合计 236 → 256。

`repo-map.md` 本次变化的符号条目全部来自 `a260a39` 已提交的后端代码（`TestExcelLegacyTemplateWithZoneEnvStillImports` 等）与其他会话的 `platform/` WIP，**前端本轮无导出符号增减**（`clusterRequired` 是组件内局部变量、`zone_env` 是 interface 成员，均不进符号地图），故该文件未纳入本轮提交。

未跑全量 `pnpm test`（约 17 分钟，会被 SIGKILL），符合本轮约束。

---

## 5. 变更范围

| 文件 | 变更 |
| --- | --- |
| `ui-custom/web/src/pages/resources/ResourceFormDrawer.tsx` | 新增 `clusterRequired` 判定 + cluster `Form.Item` 按类挂 rules + placeholder 按类分化 |
| `ui-custom/web/src/pages/resources/ResourceFormDrawer.test.tsx` | 新增 7 条 cluster 用例与 5 个助手函数；5 条既有用例补录 cluster 填写行（注明原特征） |
| `ui-custom/web/src/pages/resources/TemplateDownloadModal.tsx` | 移除 host 提示中的 `zone_env` 一句；清理组件注释 |
| `ui-custom/web/src/pages/resources/TemplateDownloadModal.test.tsx` | 改写 F-22 失效断言；新增五类清理护栏用例 |
| `ui-custom/web/src/types/resource.ts` | 删除 `Host.zone_env` 类型声明 |

未改动：`ResourceDetailDrawer.tsx`、任何 `platform/` 文件、PRD 与原型、工作区其他会话的未提交 WIP。

---

## 6. 未做项及原因

| 项 | 原因 |
| --- | --- |
| 后端 cluster 必填口径调整 | `a260a39` 已落地且与 PRD 一致，前端只做对齐，不动后端。 |
| `Host.zone_env` 数据库列清理 | 后端已明确「不写迁移脚本、不删列」，存量值保留，属独立数据治理决策。 |
| `ResourceDetailDrawer` 的 `record.cluster \|\| '-'` | 按任务约束保留现状（详情侧空值展示统一走 `'-'`，不因类别分化）。 |
| 全量 `pnpm test` | 本轮约束禁止（全量约 17 分钟，会被 SIGKILL exit 137）。 |
| 工作区其他会话 WIP | `git status` 显示 `platform/`、`Makefile`、多个模块执行记录、前端其他页面均有非本轮改动，一律未回退、未覆盖、未纳入提交。 |

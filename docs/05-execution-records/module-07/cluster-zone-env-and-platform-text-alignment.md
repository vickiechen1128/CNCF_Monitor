# M07 cluster 必填性裁定 · zone_env 废弃 · 平台文案对齐（2026-10-13）

> 触发：chenrt 拍板三项 —— ① 分析 cluster 在不同资源类型的必要性后决定必填性；② `zone_env` 废弃；③ 平台文案同步更新。
> 前置登记：[dev-feedback.md](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/docs/05-execution-records/module-07/dev-feedback.md) F-22-③（cluster 前后端必填性矛盾）、F-22-④（`zone_env` 幽灵列）均在本轮收割。

## 0. 分组说明

本轮三个主题虽在同一 commit 批次落地，但**评审关注点互不相同**：① 是契约口径收敛、② 是导入兼容改造、③ 是提示文案一致性。故合并成一份记录但**分三节独立成文**，便于按主题检索。

---

## 1. cluster 必填性裁定（决策 F，行为零改动）

### 1.1 裁定结论

**保持按类分化必填，规则同 `app_code`**：

| 资源类型 | cluster | 依据 |
| --- | --- | --- |
| host | 可空 | 设备类无集群归属 |
| database | **必填** | 决策 F |
| middleware | **必填** | 决策 F |
| application | **必填** | 决策 F |
| generic_target | 可空 | 设备类无集群归属 |

### 1.2 裁定依据：PRD 已有明文决策，后端并非遗漏

`design-decisions.md` 决策 F 原文：

> `app_name` / `cluster` 对 **host、generic_target 放开为可空**（SNMP 交换机等设备无应用归属，**强制必填会逼填假数据污染标签**）；application / database / middleware 保持必填。空值**不注入标签**（与 5.15 规则 4「`biz` 空值语义」对齐）。

PRD `Module_07` L372 亦明确：「cluster 必填规则同 app_code（host / generic_target 可空，空值不注入标签）」。

**结论**：后端 `validateDatabase` / `validateMiddleware` / `validateApplication` 三处 `cluster 必填` 校验是 PRD 落地结果，**不是遗漏或历史不一致**，本轮不改行为。

### 1.3 技术链路验证：cluster 留空安全无副作用

| 检查项 | 结论 | 证据 |
| --- | --- | --- |
| scrape job 分组键 | 不含 cluster（按 `JobName` 归组） | `generator/render.go` L115-L131 |
| 资源判重键 | 五类 DedupKey 均不含 cluster | `resource/validate.go` L565-L587 |
| `relabel_configs` | **零注入**（仅 blackbox 的 3 条固定规则） | `generator/render.go` L209-L238 |
| `external_labels` | 不含 cluster（仅 network_domain / zone_type / replica） | `generator/generator.go` L98-L109 |
| system 层标签 | 不含 cluster（仅 resource_id / network_domain / cloud / zone） | `generator/targets.go` L311-L332 |
| 空值表现 | **标签不存在**（`v == ""` 跳过写 key），不写空串、不回落 default | `generator/labels.go` L50-L53；`config/label/generator.go` L61-L65 |
| 按 cluster 聚合的看板 / PromQL | **全仓零命中**（`by (cluster` 类模式跨仓无匹配；`platform/dashboard/` 生产代码零命中） | — |

每个资源实例生成**独立 TargetGroup**（`targets.go` L264-L333 逐 `resource_id` append），故同 `app_code` 下 cluster 不同或为空的两台机器既不合并也不撞标签。

**唯一影响**：cluster 留空时该 target 不带 `cluster` 标签，按集群分组查询时该批序列缺此维度；因当前无任何 cluster 维度消费方，**无可观测副作用**。

### 1.4 本轮改动（仅注释与契约口径，行为零改动）

1. `resource/validate.go` L408 / L425 / L462 三处 `cluster 必填` 校验点补决策号注释（照抄同文件「决策 93 / 决策 95」的既有注释风格）：
   > 决策 F（§5.2）：cluster 必填规则同 app_code —— host / generic_target 可空（设备类无集群归属，强制必填会逼填假数据污染 cluster 标签）；application / database / middleware 必填。空值不注入标签（5.15 规则 4）
2. `resource/template.go` L314 `templateColumnRequiredLabel` 注释更新：原文「前端 cluster 选填与后端判必填的矛盾属设计侧待裁定项」，现改为**已裁定**（chenrt 本轮拍板），并注明前端已同步补上按类分化的 required 规则。
3. `api-contract-snapshot.md` L269 附近：cluster 从「可选」列表移出，§10A 必填分化表补 cluster 列，**按 PRD 口径标注为「host / generic_target 可空（空值不注入标签）」**而非笼统的「可选」。

### 1.5 遗留（前端本轮同步修复）

`ui-custom/web/src/pages/resources/ResourceFormDrawer.tsx` L603 `cluster` 五类均无 required 规则，与后端冲突（提交空值必撞后端 400）。前端已对 `app_code` 做过同口径分化（L361-L363 / L589），唯独 `cluster` 漏了。前端修复见另一条前端执行记录。

---

## 2. `zone_env` 废弃

### 2.1 废弃理由

`zone_env` 为历史 CMDB 遗留的「区域-环境」列，与网域 `zone_type` **重复建模同一概念**：

- 决策 101 已定「网络分区唯一权威归网域」：`Host.zone_env` 降级为兼容导入列，不进标签、不作分区权威；同一网域内主机的分区必然等于该网域 `zone_type`，故该字段属**冗余**。
- 实际已无用：不在任何标签映射中、UI 页面不展示、平台功能不读取。
- 保留它只会**诱导用户填假值**（用户看到模板有这列却不知其不生效）。

chenrt 裁定：**废弃**。

### 2.2 工程判断：移除输出 + 兼容忽略读取

**不能直接删列**：`validateHeader` 是严格逐列比对（仅末列 `scrape_port` 允许整体缺省），直接删除会让所有**已下载的存量模板**在导入时撞「固定列模板，不支持动态列」报错，属破坏性回归。故采用「移除输出 + 兼容忽略」。

### 2.3 实现

1. **模板输出移除**：`template.go` 的 `TemplateColumns[host]` 删 `zone_env`（14 列 → 13 列）；`templateColumnDocs` 删该条目；sheet2 取值说明不再出现该列。
2. **兼容机制**：`excel.go` L105-L111 新增 `removedTemplateColumns` map（当前含 `zone_env`），`validateHeader`（L116-L126）在逐列严格比对**之前**按**列名**剔除已废弃列。
   - 按列名而非列数剔除 ⇒ 存量模板（14 列）与新模板（13 列）**均被接受**，且列序差异不会被误判为「列头超出模板」；
   - 真正未定义的动态列仍照常报「超出模板」，防御未被削弱。
3. **值不落库**：`import.go` L184 起导入不再写 `Host.ZoneEnv` 物理列；`excel.go` L216 的 `case "zone_env"` 分支置空处理。
4. **数据层不动**：**不写迁移脚本、不删数据库列**，存量非空值保留在 `Host.zoneEnv` 中，只断掉输入输出通路。若将来要清理，属独立的数据治理决策。

### 2.4 测试

- `excel_test.go` L760-L804：存量模板（14 列，含已填 `zone_env=GOV`）导入成功、该值被忽略不落库、且 `zone_env` 之后的 `owner` 列**不错位**（核心回归护栏）。
- `import_test.go` L280-L304：带 `zone_env` 的存量文件导入成功，`h.ZoneEnv` 保持空。
- `template_test.go` L225-L228：sheet2 取值说明不含 `zone_env`。
- `template_test.go` L112-L113：host 模板不再输出该列（保留原特征说明：原 14 列含 `zone_env`，位于 `cluster` 与 `owner` 之间）。
- `excel_test.go` L817-L826：其余四类模板不含该列的回归断言。

### 2.5 前端残留（只读检查，交由前端任务处理）

| 文件 | 行 | 内容 |
| --- | --- | --- |
| `ui-custom/web/src/types/resource.ts` | 60 | `zone_env: 'INT' \| 'GOV'` 类型声明 |
| `ui-custom/web/src/pages/resources/TemplateDownloadModal.tsx` | 36 | host 填写提示「主机模板里的『可用区』列（zone_env）仅为兼容旧模板保留……」 |
| `ui-custom/web/src/pages/resources/TemplateDownloadModal.tsx` | 108 | 组件注释 |
| `ui-custom/web/src/pages/resources/TemplateDownloadModal.test.tsx` | 87 / 92 | 对应断言 |

**列已废弃后，该提示属于「介绍一个已不存在的列」，会误导用户**，前端须移除。

---

## 3. 平台文案同步（`app_platform_rel.go`）

### 3.1 改动

`app_platform_rel.go` L198-L219 `validateAppPlatformRefs` 原文案「平台 %s 未登记或已停用，请到『平台字典』登记或启用后重试」与 `validatePlatformCode` 新口径不同构，改为按 `Lookup` 区分两种状态：

| 状态 | 新文案 |
| --- | --- |
| 应用未登记 | 应用 %s 未登记，请到『应用字典』登记后重试 |
| 应用已停用 | 应用 %s 已停用，请到『应用字典』启用后重试 |
| 平台未登记 | 平台 %s 未登记，请在『平台管理』页登记后重试 |
| 平台已停用 | 平台 %s 已停用，请在『平台管理』页启用后重试 |

同时统一「平台字典」→「**平台管理**」页，与 `validatePlatformCode` 及前端 UI 导航一致。

### 3.2 为什么「已停用」文案必须不含「未登记」字样

前端 `isPendingRegistrationError` 以「reason 含『未登记』且不含『已停用』」判定待登记高亮。「已停用」引导的是去管理页**启用**而非登记；若沿用合并文案「未登记或已停用」，会同时含两个关键词而被前端判为**非待登记**，登记指引丢失。

### 3.3 为什么此处**不提**「平台声明」sheet（与导入路径的差异）

已查清调用路径：`validateAppPlatformRefs` 是 `POST /api/v2/platform/app-platform-rel` 的**独立写入入口**，**不在** `import.go` 的声明 sheet 事务通道内，**无法**通过声明 sheet 补齐字典值。

故本入口只做「未登记 / 已停用」区分，**不提声明 sheet**——提了就是欺骗用户。`validatePlatformCode` 之所以提，是因为它确实在导入事务内、该通道真实可用（`excel_declare.go` 的 `platformDeclareSheet` + `applyDeclaredDicts` 与资源同事务落库）。

### 3.4 测试

`app_platform_rel_test.go` L80 起改写断言（保留「原特征：断言合并文案『未登记或已停用』」说明），新增「已停用」文案**不含**「未登记」的回归护栏。

---

## 4. 全仓扫描：其他「未登记或已停用」合并文案

按要求扫描全 `platform/`，发现以下**同族文案**仍在，**本轮未改**（不在 chenrt 本次指令范围内，且属不同入口）：

| 位置 | 文案 | 所属入口 |
| --- | --- | --- |
| `resource/validate.go` L316 | 业务 %s 未登记或已停用，请联系平台管理员在业务分组字典配置（`business_domains.yaml`）… | 导入侧 biz_code 校验（读文件字典） |
| `resource/validate.go` L333 | 应用 %s 未登记或已停用，请在『应用字典』中登记或启用后重试 | — |
| `resource/validate.go` L359 | 服务 %s 未登记或已停用，请在『服务字典』中登记或启用后重试 | — |
| `resource/application_dict.go` L179 | 平台 %s 未登记或已停用，请在『平台字典』中登记或启用后重试 | 应用字典侧平台校验 |
| `resource/service.go` L199 / L208 | 应用 / 业务 %s 未登记或已停用，请到『应用字典』/『业务字典』登记或启用后重试 | 服务创建入口 |
| `admin/networkdomain/create.go` L73 | 云 %s 未登记或已停用，请联系平台管理员在云字典中启用后重试 | M06 网域侧 |

**是否统一**：建议后续单独立项。理由有二 —— ① 这些入口大多读文件字典（`business_domains.yaml` / `cloud_dict.yaml`）而非 DB store，`Lookup` 区分法不一定通用；② 「已停用」对文件字典是否有意义需逐个确认。**不建议**在本轮顺手改，避免无依据的口径变更扩散。

---

## 5. 验证结果

```
export PATH="$(pwd)/.tools/go/bin:/usr/bin:/bin:/usr/local/bin:/usr/sbin:/sbin:$PATH"
go build ./platform/...            → exit 0
go vet ./platform/config/resource/...  → exit 0
go test -count=1 ./platform/config/resource/...
  → ok  github.com/metriccenter/metriccenter/platform/config/resource  1.818s
make repo-map                        → OK: repo-map 与当前业务代码一致
```

## 6. 变更范围

| 文件 | 变更 |
| --- | --- |
| `platform/config/resource/validate.go` | 3 处 cluster 必填校验点补决策 F 注释 |
| `platform/config/resource/template.go` | 移除 `zone_env`（列清单 + `templateColumnDocs` + sheet2）；更新必填标注注释 |
| `platform/config/resource/excel.go` | 新增 `removedTemplateColumns` 与 `validateHeader` 按列名剔除 |
| `platform/config/resource/import.go` | 不再写 `Host.ZoneEnv` |
| `platform/config/resource/app_platform_rel.go` | 平台/应用文案按未登记、已停用分化 |
| `platform/config/resource/{template,excel,import,app_platform_rel}_test.go` | 存量模板兼容回归 + 文案分化断言 |
| `docs/05-execution-records/module-07/api-contract-snapshot.md` | cluster 口径入 §10A；`zone_env` 废弃与存量兼容口径 |
| `ui-custom/web/src/...`（另一任务） | 前端 cluster 必填分化 + 移除 `zone_env` 残留提示 |

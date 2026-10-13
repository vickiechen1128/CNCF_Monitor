# M07 模板下载弹窗「填写说明」与后端必填口径对齐（前端）

- 角色：frontend-developer
- 分支：`feat/module-08-alert-dispatch`
- 依据：`docs/05-execution-records/module-07/dev-feedback.md` §16 **F-22**（本轮唯一权威依据）
- 范围：仅 `ui-custom/web/`；未触碰 `platform/`、`upstream/`、PRD 与原型

---

## 1. 问题根因

| 编号 | 现象 | 根因 |
| --- | --- | --- |
| 问题 1 | `FILLING_TIPS` 类型是 `Record<ResourceCategory, string[]>`，看起来按类分化，实际五类第二项填的是同一句「所属业务（必填）、所属应用（可选）」 | 资源模型升级为四层模型后端按 category 分化必填，前端文案未同步；该句对 host/database/middleware/application/generic_target 中的 4 类均失准 |
| 问题 2 | 「网域可留空——留空时平台自动归属默认网域」把「留空」教成了无条件安全操作 | 导入侧网域留空确实自动填 `models.DefaultDomainID`（= `"default"`，`excel.go:251-253`），但紧接 `networkDomainExists` 校验（`excel.go:254-257`），未登记直接失败报「网域 default 未登记，请先到『系统设置 → 网域管理』登记后重新导入」；而表单侧网域是无条件必填（`ResourceFormDrawer.tsx:503` + `validate.go:186`），两条动线必填性相反 |
| 问题 3 | 「业务列必填，应用列按需填写」 | 该表述对 5 类中仅 `application` 成立，属泛化失准；且与下方字典空态提示（「也可在导入文件里附『业务声明』/『应用声明』表」）缺少衔接 |
| 问题 4 | 模板 sheet1 主机类含 `zone_env` 列，前端五类 Tab 与 `resourceColumnPrefs.ts` 均无该列 | 决策 101 把它降级为 host 兼容导入列（`template.go:34-62` 列定义、`template.go:144-146` 已写「不作分区权威」），前端未在文案层面说明 |

## 2. 后端必填口径核对（改写依据，逐条对源码核验）

| 类别 | 业务 biz | 应用 app | 平台 platform | 集群 cluster | 其他必填（源码） |
| --- | --- | --- | --- | --- | --- |
| host | 可空后补 | 可空 | 可空 | 无要求 | 主机名（`validate.go:367-369`）、IP（`:360-365`）、操作系统（`:373-375`）、环境（`:221-223`） |
| database | 可空后补 | **必填**（`validate.go:386-388`） | 可空 | **必填**（`:389-391`） | 数据库类型（`:383-385`）、IP+端口（`:413-424`） |
| middleware | 可空后补 | **必填**（`:402-404`） | 可空 | **必填**（`:405-407`） | 中间件类型（`:399-401`）、IP+端口 |
| application | **必填**（`:432-434`、`excel.go:272-274`） | **必填**（`:438-440`） | 可空 | **必填**（`:441-443`） | 服务名（`:435-437`）、采集地址主机（`:456-458`）、采集端口（`:459-461`）、环境 |
| generic_target | **与 app 二选一**（`:475-477`、`excel.go:275-278`） | 同左 | 可空 | 无要求 | 目标名称（`:478-480`）、IP（`:481-486`） |

补充核对结论（写入文案，避免二次失准）：

- **环境（env）在 `validateCommon` 是必填枚举**（`validate.go:221-223`，仅允许 dev/test/staging/prod），五类一致，原文案完全没提。
- **平台（platform_code）一律可空**，留空走所属应用主平台兜底（`validate.go:242-246`、`template.go:173-175`）。
- application 的 `health_check_url` 可选且语义是「业务健康检查地址」，**不是采集地址**（`validate.go:444-452`）；采集地址唯一来源是 `endpoint` + `port`。
- generic_target 的 `port` 可空（0 表示未设置，`validate.go:487-492`）。

## 3. 五类分化后文案对照

### 3.1 `FILLING_TIPS`（弹窗「这模板怎么填」区）

**host**
1. 必填：主机名（instance_name）、IP 地址（instance_ip，填 IPv4）、操作系统（os_type）
2. 可留空：所属业务（biz_code，导入后再补）、所属应用（app_code）、所属平台（platform_code，留空按所属应用的默认平台归属）
3. 可留空：主机别名（hostname，与主机名二选一填一个即可）、所属集群（cluster）、负责人（owner）
4. 主机模板里的「可用区」列（zone_env）仅为兼容旧模板保留，平台不按它分区，分区依据是所属网域

**database**
1. 必填：数据库类型（database_type）、IP 地址（instance_ip，填 IPv4）、端口（port）
2. 必填：所属应用（app_code）、所属集群（cluster）
3. 可留空：所属业务（biz_code，导入后再补）、所属平台（platform_code，留空按所属应用的默认平台归属）
4. 可留空：版本（version）、负责人（owner）

**middleware**
1. 必填：中间件类型（middleware_type）、IP 地址（instance_ip，填 IPv4）、端口（port）
2. 必填：所属应用（app_code）、所属集群（cluster）
3. 可留空：所属业务（biz_code，导入后再补）、所属平台（platform_code，留空按所属应用的默认平台归属）
4. 可留空：版本（version）、负责人（owner）

**application**
1. 必填：服务名（service_name）、采集地址主机（endpoint）、采集端口（port）
2. 必填：所属业务（biz_code）、所属应用（app_code）、所属集群（cluster）
3. 可留空：健康检查地址（health_check_url，业务健康检查用，不作采集地址）、协议（protocol）、所属平台（platform_code，留空按所属应用的默认平台归属）
4. 可留空：服务编码（service_code）、负责人（owner）

**generic_target**
1. 必填：目标名称（target_name）、IP 地址（instance_ip，可填 IPv4 或域名）
2. 必填二选一：所属业务（biz_code）与所属应用（app_code）两个里至少填一个，两个都留空会导入失败
3. 可留空：端口（port，留空表示用默认端口）、采集路径（metrics_path）、协议（scheme）、Exporter 类型（exporter_type）
4. 可留空：所属平台（platform_code）、所属集群（cluster）、负责人（owner）
5. 自定义标签（custom_labels）按需填写，格式为 key1=value1;key2=value2

写法约束落实：主体全为用户语言（「IP 地址」「操作系统」「所属集群」），英文码一律放括号作补充；必填项前置并显式带「必填」，选填项统一冠「可留空」；二选一写明「至少填一个」+ 失败后果。

### 3.2 网域提示（「这模板怎么填」区公共项，三件事齐全）

- 网域强烈建议填写：在页面上新增或编辑资源时网域是必填项；用本模板导入时留空会自动归入默认网域 default
- 默认网域 default 必须在「系统设置 → 网域管理」里已登记，否则导入会直接失败，请先到该页面确认后再导入
- 环境（env）必填，填 dev / test / staging / prod 之一；负责人与集群按下方说明填写
- 运行状态填中文：运行中 / 已停止 / 维护中（原契约文案，保持不变）

### 3.3 `DICT_SCOPE_HINTS`（「每列能填什么值」区，按类分化）

| 类别 | 文案要点 |
| --- | --- |
| host | 业务列和应用列都能留空，留空的资源导入后再补归属 |
| database | 应用列必填，业务列能留空（导入后再补归属） |
| middleware | 应用列必填，业务列能留空（导入后再补归属） |
| application | 业务列和应用列都必填 |
| generic_target | 业务列和应用列二选一，至少填一个 |

五类统一续接同一句：「填了的话只能填已启用的条目——下方是当前已启用的清单，清单里没有的可在导入文件里附「业务声明」表 /「应用声明」表一次声明。」该句与字典面板空态提示（`暂无已登记业务，请先到「业务管理」页登记；也可在导入文件里附「业务声明」表…`）衔接，不自相矛盾。

## 4. 改动文件清单

| 文件 | 改动 |
| --- | --- |
| `ui-custom/web/src/pages/resources/TemplateDownloadModal.tsx` | 重写 `FILLING_TIPS` 为五类分化文案（含 host 的 zone_env 兼容列说明）；新增 `DICT_SCOPE_HINTS` 按类分化业务/应用取值范围并替换原泛化说明；网域提示拆为「表单必填 / 导入留空归入 default / default 未登记则导入失败」三句并补环境必填项；更新组件与常量注释 |
| `ui-custom/web/src/pages/resources/TemplateDownloadModal.test.tsx` | 改写 1 处失效断言（`主机名 / IP 地址 / 操作系统`，原泛化特征已移除）并注明；新增 3 个用例：五类必填口径分化、业务/应用列范围分化、网域 default 未登记失败提示 |

未改动（按约束）：`ResourceFormDrawer.tsx`、任何 `platform/` 文件、模板下载接口调用方式（`resourceApi.template` 走 `rawRequest` 带 Bearer token，F-3 成果保持）。

## 5. 测试与验证真实输出摘要

```
$ npx vitest run src/pages/resources/TemplateDownloadModal.test.tsx
 ✓ src/pages/resources/TemplateDownloadModal.test.tsx (10 tests) 595ms
 Test Files  1 passed (1)
      Tests  10 passed (10)      # 原 7 个 + 新增 3 个

$ npx vitest run src/pages/resources
 Test Files  12 passed (12)
      Tests  236 passed (236)
   Duration  98.39s

$ npx tsc --noEmit
tsc exit=0

$ npx eslint src/pages/resources
eslint exit=0

$ make repo-map
>>> Go already installed: /Users/chenrt/.../.tools/go/bin/go
go version go1.26.1 darwin/arm64
>>> Generating repo map
repo-map: docs/04-source-architecture/repo-map.md（Go 文件 400，TS/TSX 文件 174）
make exit=0
```

`repo-map.md` 本次仅「生成时间 / commit」行变化（本轮未新增导出符号，符号内容不变；`scripts/check-repo-map.sh` 比较时忽略该行），故未纳入本轮提交。

## 6. 未做项及原因

| 项 | 原因 |
| --- | --- |
| **cluster 前后端必填性矛盾** | 表单侧 `ResourceFormDrawer.tsx:603` 选填、后端 `validate.go` 三类判必填，属设计侧待裁定的 PRD 契约问题（F-22 附带失准 3），本轮明确不改，保持现状。文案按后端（导入）真实口径写「必填：…所属集群（cluster）」，不触碰表单侧。 |
| **从模板移除 `zone_env` 列** | 设计侧待裁定项（F-22 附带失准 2）。本轮只在 host 文案中补「仅为兼容旧模板保留，平台不按它分区，分区依据是所属网域」，未删列、未改后端。 |
| **F-23 / F-24（后端侧）** | 归 backend-developer，本轮为前端任务，不触碰 `platform/`。 |
| **工作区其他会话未提交 WIP** | `git status` 显示 `platform/`、`Makefile`、多个模块执行记录等均有非本轮改动，本轮一律未回退、未覆盖，也未纳入提交（只 `git add` 本轮两个前端文件）。 |
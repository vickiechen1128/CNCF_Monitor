# Module 07 后端开发执行记录

## 任务：业务管理「业务分组字典」后端（决策 48）

- 分支：`feat/module-08-alert-dispatch`
- 关联决策：`docs/05-execution-records/module-07/design-decisions.md`（决策 48）
- 需求来源：`docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md` §3.1/§5.18/§6.1/§9/§11.2

### 本次改动

业务分组字典从「yaml 内存热加载 + 仅 GET 只读」升级为 **DB-backed 权威存储**，并开放登记/受限编辑写入口。

1. **模型**：新增 `models.BusinessDomain`（code/name/description/enabled，snake_case JSON，嵌入 BaseModel）+ `models.InfraBizCode="infra"` 常量；`db.AutoMigrate` 注册。**注意**：`enabled` 字段不带 `gorm:"default:true"`——因为 GORM 对带 `default` 标签的零值字段在 Create 时省略用 DB 默认值，会导致 `enabled:false` 被落成 `true`（决策 48 停用语义被破坏）；`enabled=true` 默认由写入口显式指定。
2. **seed**：新增 `seed.BusinessDomains(db, path)`——仅当 `BusinessDomain` 表为空时从 `business_domains.yaml` 导入并强制预置 `infra` 兜底条目；DB 非空则直接返回（幂等，之后不再覆盖）。
3. **store**：`BusinessDomainStore` 重写为 DB-backed，保留 `List/Lookup/EnabledList/GetEnabledMap` 只读签名（调用方不破坏），新增 `Create/Update`。
4. **API**：
   - `POST /api/v2/platform/business-domains` 登记：body `{code,name,description}`；code 正则 `^[a-z0-9-]{1,64}$`、name 非空、重复 code → `bad_request`；默认 `enabled=true`。
   - `PUT /api/v2/platform/business-domains/:code` 受限编辑：仅接受 name/description/enabled（请求体不接收 code）；`code==infra` 且停用 → `bad_request`；无 DELETE 入口。
   - 路由在 `routes.go` 注册，`main.go` 挂载 DB store + seed 调用。

### TDD 测试

先写测试再实现，覆盖正常/边界/错误：

- `models/business_domain_test.go`：JSON 标签 snake_case、infra 常量。
- `db/seed/business_domain_test.go`：空表 seed + yaml 缺失降级 + 非空不覆盖（幂等）。
- `config/resource/business_test.go`：List/Lookup/EnabledList/GetEnabledMap/Create/Update + GET handler 全量（含停用项）。
- `config/resource/business_domain_write_test.go`：POST/PUT 成功、编码不规范、name 为空、重复、infra 停用 400、not_found。
- `cmd/metric-center/main_test.go`：`TestEndToEndBusinessDomains` 端到端（seed + GET + POST + PUT + infra 禁停用 + 无 DELETE）。
- `validate_test.go`/`template_test.go`：改用共享 `newBizStore`（DB 夹具），不再依赖 yaml。

### 修复的关键缺陷

- `models/business_domain.go` 注释行缺 `//` 前缀导致语法错误（编译失败）。
- `seed` 中 `infraFallback` 用 `const` 但为结构体字面量 → 改 `var`。
- `enabled` 字段 `default:true` 导致停用值被 GORM 覆盖为 true（见上）。移除 `default` 后 `go test` 全绿。
- `main.go` 缺 `import "github.com/metriccenter/metriccenter/platform/db/seed"`。

### 验证

- `go test ./platform/...` 全绿（含 cmd/metric-center 集成测试）。
- `go vet ./platform/...` 通过。
- `make check-repo-map` 通过（已重新生成 repo-map）。
- 服务实机 curl 验证：GET 返回 seed 字典（infra 兜底 + 两条 yaml）；POST 登记成功 `enabled=true`；POST 重复/编码不规范 → 400；PUT 改名成功且 code 不变；PUT infra 停用 → 400；DELETE → 404。

### 提交

- `feat(module-07): 业务分组字典 DB 化落库 + 登记/受限编辑 API + seed（决策 48，T07-18）`

### 前端配合

□ 需前端配合：新增「业务管理」业务分组字典页面（GET 拉全量、POST 登记、PUT 受限编辑、infra 停用按钮禁用提示）。

## 任务：资源校验必填分化 + Excel 声明导入（决策 93/95/96/97）

- 分支：`feat/module-07-resource-management`
- 关联决策：`docs/05-execution-records/module-07/design-decisions.md`（决策 92/93/95/96/97）
- 需求来源：`docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md` §5.2/§5.16.1/§5.16.2/§5.18/§5.19

### T07-93-B1：biz_code/app_code 必填按类型分化（commit ec8233b）

1. **validate.go**：`ValidateResourceInput` 的 biz_code 从全类型必填改为按类型分化——host/database/middleware 可空后补（为空不注入 biz 标签、不校验字典存在性）；application 必填；generic_target 的 app_code/biz_code 二选一（两者皆空 bad_request）。app_code 校验维持引用未停用应用字典条目（录入/编辑/导入三处同校验，经 `ApplicationDictStore` 注入）；编辑已属停用条目时经 `KeepDisabledValues` 提示并允许保留历史值（决策 92/93 红线）。
2. **excel.go / excel_test.go**：导入行 biz_code 可空后补；未登记且未声明码的引导文案统一为「请到『业务管理』页登记，或在本文件『业务声明』sheet 补充后重新导入」。
3. `go test ./platform/config/resource/...` + `go vet` 全绿。

### T07-97-B1：Excel 声明 sheet 解析 + 事务原子建字典落资源（commit a03e2b2）

1. **新增 excel_declare.go**：
   - `ParseDeclareSheets(fileBytes)`：解析「业务声明」（biz_code|biz_name|说明?）与「应用声明」（app_code|app_name|说明?）内联 sheet，缺省 sheet 返回空不报错；列头前两列固定、第三列可选、超 3 列报错；全空行跳过（`cellAt` 容错 excelize 尾部空单元格裁剪）。
   - `validateDeclareSheets`（校验顺序 ①声明自身）：code/name 必填、编码规范（BIZ_CODE_RE/APP_CODE_RE）、声明内重码硬拒绝、与存量字典同名（名称一致幂等跳过 / 不一致『绝不覆盖』硬拒绝）、停用条目不接受声明激活；失败由调用方 bad_request 整体拒绝。
   - `applyDeclaredDicts(db, sheets)`：声明建字典 status=enabled、source=excel-import（新常量 `DictSourceManual/ExcelImport/CMDB`），只增不覆盖。
2. **import.go**：step 4.5 插入声明解析/校验；step 5 事务化——`tx := db.Begin()` + `committed` 标志 + defer 兜底 Rollback；先 `applyDeclaredDicts(tx)` 使行级校验经 tx 绑定 store 达成「字典∪声明」可达性（②），再逐行写资源与 ImportRecord（③整体写），同一 SQLite 事务原子提交，任一 DB 失败整体回滚不留孤立字典条目；行级校验失败仍保持部分成功语义（声明不依赖资源存活）。
3. **models**：`BusinessDomain`/`ApplicationDict` 新增 `Source DictSource` 字段（default manual）。
4. **excel_declare_test.go**：解析/校验/应用/闭环 4 层单测——成功原子提交（断言 h.AppCode="new-app"）、`DropTable(&Host{})` 触发 500 整体回滚（字典/ImportRecord 全回滚）、声明内重码与缺 name bad_request、未登记未声明码归入「待登记清单」部分成功、幂等重导。
5. **import_test.go**：`openImportTestDB` 迁移字典表并预置 infra/app 夹具（决策 97 事务内同库字典 store 校验前提）。

### T07-97-B2：集成测试 application-dict 闭环 + 声明导入闭环（commit b3f4510）

1. **新增 cmd/metric-center/module07_integration_test.go**（复用 `buildIntegrationEngine`，memory DB + seed，不新增路由）：
   - `TestModule07ApplicationDictEndToEnd`：GET 预置 3 条 → POST 登记（默认 enabled、source=manual）→ 编码不规范/重复 code 400 → PUT 受限编辑（改名+停用，app_code 不可改）→ 停用不删除 → 新资源引用停用条目 bad_request（决策 92 红线）→ PUT 不存在 404 → 无 DELETE 404 → 字典落库断言。
   - `TestModule07DeclareImportEndToEnd`：声明建字典+落资源成功原子提交（source=excel-import、host 物理列 app_code）；drop hosts 表触发 500 整体回滚（字典/ImportRecord 不留，测试后 AutoMigrate 恢复表）；声明内重码 bad_request；缺 name bad_request；未登记未声明码归入待登记清单部分成功（errors[].reason 含声明引导）。

### 验证

- `go test ./platform/...` 全绿（28 包 ok，含 resource 与 cmd/metric-center 集成测试）。
- `go vet ./platform/...` 通过。
- `make check-repo-map` 通过（已重新生成 repo-map）。

### 提交

- `feat(module-07): biz_code 必填按类型分化 + generic 二选一 + 编辑保留停用历史值（T07-93-B1）`
- `feat(module-07): Excel 声明 sheet 解析 + 事务原子建字典落资源（T07-97-B1）`
- `feat(module-07): application-dict 闭环 + Excel 声明导入闭环集成测试（T07-97-B2）`
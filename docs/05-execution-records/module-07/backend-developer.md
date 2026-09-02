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
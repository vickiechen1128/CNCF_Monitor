# M07 自定义字段管理 admin 门与内置字段只读（Scenario Link #2）

- 日期：2026-11-23
- 任务标识：`M07-ADMIN-GATE`（对应 `docs/07-design/Module_07_Scenario_Link.md` 未决问题 #2）
- 分支：`rewrite/v2.0`
- 输入：
  - SRS `Module_07_Monitoring_Object_Management_Requirements.md` v2.4 §4.1 角色表、§5.8 FR-30~FR-34、§6.4 NFR-10、§6.7 NFR-24
  - HLD `Module_07_Monitoring_Object_Management_High_Level_Design.md` v1.0 §3 / §4.1 / §9 / §14B
  - Scenario Link `Module_07_Scenario_Link.md` 未决问题 #2
  - Skills：`golang-coding-style` / `api-standard` / `testing-tdd` / `cncf-git-workflow`

## 1. 口径订正（本轮关键）

原未决问题 #2 写作「SRS 要求内置模板与内置字段仅 admin 可改」，与 SRS 不一致：

| 对象 | 正确口径 | 实现落点 |
|------|----------|----------|
| 内置字段 | **任何角色（含 admin）都不可修改**；由平台代码定义，页面只读、接口无写入口 | 无写路由；自定义字段登记撞内置 key 时 400 |
| 自定义字段定义 | **仅平台管理员可增 / 改 / 移出** | `/attribute-definitions` 写路由挂 `RequireAdmin` |
| 自定义字段值 | 资源编辑的一部分，登录用户可维护 | `/resources/:id/attributes` 保持登录态 |
| M07 内置模板 | 不存在；M07 只有内置字段与标签模板（标签模板由运维架构师维护，不在本次 admin 收口） | — |

> 注：SRS §4.1 角色表列「运维架构师 / 平台管理员」，SCN-05 写「运维架构师」；MVP 只有 `admin` / `user` 两级（决策 44），本轮按用户裁决把自定义字段定义维护收口到 `admin`（`RequireAdmin`）。

## 2. 修改文件

| 文件 | 变更 |
|------|------|
| `platform/modules/m07/domain/builtin_fields.go` | 新增 `IsBuiltinField` / `IsBuiltinFieldKey`，供自定义字段接口识别平台内置 key |
| `platform/modules/m07/service/attribute_service.go` | 登记字段拒绝内置 key；按内置 key 寻址的编辑 / 移除返回 400 可执行提示 |
| `platform/modules/m07/handler/routes.go` | `/attribute-definitions` 读接口保持登录态；写接口移入 `RequireAdmin` 子组 |
| `platform/modules/m07/handler/routes_test.go` | 测试路由支持注入 admin / user / 匿名上下文，默认 admin 保持既有用例 |
| `platform/modules/m07/handler/admin_gate_test.go` | 新增：写接口 403、读接口 200、资源字段值不受 admin 门影响、内置字段全角色只读 |
| `platform/modules/m07/service/attribute_service_test.go` | 新增：内置 key 不能进入自定义字段字典，也不能经编辑/移除寻址 |
| `ui-custom/web/src/pages/resources/CIModelPage.tsx` | 非 admin 隐藏新增/编辑/移除入口，展示只读提示与空态文案 |
| `ui-custom/web/src/pages/resources/CIModelPage.test.tsx` | 登录态按角色注入；新增普通用户只读用例 |
| `docs/07-design/Module_07_Scenario_Link.md` | 订正未决问题 #2 并关闭；NFR-10~12 覆盖状态更新 |
| `docs/07-design/Module_07_Monitoring_Object_Management_High_Level_Design.md` | v1.1：权限收口说明、§4.1 鉴权、§4.2 接口标注、§9 安全、变更记录 |
| `docs/05-execution-records/module-07/api-contract-snapshot.md` | §8A 补鉴权与内置字段冲突错误语义 |

## 3. 关键实现

### 3.1 路由鉴权

```go
attributeDefGroup := platform.Group("/attribute-definitions")
attributeDefGroup.GET("", attributes.ListDefinitions) // 登录态即可：资源表单 / M01 字段字典消费
attributeDefAdmin := attributeDefGroup.Group("")
attributeDefAdmin.Use(auth.RequireAdmin())
attributeDefAdmin.POST("", attributes.CreateDefinition)
attributeDefAdmin.PUT("/:id", attributes.UpdateDefinition)
attributeDefAdmin.DELETE("/:id", attributes.RemoveDefinition)
```

- 匿名请求仍由全局 `AuthMiddleware` 先返回 401；已登录非 admin 由 `RequireAdmin` 返回 403 `forbidden`。
- 资源、字典、标签模板、导入等其他 M07 写操作保持登录态，不扩大 admin 门（SRS 未要求）。

### 3.2 内置字段只读

- 内置字段不落 `m07_attribute_definitions`，没有写路由。
- `CreateDefinition` 若 `domain.IsBuiltinField(category, key)` 为真，返回 400：`平台内置字段 "has_gpu" 不可新增、修改或移除；请换一个自定义字段 key`。
- `UpdateDefinition` / `RemoveDefinition` 若 id 恰为内置 key，返回同类 400 提示，避免落到通用 404。

### 3.3 前端

- `CIModelPage` 读取 `getStoredUser()?.role`：非 admin 不渲染「新增自定义字段」，自定义字段表格不渲染「操作」列，并展示「当前账号仅可查看 CI 模型」提示。
- 服务端仍为最终兜底，前端隐藏不替代 403 校验。

## 4. 验证结果

### 4.1 后端

```bash
METRIC_CENTER_TEST_POSTGRES_DSN='postgres://chenrt@127.0.0.1:5432/metric_center_test?sslmode=disable' \
  .tools/go/bin/go test ./platform/modules/m07/... -count=1
# ok：dictionary / domain / dto / handler / importer / references / repository / service

METRIC_CENTER_TEST_POSTGRES_DSN='...' .tools/go/bin/go test ./platform/... -count=1
# 全部 ok，0 失败（含 cmd/metric-center、db、m01~m09）

.tools/go/bin/go vet ./platform/modules/m07/...
# 通过

.tools/go/bin/gofmt -l platform/modules/m07
# 无输出
```

### 4.2 前端

```bash
cd ui-custom/web
../../.tools/pnpm/bin/pnpm vitest run src/pages/resources/CIModelPage.test.tsx
# 1 file / 11 tests passed

../../.tools/pnpm/bin/pnpm run typecheck:test   # 通过
../../.tools/pnpm/bin/pnpm lint                 # 0 warning
../../.tools/pnpm/bin/pnpm build                # 通过（仅既有 chunk size 提示）
```

### 4.3 服务启动

```bash
/tmp/opencode/mc-m07 --listen-address 127.0.0.1:18080 --web.static-dir ui-custom/web/dist
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18080/api/v3/platform/health   # 200
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18080/api/v3/platform/ready    # 200
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18080/                          # 200
curl -X POST .../attribute-definitions                                                  # 匿名 401 unauthorized
```

```bash
cd ui-custom/web && pnpm exec vite --host 127.0.0.1 --port 15173
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:15173/            # 200
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:15173/ci-models   # 200
```

验证后已停止后端与 Vite 进程并释放端口。

## 5. 与 SRS / 契约的偏离

无。SRS 未改动；本轮只订正 HLD / Scenario Link 对 SRS 的误读，并按 FR-30 / FR-32 / NFR-24 落实现。

## 6. 遗留

1. M07 其余写操作（资源、字典、标签模板、导入）按 SRS 保持登录态；若后续引入「运维架构师」独立角色，再按角色拆分。
2. 自定义字段定义的增删改仍未落只读快照（SRS 未强制，见 `ci-model-configuration.md` §8 遗留 #1）。
3. 存量数据若已存在与内置 key 同名的自定义字段，本轮不做数据迁移；新写入被拒绝，存量字段仍可读。建议上线前用
   `SELECT resource_category, attribute_key FROM m07_attribute_definitions WHERE deleted_at IS NULL` 与
   `domain.BuiltinFields` 对照清理。

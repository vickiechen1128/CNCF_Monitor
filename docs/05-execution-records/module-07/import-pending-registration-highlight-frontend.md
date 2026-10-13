# 导入「待登记清单」高亮覆盖五维度执行记录

- **执行角色**：frontend-developer
- **分支**：`feat/module-08-alert-dispatch`
- **关联问题**：F-23 系列后续 —— 导入错误「待登记清单」高亮只覆盖业务/应用，服务/平台/网域未登记被当普通错误行灰显
- **变更范围**：`ui-custom/web/src/pages/resources/ImportModal.tsx`、`ui-custom/web/src/pages/resources/ImportModal.test.tsx`
- **状态**：已完成（含破坏验证）

> 本记录与 `platform-code-validation-guidance.md` 分开成文：后者是后端「platform_code 文案分流」
> （`validate.go` / `validate_test.go`），本记录是前端「错误行高亮判定」（`ImportModal.tsx`），
> 代码文件、验证对象均不同，合并不利于按问题编号检索。

---

## 1. 原判定缺陷与根因

`ImportModal.tsx` 的错误行「原因」列渲染前有一道「是否属于待登记清单」的判定，原实现是
**纯 reason 字符串匹配**：

```ts
function isPendingRegistrationReason(reason?: string): boolean {
  return !!reason && reason.includes('未登记') && /业务|应用/.test(reason)
}
```

正则 `/业务|应用/` 只匹配「业务」「应用」两个字，而后端五处未登记文案的**主语各不相同**：

| 维度 | 后端文案（`platform/config/resource/`） | 文案主语 | 旧正则是否命中 |
|------|---------------------------------------|----------|----------------|
| 业务 `biz_code` | `业务 %s 未登记且未在声明 sheet 声明，请在『业务管理』页登记…`（`excel.go` L328） | 业务 | ✅ |
| 应用 `app_code` | `应用 %s 未登记且未在声明 sheet 声明，请在『应用管理』页登记…`（`excel.go` L357） | 应用 | ✅ |
| 服务 `service_code` | `服务 %s 未登记且未在声明 sheet 声明，请在『服务管理』页登记…`（`excel.go` L383） | 服务 | ❌ |
| 平台 `platform_code` | `平台 %s 未登记且未在声明 sheet 声明，请在『平台管理』页登记…`（`validate.go` L282） | 平台 | ❌ |
| 网域 `network_domain_id` | `网域 %s 未登记，请先到『系统设置 → 网域管理』登记后重新导入`（`excel.go` L292） | 网域 | ❌ |

**根因**：判定把「字典维度的业务语义」（谁未登记）写死成了两个字面量，而真实信号是
**后端已经把维度落在 `ImportErrorDetail.Field` 上**（`biz_code` / `app_code` / `service_code` /
`platform_code` / `network_domain_id`）—— 前端没有用这个结构化字段，只在文案里「找字」。

**后果**：后端其实已给出正确且可执行的引导文案（「请先到 XX 管理页登记，补录后重新导入」），
前端却把服务/平台/网域三类未登记行当**普通错误行**灰显渲染，用户拿不到
「请先到平台侧登记，补录后再上传」这个信号 —— 用户需求未被满足的这一环在渲染层。

---

## 2. 新判定规则

判定函数从「收 reason 字符串」改为「收整条错误对象」，按 **field 优先 + reason 兜底** 两段：

```ts
const PENDING_REGISTRATION_FIELDS = new Set([
  'biz_code', 'app_code', 'service_code', 'platform_code', 'network_domain_id',
])

function isPendingRegistrationError(error?: { field?: string; reason?: string }): boolean {
  const reason = error?.reason ?? ''
  if (!reason.includes('未登记')) return false
  if (reason.includes('已停用')) return false
  const field = error?.field?.trim()
  if (field) return PENDING_REGISTRATION_FIELDS.has(field)
  return /业务|应用|服务|平台|网域/.test(reason)
}
```

判定链：

1. **reason 必须含「未登记」** —— 总闸。后端对「已停用」「不属于关联平台」两类文案均不含
   「未登记」（`validate_test.go` L1201 / L1213 以 `assert.NotContains(t, err.Error(), "未登记")`
   锁定），故这两类天然被排除。
2. **显式排除「已停用」** —— 加固不变量。语义是「去管理页**启用**」而非「**去登记**」，
   即使后端将来把文案合并成「未登记或已停用」也不会被误标为待登记。
3. **field 优先** —— 命中五维度字段集合即判定为待登记；`field` 存在但不在集合内
   （如 `instance_ip`、`dedup_key`、`custom_labels`）直接判否，不看文案。
4. **reason 兜底** —— `field` 为空/缺失时（整批拒绝类错误可能无字段），
   退到 reason 语义判定，五维度任一主语即命中，避免漏判。

**`field` 可用性核实**：类型侧 `ui-custom/web/src/types/resource.ts` L373-379 的
`ImportError.field: string` 是必填；后端侧 `platform/models/import_record.go` L26-31 的
`ImportErrorDetail.Field` 有 `json:"field"` 标签、无 `omitempty`，恒存在（可能为空串）；
所有行级错误经 `excel.go` 的 `fieldErr(row, field, value, reason)` 构造，字段值与上表一一对应。
故 field 是稳定结构化信号，但**允许为空**，故保留 reason 兜底分支。

### 排除项（与后端文案分流严格对齐）

| 排除项 | 后端文案 | 为何不命中 |
|--------|----------|------------|
| 应用/服务/平台已停用 | `应用 X 已停用，请在『应用管理』页启用后重新导入`（`excel.go` L354/L380；`validate.go` L280） | 不含「未登记」（第 1 条即挡），且第 2 条显式挡 |
| 平台自洽校验失败 | `平台 X 不属于应用 Y 的关联平台`（`validate.go` L305） | 不含「未登记」 |
| 普通字段错误 | `IP 非法`、`判重键命中…`、`port 必须为 1~65535 的整数` 等 | field 不在集合 + 无「未登记」 |

渲染沿用文件里既有分支（`WarningOutlined` + `EllipsisText type="warning"`，L163-175），
未另起样式；仅把 render 回调第二参 `record` 传入判定函数。

---

## 3. 测试覆盖

`ui-custom/web/src/pages/resources/ImportModal.test.tsx` 新增表驱动用例
（`PENDING_HIT_CASES` / `PENDING_MISS_CASES` + 两个兜底用例）：

| # | 用例 | 类型 | 断言 |
|---|------|------|------|
| 1 | 业务未登记（`biz_code`） | 命中 | warning 图标 × 1（**回归护栏**，旧行为不被改坏） |
| 2 | 应用未登记（`app_code`） | 命中 | warning 图标 × 1 |
| 3 | **服务未登记（`service_code`）** | 命中 | warning 图标 × 1（新增覆盖） |
| 4 | **平台未登记（`platform_code`）** | 命中 | warning 图标 × 1（新增覆盖） |
| 5 | **网域未登记（`network_domain_id`）** | 命中 | warning 图标 × 1（新增覆盖，本轮行为变更） |
| 6 | 应用 / 服务 / 平台已停用 | 不命中 | 无 warning 图标（护栏） |
| 7 | 平台自洽（`不属于应用 X 的关联平台`） | 不命中 | 无 warning 图标（护栏） |
| 8 | 普通字段错误（`instance_ip` / `IP 非法`） | 不命中 | 无 warning 图标 |
| 9 | `field` 为空串 + 未登记文案 | 命中 | warning 图标 × 1（reason 兜底） |
| 10 | `field` 为空串 + 已停用 / 平台自洽文案 | 不命中 | 无 warning 图标（兜底路径同样守排除项） |

原有 11 个用例全部保留未删改（含 `renders actionable guidance for pending-registration errors` 回归用例）。

---

## 4. 破坏验证（真实输出）

把判定临时改回旧正则 `/业务|应用/`：

```ts
// BREAK-VERIFY: 临时回退到旧正则，验证新增用例确实能变红
return !!error?.reason && error.reason.includes('未登记') && /业务|应用/.test(error.reason)
```

`npx vitest run src/pages/resources/ImportModal.test.tsx` 真实输出：

```
 ❯ src/pages/resources/ImportModal.test.tsx (24 tests | 3 failed) 3647ms
   ✓ ImportModal > F-8-a：次级文字链接直触发下载当前资源类型模板 334ms
   × ImportModal > 待登记清单高亮：'服务未登记' 311ms
   × ImportModal > 待登记清单高亮：'平台未登记' 316ms
   × ImportModal > 待登记清单高亮：'网域未登记' 262ms
⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯
 FAIL  src/pages/resources/ImportModal.test.tsx > ImportModal > 待登记清单高亮：'服务未登记'
 FAIL  src/pages/resources/ImportModal.test.tsx > ImportModal > 待登记清单高亮：'平台未登记'
 FAIL  src/pages/resources/ImportModal.test.tsx > ImportModal > 待登记清单高亮：'网域未登记'
     → Unable to find an accessible element with the role "img" and name "warning"
 Test Files  1 failed (1)
      Tests  3 failed | 21 passed (24)
```

**结论**：新增的 3 个用例（服务 / 平台 / 网域未登记）在旧正则下确实变红，
证明它们真能捕获本次缺陷，不是空跑护栏；其余 21 个用例（含业务/应用回归、已停用与
平台自洽护栏）在新旧两版下均绿 —— 说明改动只扩大了命中面，**没有破坏原有行为与排除项**。
随后已恢复新判定实现，重跑全绿（见下）。

---

## 5. 验证命令真实输出

### `npx tsc --noEmit`

```
npm warn Unknown project config "only-built-dependencies". ...
=== TSC_EXIT=0 ===
```

（唯一输出是 npm 对 pnpm 专属配置的既有 warn，与本轮改动无关。）

### `npx vitest run src/pages/resources`

```
 ✓ src/pages/resources/ResourceFormDrawer.test.tsx (46 tests) 14809ms
 ✓ src/pages/resources/ResourceDetailDrawer.test.tsx (28 tests) 1661ms
 ✓ src/pages/resources/ApplicationDictPage.test.tsx (14 tests) 3189ms
 ✓ src/pages/resources/ServiceManagementPage.test.tsx (16 tests) 3627ms
 ✓ src/pages/resources/ImportModal.test.tsx (24 tests) 3591ms
 ✓ src/pages/resources/TemplateDownloadModal.test.tsx (10 tests) 585ms
 ✓ src/pages/resources/PlatformManagementPage.test.tsx (8 tests) 1806ms
 ✓ src/pages/resources/BusinessDomainPage.test.tsx (7 tests) 1616ms
 ✓ src/pages/resources/ImportRecordsPanel.test.tsx (8 tests) 1280ms
 ✓ src/pages/resources/resourceColumnPrefs.test.ts (5 tests) 4ms
 ✓ src/pages/resources/ResourcesPage.test.tsx (79 tests) 94720ms
 ✓ src/pages/resources/DictLifecycleNotice.test.tsx (3 tests) 91ms
 Test Files  12 passed (12)
      Tests  248 passed (248)
```

### `npx eslint src/pages/resources`

```
npm warn Unknown project config "only-built-dependencies". ...
=== ESLINT_EXIT=0 ===
```

（无告警无错误。）

### `make repo-map` + `scripts/check-repo-map.sh`

```
repo-map: docs/04-source-architecture/repo-map.md（Go 文件 400，TS/TSX 文件 174）
OK: repo-map 与当前业务代码一致
```

`repo-map.md` diff 仅一行时间戳（新增符号 `PENDING_REGISTRATION_FIELDS` /
`isPendingRegistrationError` 均为模块私有、未 export，不进符号地图）。

---

## 6. 边界与未做事项

- **未改后端文案**：五处文案（业务/应用/服务/平台/网域）已各自到位且有测试锁定，
  本轮纯前端适配；`platform/` 零改动。
- **未改 `resourceApi` 调用方式**：`template` / `importExcel` 走 `rawRequest` + Bearer
  token 的既有修复未触碰。
- **未动 `ResourceFormDrawer.tsx`**（cluster 必填性矛盾为设计侧待裁定项）。
- **未动 `TemplateDownloadModal.tsx`**（`FILLING_TIPS` 五类分化 / `DICT_SCOPE_HINTS` /
  网域三件事提示为 commit fd4f7f0 基线，原样保留）。
- **仅改 `ui-custom/web/` + 本执行记录**：未触碰 `platform/`、`upstream/`、
  `docs/02-product-requirements/`（PRD 红线）。
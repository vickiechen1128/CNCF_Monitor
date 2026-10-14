# platform_code 校验引导缺口修复执行记录

- **执行角色**：backend-developer
- **分支**：`feat/module-08-alert-dispatch`
- **关联问题**：F-23 系列后续 —— `platform_code` 错误引导文案与后端实际能力不一致
- **变更范围**：`platform/config/resource/validate.go`、`platform/config/resource/validate_test.go`
- **状态**：已完成（含两轮破坏验证）

> 本记录与 `template-example-and-value-sheet.md` 分开成文：前者是「模板生成侧」（示例行 + sheet2 取值说明），
> 本记录是「校验引导侧」（platform_code 错误文案分流），主题、代码文件、破坏验证对象均不同，合并不利于后续按问题编号检索。

---

## 1. 背景与两处缺口

资源导入 / 表单提交对「用户填写了平台侧未创建的编码」已有完整校验（决策 110），但
`platform_code` 分支（`validate.go` 的 `validatePlatformCode`）的**失败文案**与
`biz_code` / `app_code` / `service_code` 三处已做对的范式不一致，存在两处缺口。

原实现（单分支）：

```go
if _, ok := enabled[code]; !ok {
    return fmt.Errorf("平台 %s 未登记或已停用，请在『平台管理』页登记或启用后重试", code)
}
```

### 缺口 1：文案未提「平台声明」sheet —— 文案与能力不一致

后端**事实上支持**在同一个 Excel 内用同名 sheet 声明新平台：列头
`platform_code | platform_name | 说明`（`excel_declare.go` 的 `platformDeclareSheet` /
`platformDeclareHeader`），解析后由 `applyDeclaredDicts` 经 `import.go` 的接入点与
**资源落库同事务原子提交**。

而 `biz_code` / `app_code` / `service_code` 三处的「未登记」文案都已经说了
「或在『XX声明』sheet 补充后重新导入」，唯独 `platform_code` 只叫用户去
『平台管理』页 —— 用户据此会误以为**必须**切到别的页面操作，能力被文案掩盖。

### 缺口 2：未登记与已停用混成一句

「未登记」（字典里根本没有这个 code，需要去创建）和「已停用」（条目存在、
`enabled=false`，只需启用）是两种修复动作完全不同的状态，原文案让用户自己猜。

更实际的影响：前端 `isPendingRegistrationReason` 仅匹配**含「未登记」**的文案来高亮
「待登记」。原合并文案对停用平台也含「未登记」，停用态会被误标为待登记，指向错误的
修复动作。

---

## 2. 修复方式

### 2.1 `PlatformDictStore.Lookup` 已存在，无需补齐

按要求先确认平台 store 是否已有等价 `Lookup`：**已存在**
（`platform.go` L66-L80），签名与 `appStore.Lookup` / `svcStore.Lookup` 完全同构：

```go
// Lookup 按 platform_code 查找条目（含停用项）。ok=false 表示不存在。
func (s *PlatformDictStore) Lookup(code string) (PlatformDict, bool, error)
```

因此**没有为平台 store 新增任何方法**，`ok=true` 表示「存在但停用」，
`ok=false` 表示「未登记」。

### 2.2 单分支改为 Lookup 双分支

```go
if _, ok := enabled[code]; !ok {
    _, found, lerr := refs.PlatformStore.Lookup(code)
    if lerr != nil {
        return fmt.Errorf("查询平台 %s 失败：%w", code, lerr)
    }
    if found {
        return fmt.Errorf("平台 %s 已停用，请在『平台管理』页启用后重新导入", code)
    }
    return fmt.Errorf("平台 %s 未登记且未在声明 sheet 声明，请在『平台管理』页登记，或在本文件『平台声明』sheet 补充后重新导入。若你使用的是旧模板，可能缺少最新字典值，请重新下载模板后填写", code)
}
```

三处 `enabled` 判定保留在原位未动：`GetEnabledMap` 仍是主判定路径（一次查询拿到
全量启用态），`Lookup` 只在**已判定失败后**做一次区分查询，不引入额外往返于成功路径。

### 2.3 文案最终形态

| 场景 | 最终文案 |
|------|----------|
| 已停用（条目存在、`enabled=false`） | `平台 %s 已停用，请在『平台管理』页启用后重新导入` |
| 未登记（字典中不存在） | `平台 %s 未登记且未在声明 sheet 声明，请在『平台管理』页登记，或在本文件『平台声明』sheet 补充后重新导入。若你使用的是旧模板，可能缺少最新字典值，请重新下载模板后填写` |
| `Lookup` 查询失败 | `查询平台 %s 失败：%w`（与 excel.go 的 `查询应用 %s 失败：%v` 同构） |
| 已启用但不属于 app_code 关联平台 | `平台 %s 不属于应用 %s 的关联平台`（**未改动**，见 §5） |

「旧模板可能缺最新字典值，请重新下载模板」提示按要求**保留**在未登记文案尾部。

### 2.4 同步更新函数头注释

`validatePlatformCode` 的头注释第 3 条由「填值：须命中平台字典启用条目（停用条目不可新选）」
改为描述 Lookup 分流后的语义，避免注释与实现漂移。控制流、nil 放行分支、自洽校验段均未改。

---

## 3. 测试

### 3.1 新增 `TestValidatePlatformCode_GuidanceByRegistrationState`

覆盖任务要求的 4 个场景（复用既有夹具 `platformTestRefs` / `platformTestAppStore` /
`platformTestInput`，夹具含启用平台 platform-a/b/c、停用平台 old-platform、启用应用 app-a/b）：

| 子测试 | 关键断言 |
|--------|----------|
| 未登记 | 含 `平台 no-such-platform 未登记` + `『平台管理』页登记` + `『平台声明』sheet 补充后重新导入` + `重新下载模板`；**不含** `已停用` |
| 已停用 | 含 `平台 old-platform 已停用` + `『平台管理』页启用后重新导入`；**不含** `未登记`、**不含** `平台声明` |
| 已启用且属于关联平台 | `require.NoError` |
| 已启用但不属于关联平台（回归护栏） | 含 `平台 platform-b 不属于应用 app-a 的关联平台`；**不含** `未登记`、**不含** `已停用` |

后两条 `NotContains` 是防止未来把「自洽校验失败」误判成「未登记 / 已停用」的关键护栏。

### 3.2 改写 4 处失效断言（注明原特征）

原实现把两种状态合并成一句，旧测试统一断言子串 `未登记或已停用`。文案分流后这 4 处
断言失效，改写为各自场景的真实特征，并在注释中**保留「原特征」说明**：

| 位置 | 场景 | 原断言 | 改写后 |
|------|------|--------|--------|
| `validate_test.go` L1019 `TestValidateResourceInputWithPlatform_SelfConsistency/引用停用平台` | 已停用 | `Contains("未登记或已停用")` | `Contains("已停用")` + `Contains("启用")` + `NotContains("未登记")` |
| `validate_test.go` L1027 同上 `/未登记平台` | 未登记 | `Contains("未登记或已停用")` | `Contains("未登记")` + `Contains("平台管理")` + `Contains("平台声明")` |
| `validate_test.go` L1087 `TestValidateResourceInputWithPlatformForUpdate_KeepsDisabledHistory/改为新的停用平台` | 已停用（编辑态 keep 不豁免） | `Contains("未登记或已停用")` | `Contains("已停用")` + `Contains("启用")` |
| `validate_test.go` L1130 `TestValidatePlatformCode_HalfInitializedRefsPasses/AppPlatformStore == nil` | 已停用（该子测试断言的正是「启用态校验仍生效」） | `Contains("未登记或已停用")` | `Contains("已停用")` |

**原始意图未被削弱**：4 处断言要验证的不变量（引用停用 / 未登记平台必被拒绝，
且编辑态 keep 不豁免新值、半初始化 refs 下启用态校验仍生效）全部保留，只是断言的
匹配串从「合并文案」收敛为「该场景真实分支的特征」。

未受影响的同名断言（属其他函数，**未改动**）：

- `create_update_test.go` L296 —— `biz_code` 的 `validateBizCodeEnabled`；
- `app_platform_rel_test.go` L82/L85、`service_test.go` L102-105/L144、`app_platform_rel.go`、
  `service.go`、`application_dict.go` —— 分别是应用/平台关联、服务自身、应用字典入口，
  属于应用↔平台关系维护与服务定义路径，不在本次范围内。

---

## 4. 破坏验证（两轮，均变红后恢复）

### 破坏 1：把「已停用」分支改回合并文案

```go
if found {
    return fmt.Errorf("BREAK-DISABLED 平台 %s 未登记或已停用，请在『平台管理』页登记或启用后重试", code)
}
```

`go test -count=1 -run 'TestValidatePlatformCode_GuidanceByRegistrationState|TestValidateResourceInputWithPlatform_SelfConsistency|TestValidateResourceInputWithPlatformForUpdate_KeepsDisabledHistory|TestValidatePlatformCode_HalfInitializedRefsPasses'` 真实输出（节选）：

```
--- FAIL: TestValidateResourceInputWithPlatform_SelfConsistency (0.01s)
    --- FAIL: .../引用停用平台_⇒_bad_request（引导启用，不误报未登记） (0.00s)
        	Error: "BREAK-DISABLED 平台 old-platform 未登记或已停用，请在『平台管理』页登记或启用后重试" should not contain "未登记"
--- FAIL: TestValidatePlatformCode_GuidanceByRegistrationState (0.01s)
    --- FAIL: .../已停用_⇒_引导启用，且不含未登记字样 (0.00s)
        	Error: ... does not contain "平台 old-platform 已停用"
        	Error: ... does not contain "『平台管理』页启用后重新导入"
        	Error: ... should not contain "未登记"
FAIL	github.com/metriccenter/metriccenter/platform/config/resource	0.636s
```

### 破坏 2：把「未登记」文案砍掉声明 sheet 双路径与模板提示

```go
return fmt.Errorf("BREAK-NOTREG 平台 %s 未登记，请在『平台管理』页登记后重试", code)
```

真实输出（节选）：

```
--- FAIL: TestValidateResourceInputWithPlatform_SelfConsistency (0.02s)
    --- FAIL: .../未登记平台_⇒_bad_request（同时给出登记页与平台声明_sheet_双路径） (0.00s)
        	Error: ... does not contain "平台声明"
--- FAIL: TestValidatePlatformCode_GuidanceByRegistrationState (0.01s)
    --- FAIL: .../未登记_⇒_双路径引导（平台管理页_/_平台声明_sheet） (0.00s)
        	Error: ... does not contain "『平台声明』sheet 补充后重新导入"
        	Error: ... does not contain "重新下载模板"
FAIL	github.com/metriccenter/metriccenter/platform/config/resource	0.636s
```

### 恢复确认

`grep -rn "BREAK-" platform/config/resource/` 无输出（无残留破坏标记），
`go test -count=1 ./platform/config/resource/...` 回到 `ok ... 1.205s`。

---

## 5. 明确未做的事（遵守任务红线）

- **未改** `cluster` 必填口径；
- **未删** `zone_env` 列；
- **未改** `validateDeclareSheets` 的四条声明 sheet 校验红线；
- **未改** 导入接口签名与错误响应结构（`models.ImportErrorDetail`）；
- **未改** `validatePlatformCode` 末尾的自洽校验逻辑，也未改其文案
  （`平台 %s 不属于应用 %s 的关联平台`）。该分支在字典可达性检查**之后**执行，
  与「未登记」是先后两个不同阶段：能走到自洽校验说明平台**已启用**，只是不属于
  该应用的关联集合。新增的 `NotContains` 断言即为防止两条文案日后被混用；
- **未改** 其他字典（biz / app / service / 应用↔平台关联 / 服务自身）的 `未登记或已停用`
  文案 —— 它们不属本次指派的 `platform_code` 范围，仅在测试影响面分析中记录。

---

## 6. 验证命令与真实输出

```
$ export PATH="$(pwd)/.tools/go/bin:/usr/bin:/bin:/usr/local/bin:/usr/sbin:/sbin:$PATH"
$ go build ./platform/...
（无输出，exit 0）

$ go vet ./platform/config/resource/...
（无输出，exit 0）

$ go test -count=1 ./platform/config/resource/...
ok  	github.com/metriccenter/metriccenter/platform/config/resource	1.205s

$ make repo-map
repo-map: docs/04-source-architecture/repo-map.md（Go 文件 400，TS/TSX 文件 174）

$ make check-repo-map
OK: repo-map 与当前业务代码一致
```

## 7. 遗留 / 待裁定

- **`app_platform_rel.go` L201** 的 `平台 %s 未登记或已停用，请到『平台字典』登记或启用后重试`
  与本次改过的文案仍不同构（它是「应用↔平台关联关系」写入路径的入口校验，不是资源
  platform_code 校验）。是否一并对齐双路径口径，取决于该路径是否也支持声明通道，
  需设计/PRD 确认后另行处理，本次未动。
- **前端提示联动**：`isPendingRegistrationReason` 依据「未登记」子串高亮待登记的逻辑
  现在能正确区分两种状态（停用态文案已不含「未登记」）。前端代码本次未改
  （`ui-custom/web/` 为禁改目录），语义上无需改动即可正确工作。
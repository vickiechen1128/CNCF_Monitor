# 设计提案：通知「渠道 ↔ 模板」一等绑定与引导动线（M08 PL-3 续）

> 类型：feat 分支设计提案（落 `feat/module-08-alert-dispatch`，非 design 分支 PRD 载体）
> 作者：Orchestrator / chenrt
> 日期：2026-09-30
> 状态：**已实施（2026-09-30 用户拍板方案 B 并落地；实现见 §5，契约回写 `api-contract-snapshot.md` §11.7，回归测试见 §8）**
> 关联：`dev-feedback.md` **#29**（克隆修复，已 landed）、**#30**（本提案的设计缺口登记）、`alert-route-frontend-editor.md` §4.9（最小运行骨架自动布缆，可组合）
> 决策归属：M08 设计侧（PRD / 契约快照回写待用户在 design 分支做版本化迭代时单向同步）

---

## 1. 背景与问题陈述

2026-09-30 用户就 #29（「复制并自定义模板」克隆修复）追问一组产品/架构问题，归纳为一句话：

> **产品允许建多个通知模板，但「某渠道到底用哪个模板」这条通路完全没接通——自定义模板在自动链路里恒哑火。**

具体问题：
1. 新增飞书模板后，原来的默认模板是否还生效？
2. 产品是否允许多模板配置？
3. 通知渠道是否要按多模板 match？是否需要引导动线？
4. 默认模板与自建模板2 是否会冲突？

#29 只修了「克隆能建出副本」，但副本建出来**仍然不会被任何渠道自动用上**。本提案把 #30 的设计缺口收敛为一套完整方案：引入**渠道 ↔ 模板一等绑定**，让「复制并自定义 → 渠道绑定 → 真正生效」形成闭环。

---

## 2. 现状实证（代码级，全部已核对）

| # | 证据 | 结论 |
|---|------|------|
| A | `platform/alertmanager/notify/bridge.go:186-204` `resolveBridgeTemplate`：URL 无 `?template=` 时恒走 `BuiltinTemplateForType(db, ch.Type)`（按 `is_builtin=true` 取最近一条） | 自动链路**永远只用内置默认模板**；自定义模板（`is_builtin=false`）**永不被自动选中** |
| B | `platform/configcenter/generator/notify_receivers.go:207-210` `bridgeReceiverURL`：M09 物化 receiver 只写 `?channel=<ID>`、**不带 template** | 即便平台生成 receiver，也不会把模板带进链路 |
| C | `platform/models/alertmanager_notify.go`：`NotifyChannel`（:76-83）**无 `template_id` 字段** | 渠道与模板之间**数据层无关联** |
| D | 前端 `ui-custom/web/src/pages/alerts/NotifyChannelsPage.tsx`、`NotifyChannelDrawer.tsx`：渠道增改表单**无任何模板选择器**（grep `template\|模板` 零命中） | 用户**无 UI 入口**把渠道绑到某个模板 |

**由此判定的真实行为（回答用户四问）：**
- **Q1 默认是否还生效**：是，且是唯一自动生效的。自定义模板2 建了也恒不渲染。
- **Q2 是否允许多模板**：结构性允许（模型/UI/克隆支持、append-only 无删除），但**功能性半残**——能建、平台自动链路只会用内置默认。
- **Q3 渠道是否要 match / 要引导动线**：**要**。当前从「建模板」到「让渠道用上」之间无任何通路；用户只能手改 receiver URL 加 `?template=2`，而该改动会被 M09 下次重算覆写回 `?channel=<ID>`（平台命名空间地址演进识别），**手动绑定不持久**。
- **Q4 默认与模板2 是否冲突**：**不冲突，但静默失效（dead config）**。`BuiltinTemplateForType` 只认 `is_builtin=true`，两者不互相覆盖；但用户「默认信息不全、建模板2 补足」的心智模型完全落空——模板2 看似配好、实则从未渲染。比直接报错更隐蔽。

---

## 3. 设计目标与非目标

**目标**
- 提供**一等**的「渠道 → 通知模板」绑定，默认回落内置默认（保留零配置 Happy Path）。
- 让 #29 克隆出的自定义模板**真正可被某渠道用上**，形成完整引导动线。
- 绑定经 M09 物化持久写入 receiver URL，不被重算覆写。

**非目标（本期不做）**
- 不引入「每个告警/规则级指定模板」（那是路由层语义，见 `alert-route-frontend-editor.md` 第二步/三步）。
- 不引入模板删除端点（维持 append-only；绑定不会因删除而悬空）。
- 不改动渲染函数 `Render` 与默认回落语义。

---

## 4. 方案对比

| 方案 | 内容 | 取舍 |
|------|------|------|
| **A 仅文档引导手改 URL** | 在 PRD/UI 文案里教用户手改 receiver 加 `?template=` | ❌ 已被现状证伪：M09 重算会覆写，绑定不持久；且把内部 query 暴露给用户手改，脆弱 |
| **B 渠道 ↔ 模板一等绑定（推荐）** | `NotifyChannel` 加 `default_template_id`；桥读绑定；M09 输出 `&template=`；前端渠道表单下拉 + 双向引流 | ✅ 根治：绑定是数据属性、随物化持久、UI 可操作、回落内置默认保底 |
| **C 模板归属渠道（谁建归谁）** | 自定义模板只能绑定到创建时指定的单一渠道 | ❌ 过度收窄：一个自定义模板本可被多个渠道复用（如两个飞书群用同一张卡），C 破坏复用 |

**推荐 B**：把 `?template=` 这个桥早已支持的隐藏钩子，升级为「渠道属性」，全链路自然接通。

---

## 5. 推荐方案详设（方案 B）

### 5.1 数据模型

`platform/models/alertmanager_notify.go` 的 `NotifyChannel` 新增字段：

```go
type NotifyChannel struct {
    BaseModel
    Name              string               `gorm:"size:100;not null" json:"name"`
    Type              NotifyChannelType    `gorm:"size:20;not null" json:"type"`
    WebhookURL        string               `gorm:"size:1024;not null" json:"webhook_url"`
    Secret            string               `gorm:"size:256" json:"secret,omitempty"`
    Enabled           bool                 `gorm:"not null" json:"enabled"`
    DefaultTemplateID *uint                `gorm:"size:20" json:"default_template_id,omitempty"` // 新增：null=用内置默认
}
```

- `null` = 使用内置默认模板（**回落语义不变**，零配置 Happy Path 保持）。
- 非空 = 该渠道渲染时使用此模板；约束 `template.channel_type == channel.type`（桥已校验 mismatch，渠道 CRUD 也前置校验）。
- **迁移**：`db.AutoMigrate` 对 SQLite 的 ADD COLUMN nullable 安全；无需回填存量（存量均为 `null` → 回落内置默认）。

### 5.2 桥渲染选模板口径（`bridge.go` `resolveBridgeTemplate`）

优先级：**显式 `?template=` > 渠道绑定 `default_template_id` > 内置默认**。

```go
func resolveBridgeTemplate(db *gorm.DB, ch *models.NotifyChannel, rawID string) (*models.NotifyTemplate, error) {
    // 1) 显式 template ID（须与渠道类型一致）
    if rawID != "" {
        tplID, err := parseUintQuery(rawID)
        if err != nil { return nil, ErrBridgeTemplateInvalid }
        tpl, err := GetTemplate(db, tplID)
        if err != nil { return nil, err }
        if tpl.ChannelType != ch.Type { return nil, ErrBridgeTemplateMismatch }
        return tpl, nil
    }
    // 2) 渠道绑定模板
    if ch.DefaultTemplateID != nil && *ch.DefaultTemplateID != 0 {
        tpl, err := GetTemplate(db, *ch.DefaultTemplateID)
        if err == nil && tpl.ChannelType == ch.Type {
            return tpl, nil
        }
        // 绑定失效（被删/类型不符/脏数据）→ 优雅回落内置默认，不阻断通知
        bridgeLogf("[notify-bridge] channel=%d bound template=%d invalid, fallback builtin: %v", ch.ID, *ch.DefaultTemplateID, err)
        // 落到 3)
    }
    // 3) 内置默认
    return BuiltinTemplateForType(db, string(ch.Type))
}
```

- **优雅回落**：绑定解析失败时**不返回 400**（否则 AM 无限重试），而是回落内置默认并记 warning——绑定是「便利覆盖」，缺省不应让告警整体失败。
- 显式 `?template=`（手工/高级）仍保留最高优先级，兼容存量手改 receiver 的用法。

### 5.3 M09 receiver 物化（`notify_receivers.go` `bridgeReceiverURL`）

```go
func bridgeReceiverURL(base string, ch models.NotifyChannel) string {
    u := strings.TrimRight(base, "/") + bridgeEndpointPath + "?channel=" + strconv.FormatUint(uint64(ch.ID), 10)
    if ch.DefaultTemplateID != nil && *ch.DefaultTemplateID != 0 {
        u += "&template=" + strconv.FormatUint(uint64(*ch.DefaultTemplateID), 10)
    }
    return u
}
```

- 调用点由 `bridgeReceiverURL(in.BridgeURL, ch.ID)` 改为传 `ch`（或拆出两参）。
- 平台命名空间地址演进识别（`isPlatformBridgeURL` 只看 path）**不受影响**：`&template=` 不改变路径形态，重算仍识别为平台产物、原地更新时重新拼带绑定 ID，绑定随之持久。

### 5.4 前端：渠道表单下拉 + 双向引导动线

**改动点**：`ui-custom/web/src/pages/alerts/NotifyChannelDrawer.tsx`
- `FormValues` 增 `default_template_id?: number`。
- 在「渠道类型」与「机器人 Webhook」之间新增表单项「通知模板」：
  - 选项 = **该渠道类型**下的模板列表（调 `notifyTemplatesApi.list()` 过滤 `channel_type == 当前 type`）：内置默认置顶并标注「平台内置（默认）」、自定义可选。
  - 默认空 / placeholder = `使用平台内置默认模板`（对应 `default_template_id=null`）。
  - 切换渠道类型时重置该下拉（避免跨类型绑定）。
  - 提示文案：「未选则使用平台内置默认模板；如需个性化卡片，可先到通知模板页复制内置模板自定义后再回来选择。」
- `handleFinish`：`default_template_id` 显式选了才进 payload（空 → 不传，服务端保持 `null`）；`UpdateNotifyChannelPayload` / `CreateNotifyChannelPayload` 增加可选 `default_template_id`。
- `useEffect` 回显：编辑时回填 `record.default_template_id`。

**双向引流**：
- 模板页 `NotifyTemplatesPage.tsx`：「复制并自定义」保存成功后 / 内置区说明处，加一句「复制出的模板需在**通知渠道**中绑定才会生效，去绑定 →」（链接 `/notify-channels`）。
- 渠道抽屉模板下拉旁：「没有合适的模板？去**复制内置模板**自定义 →」（链接 `/notify-templates`）。

**类型/接口**：`ui-custom/web/src/types/alertmanager.ts` 的 `NotifyChannel` 增 `default_template_id?: number`；`CreateNotifyChannelPayload` / `UpdateNotifyChannelPayload` 增同字段（可选）；`api/alertmanager.ts` 的 `notifyChannelsApi` 透传（body 已整体传，无需改签名）。

### 5.5 后端渠道 CRUD 绑定校验（`notify/channel.go`）

- 新增/更新渠道时若带 `default_template_id`：校验该模板存在且 `channel_type == 渠道 type`，否则 `bad_request`（中文原因，如「绑定的模板渠道类型与渠道不一致」），前端 `mapErrorToField` 无需新增（走通用错误条即可）。
- `ToChannelView` 在响应中回显 `default_template_id`（非敏感字段，直接展示）。

---

## 6. 兼容性 / 迁移 / 回落语义

- **存量零影响**：既有渠道 `default_template_id=null` → 回落内置默认，行为与现状完全一致；零配置 Happy Path 不破坏。
- **迁移安全**：SQLite `ADD COLUMN nullable` 不锁表、不回填。
- **默认回落语义不变**：`BuiltinTemplateForType` 仍是末级回落；渲染函数 `Render` 不变。
- **多租户**：绑定是 per-channel 属性，MVP 单租户无额外约束；类型校验在服务端强制，不存在越权读模板。

---

## 7. 契约影响（`api-contract-snapshot.md` §11）

- 渠道响应 `NotifyChannel` 增 `default_template_id`（可选，null=内置默认）。
- 渠道创建/更新请求增可选 `default_template_id`。
- 桥渲染选模板口径写入 §11.x：**显式 `?template=` > 渠道 `default_template_id` > 内置默认**；绑定失效优雅回落（不 400）。
- M09 物化 receiver URL 形态补充：`?channel=<ID>[&template=<ID>]`。

---

## 8. 验证计划

- **后端单测**
  - `bridge_test.go`：`TestBridgeUsesChannelBoundTemplate`（绑定存在→用绑定）、`TestBridgeFallsBackToBuiltinWhenUnbound`（未绑→内置）、`TestBridgeFallsBackWhenBoundMissing`（绑定失效→回落内置、不 400）、`TestBridgeTemplateMismatch`（类型不符仍 mismatch）。
  - `notify_receivers_test.go`：`TestMaterializeReceiverEmitsTemplateParam`（绑定→输出 `&template=`）、未绑→仅 `?channel=`。
  - `channel_test.go` / `template` 侧：绑定 type 不符在 CRUD 被拒。
- **前端单测**
  - `NotifyChannelsPage.test.tsx`：渠道表单出现「通知模板」下拉；选择后保存 payload 带 `default_template_id`；双向引流链接存在。
  - `NotifyTemplatesPage.test.tsx`：补充「克隆后到渠道绑定」的引导文案断言。
- **端到端**：`make run-metric-center`（带 `--notify.bridge-token`/`--notify.bridge-url`）+ 启 AM → 新建飞书渠道绑自定义模板 → 触发告警 → 桥日志 `template=<自定义ID>`、卡片按自定义模板渲染。
- **全量门禁**：`go test ./platform/...`、`go vet ./platform/...`、`tsc --noEmit`、`vitest run src/pages/alerts --maxWorkers=2 --minWorkers=1`、`make check-repo-map`。

---

## 9. 回填清单（拍板后实施时同步）

| 层 | 文件 |
|----|------|
| 模型 | `platform/models/alertmanager_notify.go`（加列 + 迁移经 `db.AutoMigrate`） |
| 桥 | `platform/alertmanager/notify/bridge.go`（`resolveBridgeTemplate` 读绑定 + 优雅回落） |
| M09 | `platform/configcenter/generator/notify_receivers.go`（`bridgeReceiverURL` 带绑定 ID） |
| 渠道 CRUD | `platform/alertmanager/notify/channel.go`（绑定校验 + `ToChannelView` 回显） |
| 前端类型/接口 | `ui-custom/web/src/types/alertmanager.ts`、`api/alertmanager.ts` |
| 前端渠道表单 | `ui-custom/web/src/pages/alerts/NotifyChannelDrawer.tsx`（模板下拉 + 回显 + payload） |
| 前端双向引流 | `NotifyChannelDrawer.tsx` + `NotifyTemplatesPage.tsx`（互链文案） |
| 契约 | `docs/05-execution-records/module-08/api-contract-snapshot.md` §11 |
| 测试 | 见 §8 |
| 设计回写 | 用户在 design 分支做 PRD/契约版本化迭代时单向同步（feat 为构思产物载体） |

---

## 10. 遗留待决（P1-P3，待用户拍板）

- **P1 绑定范围**：一个自定义模板可被多个渠道复用（推荐，B 方案天然支持）；是否允许「同类型多模板、渠道二选一」——是，B 已支持。
- **P2 模板删除与绑定清理**：本期模板 append-only 无删除端点，绑定不会悬空；若未来引入删除，须同步清空引用该模板的渠道绑定（null 回落）。列为未来约束。
- **P3 与路由草案 §4.9 的 composability**：§4.9 平台为托管 receiver 注入根兜底 route（默认接收人）；该托管 receiver 的 `template` 参数应取自渠道 `default_template_id`，二者天然组合。第二步/三步的「按级别/标签分流」若引入 route 级模板，另议——不在本期。

---

## 11. 关联文档

- `dev-feedback.md` **#29**（克隆修复，已 landed，本方案前提：能建副本）
- `dev-feedback.md` **#30**（本设计缺口登记，open→本提案落地后 closed）
- `alert-route-frontend-editor.md`（route 前台化草案；§4.9 最小运行骨架与本绑定组合）
- 设计提案 `alert-config-scope-and-notification-bridge.md` §3.3（PL-3 模板/渠道契约源）
- 决策 74（告警配置口径与通知渲染桥，定稿补充第 1/6 条）

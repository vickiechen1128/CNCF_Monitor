# M05 首页内容重构设计说明（决策 72-3 提案）

> **状态**: implemented —— 产品负责人 2026-09-14 确认；前端/后端代码已落地（见 §9 落地记录），待回填 PRD v1.5
> **日期**: 2026-09-14
> **触发**: 产品负责人对 `feat/module-05-homepage-mvp` 首页实现的第二轮设计评审（三点意见）
> **关联**: `dev-feedback.md`（待补留痕）、`design-proposals/homepage-mvp-feedback-design-opinion.md`（第一轮设计意见）、`api-contract-snapshot.md`、`task-sequence.yaml`
> **关联 PRD**: `Module_05_Custom_UI.md` v1.4 §3.1（待回填至 v1.5）
> **角色**: prototype-designer
> **说明**: 本文件为落版设计说明，**不动代码**；代码开发完成后由产品负责人回 `design` 分支批量回填 PRD 与执行记录（见 §7）。

---

## 1. 结论摘要

| # | 议题 | 结论 |
|---|------|------|
| 1 | 「待处理」一词指两个不同状态 | 中文词「待处理」**从首页移除**；Prometheus firing/pending 降为 11px 灰字参考行；AM `unprocessed` 不计数、不进列表（其提示行见 §3.4） |
| 2 | 告警数字与指标卡重复 | 告警维度**全部移出指标卡**；告警状态卡 = 主数字 + 状态分布 + **最新 5 条告警列表**，成为首页唯一告警入口 |
| 3 | 指标卡枚举 | 回到资产/治理进度口径 6 张：资源总数 / 已监控 / 采集 Job / 已纳管网域 / 待确认草稿 / 采集覆盖率 |
| 4 | 「零后端改动」约束 | **放宽**：`dashboard/summary` 新增 3 个计数字段（§4.2） |
| 5 | 指标卡可理解性 | 每张卡**右上角加口径注释**（`ⓘ` Tooltip，中文用户语言，禁止字段名） |
| 6 | 「已监控」口径 | **B —— 被 ≥1 个启用采集 Job 覆盖的资源数**（§3.5；判定条件细化为 `ready + enabled`） |
| 7 | `unprocessed` 附注行 | **保留**「另有 N 条告警仍在计算通知状态」11px 灰字（2026-09-14 产品负责人确认） |
| 8 | 指标卡**卡内**排版 | 6 列网格不变，卡内改「图标在左、数字与标签在右」横向排版 + 收紧内边距（原竖排居中在 6 列窄卡内上下留白过大） |
| 9 | 列表「看更多」 | 告警卡与最近下发记录**标题右侧加「查看全部 →」深链**；**首页不放分页器**（M08 告警接口无分页能力，见 §3.7） |
| 10 | 「最新告警」行排版 | 级别 / 告警名 / 实例名 / 相对时间 / 状态 **单行五列贴边撑满** + 行间细分隔线（原两行靠左、右侧约半宽留白） |
| 11 | 标题区副标题 | 「按下方指引完成首次监控闭环」与紧随其后的指标卡不符 → 改为描述本页视野的中性文案 |

> 落地记录（含 T13-T15 实际实现、本文档的口径细化、以及第二轮评审的 T16 修复）见 §9。

---

## 2. 背景与根因

### 2.1 「待处理」一词指两个完全不同的状态（根源在共享字典）

| 出现位置 | 取值来源 | 含义 | 原文案 |
|---|---|---|---|
| 指标卡「Prometheus 触发」的 hint | `promAlertStateLabel.pending`（`ui-custom/web/src/pages/alerts/alertmanagerConstants.ts:125`） | 规则在求值、尚未达到 `for` 时长，**还没触发** | 待处理 |
| 告警卡并列行 | `notifyStatusLabel.unprocessed`（同文件 `:104`） | 告警**已到 Alertmanager**，但路由 / 静默 / 抑制尚未算完 | 待处理 |

两者同词、异义、同页并列 → 用户无法分辨。

**`unprocessed` 的准确定性**（本轮澄清，避免与「待办」混淆）：
它是 Alertmanager 的**内部计算中间态**，不是等待人工处理、也与工单系统无关。告警被 AM 接收后立刻置为 `unprocessed`，随后 AM 的刷新循环（秒级）完成 inhibit / silence 计算，把它推进为 `active` 或 `suppressed`（再由服务端归一为 `silenced` / `inhibited`，见契约 §10.2）。因此：

- 正常情况下该值**几乎恒为 0**，用户基本看不到；
- 它**不需要任何功能实现**（含工单/指派）就能展示或隐藏；
- 它唯一的信号价值是**健康指标**：若长期 > 0，说明 AM 刷新/求值被卡住（AM 不可达或过载）。

**运维动作对象 = 通知中（`active`）**——已过路由，真的会通知到人。Prometheus firing/pending 属**求值原始数据**，是排障/看门狗视角，不应与治理态等权。

### 2.2 同一份 counts 被画了两遍（结构错位，非样式问题）

- 在决策 72 方案 A「零后端改动」约束下，指标卡 6 张中塞入 3 张告警维卡（`HomePage.tsx:350-372` 的 `notifying` / `silenced` / `prom_firing`）；
- 告警状态卡又渲染同一组数字（`AlertStatusCard.tsx:143-177`）→ 重复。
- 根因：PRD v1.4 §3.1 与 `homepage-mvp-feedback-design-opinion.md` §2.1 的指标卡枚举为 **资源总数 / 已监控 / 采集 Job / 活跃告警 / 网域数量 / 待确认草稿**，实现把「已监控」「采集 Job」换成了告警维卡。告警维卡本应只存在于告警卡内。

---

## 3. 首页内容规范（确认稿）

### 3.1 信息架构（自上而下）

```
标题区（MetricCenter 概览 + 副标题「欢迎回到 MetricCenter，这里汇总监控资源、采集任务与告警的整体运行情况」）
├─ 关键指标卡网格（6 张 · 纯资产与治理进度 · 每张右上角 ⓘ 口径注释）
│    资源总数 / 已监控 / 采集 Job / 已纳管网域 / 待确认草稿 / 采集覆盖率
│    （卡内：图标在左 32px，右侧上为数字 24px/700、下为标签 13px）
├─ 第二行
│   ├─ 左：告警状态卡（首页唯一告警入口）「查看全部 →」/alert-status
│   │     通知中（主数字，红） · 已静默 · 已抑制
│   │     ── 分隔 ──
│   │     最新告警（近 5 条）单行五列：级别 | 告警名 | 实例名 | 相对时间 | 状态
│   │     Prometheus 原始求值 触发中 3 / 求值中 1（11px 灰字 · 仅参考）
│   │     查看告警中心 → / 配置告警通知
│   └─ 右：系统快速入口（5 卡片网格）+ 最近下发记录（近 5 条）「查看全部 →」/deployments
└─ 使用指引 · 六步闭环
```

标题区 / 系统快速入口 / 最近下发记录 / 使用指引六步 **与 v1.4 一致，本次不改**。

### 3.2 关键指标卡区（6 张，不含任何告警数字）

| # | 卡片 | 口径 | 数据来源 | 失败态 |
|---|------|------|----------|--------|
| 1 | 资源总数 | M07 五类资源表行数之和 | `dashboard.resource_count`（已有） | `-` |
| 2 | 已监控 | 见 §3.5 | `dashboard/summary` 新增 `monitored_count` | `-` |
| 3 | 采集 Job | 未软删 ScrapeJob 总数；副行「启用 N」= 其中 `enabled=true` 数 | 新增 `scrape_job_count` / `scrape_job_enabled_count` | `-` |
| 4 | 已纳管网域 | M06 `is_monitored=true` 网域数 | `dashboard.domain_count`（已有） | `-` |
| 5 | 待确认草稿 | M09 `status=pending` 配置草稿数 | `dashboard.pending_draft_count`（已有） | `-` |
| 6 | 采集覆盖率 | `已监控 ÷ 资源总数`，取整百分数；`resource_count=0` 时显示 `-`（不渲染 0%） | 前端派生，无需新字段 | `-` |

**视觉规格**（沿用决策 72-2）：
- 图标 32px、数字 24px / 字重 700、标签 13px `colorTextSecondary`；卡片圆角 8px、卡内边距 `16px 18px`、默认 / hover 阴影按 Token 表。
- **卡内排版：图标在左、数字与标签在右（横向）**。6 列网格下单卡内容区仅约 130px，竖排堆叠会让「图标 ↔ 数字」与「数字 ↔ 标签」间距同为 8px 而失去层级，且卡片上下合计留白约 78px（旧实现 `minHeight: 108` 使卡高 148px、内容仅占 70px）；横向排版在同样宽度内更饱满，数字更突出。
- 颜色：装饰性图标统一品牌青 `#0ECDEB`；**指标卡不再出现红色**（红色语义收敛到告警状态卡）。
- 网格：`Row gutter={[16,16]}`，断点 `xs=24 / sm=12 / lg=8 / xl=4`（**6 列 × 1 行**）。
  - 第一轮设计意见 §2.1 线框曾写「2 × 3 或 3 × 2 网格」，实现按 6 列落地；2026-09-14 产品负责人评审确认**维持 6 列**，仅调整卡内排版（本条第 2 点）。线框该处措辞待 PRD v1.5 回填时统一为 6 列。

**口径注释（右上角 `ⓘ`，Tooltip 文案，中文用户语言）**：

| 卡片 | 注释文案 |
|---|---|
| 资源总数 | 已导入平台的监控资源总数，按主机、数据库、中间件、应用、拨测目标五类合计。 |
| 已监控 | 至少被一个已启用的采集任务覆盖到的资源数。 |
| 采集 Job | 采集任务总数；「启用」为当前正在生效的任务数。 |
| 已纳管网域 | 已纳入平台监控的网域数量。 |
| 待确认草稿 | 已生成配置草稿、但还没人工确认下发的变更数量。 |
| 采集覆盖率 | 已监控资源数 ÷ 资源总数，反映当前纳管进度。 |

实现建议：`MetricItem` 增加 `tip?: string`，卡片右上角绝对定位 `InfoCircleOutlined` + `Tooltip`，仅 `tip` 非空时渲染。

### 3.3 告警状态卡（首页唯一告警入口）

自上而下：

1. 标题「告警状态」。
2. **主数字**：「通知中」+ 计数（28–32px，`token.colorError`）——AM `notify_status === 'active'`。
3. **状态分布**：「已静默」/「已抑制」两个并列小数字（16px）；文案与 Tooltip **复用** `alertmanagerConstants.notifyStatusLabel` / `notifyStatusTip`，禁止在本卡硬编码中文。
4. `unprocessed` 附注行（仅 N > 0 时出现，见 §3.4）。
5. 分隔线。
6. 「最新告警（近 5 条）」列表（见 §3.4）。
6. 底部：11px `colorTextSecondary` 参考行「Prometheus 原始求值 · 触发中 N / 求值中 M」（**仅参考，不作行动对象**）+ 「查看告警中心 →」深链 `/alert-status`（附次级入口「配置告警通知」）。
   - ⚠️ 参考行**不得**出现「待处理」字样：`promAlertStateLabel.pending` 的展示名与 AM `unprocessed` 撞名（§2.1），故本行使用首页本地文案（`PROM_EVAL_LABEL`，pending=「求值中」）。M08 字典的统一改名见 §8.2，本轮不动 M08 契约。

**左侧 3px 语义色条**：六项计数非全 0 时用 `token.colorError`；空态 / 全 0 降为 `token.colorBorder`（保留上一轮修复成果）。

### 3.4 最新告警列表（本次新增）

| 列（用户语言） | 取值 | 规则 |
|---|---|---|
| 级别 | `labels.severity` → 中文 | `error` / `critical` → 严重（红）；`warning` / `warn` → 警告（橙）；`info` → 提示（蓝）；**未命中 → 原值 + 灰**。需新增共享字典 `severityLabel` / `severityColor`（放 `pages/alerts/alertmanagerConstants.ts`） |
| 告警名 | `labels.alertname` | 超长省略（复用 `src/components/EllipsisText.tsx`） |
| 实例名 | `resource_name` | 决策 70 口径；**无 `resource_id` 时显示 `-`，不回落成采集地址** |
| 相对时间 | `starts_at` | 「12 分钟前」；Tooltip 显示绝对时间。**复用既有共享函数** `pages/config-center/configCenterConstants.ts` 的 `formatRelativeTime` / `formatLocalTime`，不引入 `dayjs/plugin/relativeTime` 与全局 locale（避免污染全站 dayjs 语言设置） |
| 状态 | `notify_status` | `notifyStatusLabel` + `notifyStatusColor`；本轮仅展示 `active` / `silenced` / `inhibited` |

**渲染形态**：**单行五列**（用 `List` 而非 `Table`）——级别 / 告警名 / 实例名 / 相对时间 / 状态**同排并左右贴边撑满卡片宽度**，行间加 0.5px 细分隔线（末行不加）。

- **列宽**：级别 44px、实例名 66px、相对时间 62px（右对齐）、状态 48px 均为**固定宽度**（保证多行纵向列位对齐）；**告警名占剩余宽度**，超长省略并悬浮显示全文。
- **宽度核算**：告警卡栅格 `lg={10}`（约 40%），1440 屏下卡内容区约 390px；四列固定宽度合计 220px + 4 处 8px 间距 = 252px，告警名列余约 138px，**无需横向滚动**。
- ⚠️ **已废弃写法**：初稿曾用「紧凑两行」（第一行 级别 Tag + 告警名；第二行 实例名 · 时间 · 状态）。该写法内容整体靠左，右侧约一半宽度留白，且实例名/时间/状态被挤在第二行左侧 —— 2026-09-14 产品负责人评审提出「没有排满整行，空白部分太多」。

- **取数**：复用 `useAlertGovernance` 已持有的**同一次** `alertStatusApi.getAlertmanagerAlerts()` 结果（`items`），按 `starts_at` 倒序取前 5。**不新增任何请求。**
- **条数**：5 条（产品负责人确认）。
- **MVP 裁剪**：`unprocessed` 条目**不进入列表**（其治理闭环 MVP 未实现）。此项须在 `dev-feedback.md` 记 clipping。
- **附注行（`unprocessed` 提示）**：**产品负责人 2026-09-14 确认保留**，一行 11px 灰字，仅在 N > 0 时出现，文案 **「另有 N 条告警仍在计算通知状态」**（Tooltip：告警刚进入通知队列，系统还在计算是否通知、通知给谁）。
  - 理由：`unprocessed` 不计数也不进列表，仅靠此行避免「通知中 0」被误读为「真的没有告警」。成本约 3 行代码，不构建任何治理功能。
  - 命名约束：**不得**使用「待处理」/「初始化中」等会被读作「待办」的词（沿用 §2.1 结论）。
- **空态**：判定条件不变（两条链路均取数成功 且 六项计数全 0）→ `Empty` + 「当前无通知中的告警，去配置通知规则 →」深链 `/alert-config`。

### 3.5 「已监控」口径（确认：B）

- **定义**：被**至少一个**已启用（`enabled=true`）**且已就绪**（`draft_status='ready'`）、未软删的**标准**采集 Job 覆盖到的监控资源数（去重）。
  - 判定条件与 `platform/query/coverage.go` 的 `loadSelectedInstances`（决策 47-3 覆盖率三态中「未监控」的补集）**同源，但首页额外排除 blackbox Job**（见下一条）。⚠️ 二者存在**已知偏差**：`loadSelectedInstances` 未过滤 `job_type`，而 M01 改型为 blackbox 时不清空 `selected_instance_ids`（`strategy/scrapejob/validate.go` blackbox 分支只清 monitor_type / exporter_template_id；前端 blackbox 分支也不提交该字段）→ 残留的 `resource_id` 会被 M07 覆盖率页计为已选中。收敛方案：**不建议首页放弃 `job_type` 过滤**（会把拨测目标计成 M07 资源），需 M07 侧补过滤，已登记为遗留（§9.4）。
- **数据源**：`models.ScrapeJob.SelectedInstanceIDs []string`（`gorm:"serializer:json"`，`platform/models/scrape_job.go:70`），元素为 M07 `resource_id`。
- **实现细则**：
  1. 仅统计 `job_type = standard` 的 Job —— `job_type = blackbox` 的 `blackbox_targets` 是 URL/IP 列表、**不带 `resource_id`**（`platform/models/blackbox_target.go`），不属 M07 资源，不计入；
  2. `selected_instance_ids` 并集去重后，**与五类资源表现存 ID 求交集**再计数（避免资源已软删而覆盖率 >100%，保证 `monitored_count ≤ resource_count`）；
  3. 列是 JSON 序列化，SQLite 无法在 SQL 内聚合去重 → 在 Go 侧全表扫描 + 集合聚合（MVP 数据量可接受；若 Job 规模上升，v0.3 可改落库 `job_resource` 关系表）。
- **分子分母同源**：`resource_count` 同为五类资源表行数之和（`platform/dashboard/summary.go`），故覆盖率口径自洽。
- **不采用**（记录理由）：A 已确认采集实例数（`exporter_installation_confirmations.status=confirmed`）——语义最接近「管子接好了」，但依赖用户逐条确认，覆盖率会长期偏低且口径更重；C Prometheus `up==1` target 数——依赖 Prom 可达（Prom 挂掉即显示 0），留作 v0.3「采集健康度」。

### 3.6 保留的既有语义（上一轮修复成果，不得回归）

| 语义 | 说明 |
|---|---|
| 单次请求 | 指标卡与告警卡共用 `useAlertGovernance`，告警两接口各仅请求 1 次 |
| 错误不静默 | `toSourceState` 把网络异常与业务错误信封统一归一，不把失败静默成 0 |
| 局部降级 | `Promise.allSettled`：单链路失败 warning + 保留另一端成功数据；双链路失败 error + 重试 |
| 站内跳转 | 一律 react-router `Link`，禁止原生 `<a href>` 整页刷新 |
| 空态色条 | 空态 / 全 0 时左色条降为 `token.colorBorder` |

> 指标卡的失败态已简化为统一 `-`：因告警数字已移出指标卡，原按数据源拆分的 `amUnavailable` / `promUnavailable` 逻辑可随之删除。

### 3.7 列表「看更多」与分页口径（第二轮评审补充）

**结论：首页两块列表都不引入分页器，统一用卡片标题右侧「查看全部 →」深链到独立页面。**

| 列表 | 首页展示 | 「查看全部 →」目标 | 目标页 |
|---|---|---|---|
| 最新告警 | 近 5 条 | `/alert-status`（告警状态） | 存在 |
| 最近下发记录 | 近 5 条 | `/deployments`（下发记录） | 存在 |

**为什么不放分页器**：

1. **接口能力不支持**：`GET /api/v2/platform/alertmanager/alerts`（M08）无分页参数，仅有 `network_domain`（`ui-custom/web/src/api/alertmanager.ts` 的 `AlertStatusQuery`）；`GET /api/v1/alerts`（M02 代理）同为全量返回。首页若在卡内翻页，必须给 M08 增加 `page` / `page_size`（后端 + 契约快照改动）。
2. **页面定位**：首页是概览页，分页器属列表页交互；第一轮设计意见 §3.3 已明确「卡片标题左对齐，右侧可放『查看更多』链接」。
3. **承载页已存在**：`/alert-status`、`/deployments` 均已注册（`ui-custom/web/src/App.tsx`），深链零成本、零新增请求。

> ⚠️ **文档缺口留痕**：本项在 PRD v1.4、第一轮设计意见 `homepage-mvp-feedback-design-opinion.md` 与本文件初稿中**均未写明**（`module-05` 全目录 grep「分页 / 查看更多 / 查看全部 / pagination」零命中），前端实现亦未落地（最近下发表格写死 `pagination={false}`、告警列表写死 `slice(0, 5)`）。属**第二轮评审发现的设计缺口**，本文档补记；PRD v1.5 回填时须同步（§7 第 1 项）。
> 另注：M02 `/api/v1/alerts/history`（历史告警）本身**支持** `page` / `page_size`，但首页展示的是「当前告警」而非历史区间，未使用该接口。

**卡片高度与留白（同期评审项）**：告警卡与右侧「快速入口 + 最近下发」等高（`Row` 默认拉伸），当告警条数不足 5 条时卡内会出现下部留白。处理方式是**把底部「Prometheus 参考行 + 深链」用 `margin-top: auto` 贴底**，使留白落在列表与底栏之间而非底栏下方；不采用「取消等高」方案（左右卡片高度不齐更显散乱）。真实数据为 5 条时列表自然填满。

---

## 4. 数据来源与后端改动

### 4.1 现状与缺口

| 卡片 | 现状 | 缺口 |
|---|---|---|
| 资源总数 / 已纳管网域 / 待确认草稿 | `GET /api/v2/platform/dashboard/summary`（`platform/dashboard/summary.go`）已有 | 无 |
| 已监控 / 采集 Job | 无 | **新增 3 个计数字段** |
| 告警数字与最新告警列表 | `GET /api/v1/alerts` + `GET /api/v2/platform/alertmanager/alerts`（只读代理，前端已封装） | 无（复用现有响应） |

### 4.2 后端改动清单

`platform/dashboard/summary.go` —— `Summary` 增加：

```go
MonitoredCount        int `json:"monitored_count"`          // 已监控资源数（口径见 §3.5）
ScrapeJobCount        int `json:"scrape_job_count"`         // 采集 Job 总数（未软删）
ScrapeJobEnabledCount int `json:"scrape_job_enabled_count"` // 采集 Job 中 enabled=true 数
```

- `platform/dashboard/summary_test.go` 增用例：空库返回 0、软删 Job / 资源不计入、`monitored_count ≤ resource_count`；现有 `RecentDeployments` 等既有断言不得破坏。
- 接口**增字段、向后兼容**，既有字段语义不变；契约快照需登记（`module-02` / `module-05` 归属待认领）。
- 前端 `ui-custom/web/src/api/dashboard.ts` 的 `DashboardSummary` 类型与文件头注释同步。
- 计数口径 owner 待认领（`dashboard` 包现由 M05 首页消费、聚合 M06/M07/M01/M09）。

### 4.3 请求数

**不变**：`dashboard/summary` 1 次 + `/api/v1/alerts` 与 `/api/v2/platform/alertmanager/alerts` 并行各 1 次。最新告警列表复用告警接口既有响应，不新增请求。

---

## 5. 明确不做（MVP 裁剪）

| 项 | 原因 |
|---|---|
| 指标卡出现任何告警数字 | 告警表达全部收敛到告警状态卡（§3.3） |
| AM `unprocessed` 计数与列表条目 | 其治理闭环（指派人 / 工单）MVP 未实现，展示无对应动作（§2.1、§3.4） |
| Prometheus firing/pending 进指标卡 | 属求值原始数据、非行动对象，仅保留为参考小字 |
| 告警卡轮询 / 自动刷新 | 与 v1.4 一致（一次性快照） |
| 图表库（ECharts/AntV）与可视化大屏入口 | 决策 72 既有豁免（延至 v0.3） |

---

## 6. 影响与验收

### 6.1 影响范围

| 层 | 文件 | 动作 |
|---|---|---|
| 前端 | `ui-custom/web/src/pages/home/HomePage.tsx` | 指标卡集合改为 6 张资产/进度卡 + 口径注释；删除告警维卡与 `amUnavailable` / `promUnavailable`；告警列表数据下传 |
| 前端 | `ui-custom/web/src/pages/home/AlertStatusCard.tsx` | 移除 `unprocessed` 计数陈列；新增最新告警列表（5 条）与 Prom 参考行；保留全部三态语义 |
| 前端 | `ui-custom/web/src/api/dashboard.ts` + `src/types/…` | `DashboardSummary` 补 3 字段 |
| 前端 | `ui-custom/web/src/pages/alerts/alertmanagerConstants.ts` | 新增 `severityLabel` / `severityColor`（告警级别字典） |
| 前端 | `ui-custom/web/src/pages/config-center/configCenterConstants.ts` | **不改**：直接复用 `formatRelativeTime` / `formatLocalTime` |
| 前端 | `ui-custom/web/src/pages/home/HomePage.test.tsx` | 用例同步 + 新增（见 6.3） |
| 后端 | `platform/dashboard/summary.go`、`summary_test.go` | 新增 3 字段与用例 |
| 文档 | 见 §7 | —— |

### 6.2 验收清单

前端：

- [ ] 指标卡 6 张，**无任何告警数字**；每张右上角 `ⓘ` 可读出 §3.2 注释文案
- [ ] 指标卡**卡内为横向排版**（图标在左、数字与标签在右），卡内无成片留白
- [ ] 副标题描述本页视野，**不出现**「按下方指引」这类与实际内容不符的指代
- [ ] 数据取数失败时该批卡片显示 `-`（不显示 0）
- [ ] 告警状态卡主数字 = AM `active` 计数；并列「已静默」「已抑制」；页面**不出现**「待处理」字样（含底部 Prom 参考行，其 pending 文案为「求值中」）
- [ ] `unprocessed` 不计数、不进列表；仅在 N > 0 时出现一行灰字「另有 N 条告警仍在计算通知状态」
- [ ] 最新告警列表 5 条，**单行五列（级别 / 告警名 / 实例名 / 相对时间 / 状态）左右贴边撑满**，行间有细分隔线，告警名超长省略；`resource_name` 为空显示 `-`
- [ ] 告警卡与最近下发记录**标题右侧各有「查看全部 →」**，分别深链 `/alert-status`、`/deployments`（§3.7）
- [ ] 告警卡底部 11px 灰字参考行与深链**贴卡片底部**（`margin-top: auto`）
- [ ] 底部 11px 灰字参考行展示 Prom 触发中 / 求值中，且视觉权重明显低于主数字
- [ ] 空态仅在双链路成功且六项计数全 0 时出现
- [ ] 单链路失败 warning 局部降级、双链路失败 error + 重试，均保留
- [ ] 六步指引第 5 步 `/alert-config`、第 6 步 `/query` + `/alert-status` 不变

后端：

- [ ] `summary` 新增 3 字段；空库返回 0；软删 Job / 资源不计入；`monitored_count ≤ resource_count`

### 6.3 测试要点

- `HomePage.test.tsx`：6 张指标卡文案与数字、口径注释存在性、告警列表 5 条与 `starts_at` 倒序、`resource_name` 缺失显示 `-`、Prom 参考行、空态、单链路失败、双链路失败、**断言指标卡区域不含告警数字**。
- `platform/dashboard/summary_test.go`：3 个新字段取值与边界（空库、软删、blackbox Job 不计入 `monitored_count`）。
- 命令（本地二进制，禁全量 vitest）：`./node_modules/.bin/tsc --noEmit`、`./node_modules/.bin/eslint src/pages/home src/pages/alerts --ext ts,tsx`、`./node_modules/.bin/vitest run src/pages/home/HomePage.test.tsx --maxWorkers=2 --minWorkers=1`、`make test-platform`。

---

## 7. 回填清单（代码开发完成后，在 `design` 分支执行）

| # | 文件 | 动作 |
|---|------|------|
| 1 | `docs/02-product-requirements/Modules/Module_05_Custom_UI.md` | §3.1 首页指标卡枚举改为资产/进度口径（移除「活跃告警」卡，补「采集覆盖率」）；补「告警状态卡 = 数字 + 最新 5 条告警」「Prom 仅参考小字」「unprocessed 不展示（裁剪）」；**补「两卡标题右侧『查看全部 →』深链、首页不放分页器」（§3.7 文档缺口）**；**补「指标卡 6 列、卡内横向排版」**；**补副标题文案**；§1 首页行与 §6 验收同步；Change Log 记 v1.5 |
| 2 | `docs/05-execution-records/module-05/api-contract-snapshot.md` | 登记 `dashboard/summary` 新增 3 字段；顺带补 `/api/v1/query` 代理登记（上一轮遗留） |
| 3 | `docs/05-execution-records/module-05/design-decisions.md` | 记「决策 72-3：首页内容重构——指标卡回归资产口径 + 告警卡承载最新告警」 |
| 4 | `docs/05-execution-records/module-05/dev-feedback.md` | 补 MEDIUM-2 clipping 留痕（指标卡集合偏离原枚举）+ 本轮 clipping（`unprocessed` 不展示） |
| 5 | `docs/05-execution-records/module-05/frontend-prototype-map.md` | **新建**：首页组件 ↔ PRD 条目映射（含本轮告警卡新增列表） |
| 6 | `docs/05-execution-records/module-05/05_Code_Implementation_Plan.md`、`task-sequence.yaml` | 追加 T13（首页内容重构）/ T14（后端 summary 字段）/ T15（测试与验证） |
| 7 | `docs/prototypes/module-05/` | `DashboardPage` 按本文件更新（版本 1.2.0 → 1.2.1） |

---

## 8. 待确认 / 后续建议

1. **§3.4 附注行**：已确认保留（见 §1 结论摘要 #7、§3.4）——**已闭环**。
2. **跨模块命名建议（不改 M08 契约）**：`alertmanagerConstants.ts` 中 `promAlertStateLabel.pending` 与 `notifyStatusLabel.unprocessed` 同为「待处理」，歧义源仍在共享字典。M08 告警状态页需完整四态，**本轮不改其契约文案**；建议 M08 侧后续把 `pending` 展示名调整为「求值中」，与「待处理」区分。
3. **`frontend-prototype-map.md` 缺失**（module-05）：本文件 §7 第 5 项补建，补齐前一批审查已记的遗留风险。
4. **`dashboard/summary` 计数口径 owner** 未认领：新增 3 字段涉及 M01 / M07 数据，需在回填 PRD 时明确归属。

---

## 9. 落地记录（2026-09-14，T13-T15）

> 本节记录实现侧对本文档的落地结果与**两处口径细化**；PRD 与执行记录的回填仍按 §7 由产品负责人在 `design` 分支执行。

### 9.1 代码落地（分支 `feat/module-05-homepage-mvp`）

| 层 | 文件 | 实现要点 |
|---|---|---|
| 后端 | `platform/dashboard/summary.go` | 新增 `monitored_count` / `scrape_job_count` / `scrape_job_enabled_count`；`resourceModels()` 抽取五类资源表；`loadSelectedResourceIDs()` 聚合 `job_type=standard AND draft_status='ready' AND enabled=true` 的 `selected_instance_ids`，与五类资源表现存 `resource_id` 求交集 |
| 后端 | `platform/dashboard/summary_test.go` | 新增 `seedScrapeJobs`（ready+enabled / draft / disabled / blackbox / 软删 五类 Job）与 `TestSummaryMonitoredCountExcludesDeletedResources`；`TestSummaryHandler` 增 4 项断言、空库用例增 3 项断言 |
| 前端 | `src/api/dashboard.ts` | `DashboardSummary` 补 3 字段（含中文口径注释） |
| 前端 | `src/pages/alerts/alertmanagerConstants.ts` | 新增 `severityLabel()` / `severityColor()`（critical·error→严重 / warning·warn→警告 / info·notice→提示 / 未命中→原值） |
| 前端 | `src/pages/home/HomePage.tsx` | 指标卡改为 6 张资产/进度卡 + `tip` 口径注释（`InfoCircleOutlined` 绝对定位右上角）；`useAlertGovernance` 增 `latestAlerts`（剔除 `unprocessed` → 按 `starts_at` 倒序 → 前 5）；删除告警维指标卡与 `amUnavailable` / `promUnavailable` |
| 前端 | `src/pages/home/AlertStatusCard.tsx` | 主数字（通知中，32px 红）→ 已静默/已抑制（16px）→ `unprocessed` 灰字附注 → 分隔线 → 最新告警（紧凑两行 × 5）→ Prom 参考行（11px，`求值中`）+ 深链 |
| 前端 | `src/pages/home/HomePage.test.tsx` | 18 用例，含「指标卡不含任何告警数字」「悬浮 ⓘ 读出中文口径」「最新 5 条顺序与 `-` 回落」「页面不出现『待处理』」「unprocessed 灰字防误读」「两条告警链路各仅 1 次请求」 |

### 9.2 口径细化（相对 §3.4 / §3.5 的原始表述）

| # | 原文 | 落地细化 | 理由 |
|---|------|----------|------|
| 1 | Prom 参考行「触发中 / **待处理**」 | 改为「触发中 / **求值中**」（首页本地常量 `PROM_EVAL_LABEL`） | §6.2 验收要求页面不出现「待处理」；复用 M08 字典会把歧义词带回首页。M08 字典改名留待 §8.2 |
| 2 | 已监控 = 「`enabled=true` 的 Job 覆盖」 | 收严为 `enabled=true` **且** `draft_status='ready'` | 与 `platform/query/coverage.go` 覆盖率三态的「未监控」判定同源，避免两个页面口径不一致；`draft` 状态的 Job 尚未生效，不应计为已监控 |
| 3 | 相对时间「需新增 `formatRelativeTime`」 | 复用 `configCenterConstants.formatRelativeTime` / `formatLocalTime` | 仓库已有同语义共享函数，避免重复造轮子与引入 dayjs 全局 locale |
| 4 | 「列」渲染 | 改为紧凑两行列表（字段与顺序不变） | 卡片实际宽度为 `lg={10}`，5 列表格会横向滚动 |
| 5 | §3.2 失败态「统一 `-`」 | 收严为**按源降级**：指标卡在请求失败**或字段缺失**时显示 `-`（禁止 `NaN%` / `启用 undefined`）；告警卡在 AM 失败时主数字与状态分布显示 `-`、Prom 失败时参考行显示 `-`，最新告警区显示「取数失败，暂无法展示最新告警」 | 评审 MEDIUM-1/MEDIUM-2：原实现仅覆盖「请求整体失败」，字段缺失会渲染 `NaN%`，且失败源仍渲染 `0` 与决策 68-2「失败必须与恒 0 区分」冲突 |
| 6 | §3.4 级别色 | `severityColor` 返回语义色名 `error` / `warning` / `processing`（而非 `red` / `orange` / `blue`） | 与同文件 `notifyStatusColor` / `silenceStatusColor` 的语义色名约定一致（颜色不变） |
| 7 | §3.4 排序健壮性 | 排序用 `alertTime()`：`starts_at` 缺失或非法计 0（末位），避免 `dayjs(undefined)` 被视作「当前时间」顶到最前 | 评审 LOW-3 |
| 8 | 「与 `coverage.go` 同源」表述 | 修正为「同源 + 首页额外排除 blackbox」（见 §3.5 与 §9.4 遗留） | 评审 MEDIUM-3：原文表述在「两页面口径一致」上不成立 |

### 9.3 验证结果

- 后端：`go test ./platform/...` 全绿（含 `platform/dashboard`）。
- 前端：`tsc --noEmit` ✓、`eslint src/pages/home src/pages/alerts src/api` ✓、`vitest run HomePage.test.tsx` **20 passed**、`vitest run dashboard.test.ts` 2 passed、`vite build` ✓（仅既有 chunk > 500 kB 警告）。
- **变异验证**（证明测试真能拦截）：临时去掉 `summary.go` 的 `job_type = standard` 过滤 → `TestSummaryHandler` 由 `2` 变 `3` 失败（blackbox Job 计入被捕获），已还原。

### 9.4 独立审查与修复（frontend-reviewer，2026-09-14）

审查结论 **APPROVE**（0 CRITICAL / 0 HIGH / 4 MEDIUM / 8 LOW），MEDIUM 与可安全修复的 LOW 已同批修复：

| 级别 | 问题 | 处置 |
|---|---|---|
| MEDIUM-1 | 指标卡「统一 `-`」未覆盖字段缺失 → `NaN%`、`启用 undefined` | 已修（`metricNumber()` 守卫 + 新增用例） |
| MEDIUM-2 | 失败源仍渲染 `0`（AM 挂时「通知中 0」） | 已修（按源降级 `-` + 「取数失败，暂无法展示最新告警」+ 新增用例） |
| MEDIUM-3 | 「与 `coverage.go` 同源」表述不精确，且 M01 改型 blackbox 不清空选区 → 与 M07 覆盖率页存在偏差 | 文档已修正（§3.5）；**代码侧收敛需 M07 补 `job_type` 过滤**，登记为遗留 |
| MEDIUM-4 | 测试缺口：blackbox 断言实际未被覆盖；「指标卡不含告警数字」只断言固定文案 | 已修（blackbox Job 改为选中真实资源 + 断言 6 张卡计数，并做变异验证） |
| LOW-1 | 后端 5×`Count` + 5×`Pluck` 可合并为 5 条 | **未采纳**：保留 `Count()` 以不改动 `resource_count` 既有语义（同表 `resource_id` 为空/重复时的行为差异不值得为 5 次本地查询冒险）；已采纳 `Select("selected_instance_ids")` 避免拉取凭据列 |
| LOW-2/3/4/5/6 | 冗余 `slice()`、排序健壮性、非法时间串、字典兜底、色名一致性 | 已修 |
| LOW-7 | Tooltip 触发元素不可聚焦 | 部分修（指标卡 `ⓘ` 加 `tabIndex` + `aria-label`）；其余沿用仓库既有写法 |

### 9.5 未闭环

- §7 回填清单（PRD v1.5 / 契约快照 / 决策 72-3 / dev-feedback clipping / frontend-prototype-map 新建 / task-sequence / 原型 1.2.1）**待产品负责人执行**；`unprocessed` 不展示属需登记的产品裁剪项。
- **M07 侧遗留**：`platform/query/coverage.go` 的 `loadSelectedInstances` 缺 `job_type='standard'` 过滤，叠加 M01「改型 blackbox 不清空 `selected_instance_ids`」，会使 M07 覆盖率页把残留 `resource_id` 计为已监控 → 与首页「已监控」出现偏差。需 M07 认领后收敛（本轮不改跨模块代码）。
- **M01 侧建议**：改型为 blackbox 时清空 `selected_instance_ids`，从源头消除残留选区（需 M01 认领）。
- `configCenterConstants.formatRelativeTime` 对非法日期回落原串（LOW-4 的根因），跨模块共享件语义建议 M05/M09 共同确认是否统一收敛为 `-`。

---

## 10. 第二轮设计评审修复（T16，2026-09-14）

> **触发**：产品负责人对已落地实现的第二轮评审，四点意见——副标题与内容不符 / 指标卡未按线框排版 / 最新告警行未撑满 / 分页与最近下发入口「无文档、无代码」。

### 10.1 逐条核实与处置

| # | 评审意见 | 核实结论（含证据） | 处置 |
|---|---|---|---|
| 1 | 副标题「按下方指引完成首次监控闭环」与关键指标不符 | 属实：紧接副标题的是 6 张指标卡，六步指引在页尾（`HomePage.tsx` 结构：标题区 → 指标卡 → 第二行 → 使用指引） | 改为「欢迎回到 MetricCenter，这里汇总监控资源、采集任务与告警的整体运行情况」 |
| 2 | 指标卡样式未按线框排版 | 属实：第一轮设计意见 `homepage-mvp-feedback-design-opinion.md` §2.1 线框写「**2 × 3 或 3 × 2** 网格」，实现为 `xl=4`（**6 列 × 1 行**）；1440 屏下卡内容区仅约 130px，竖排三行导致卡高 148px、内容仅占 70px | 产品负责人确认**维持 6 列**；改**卡内横向排版**（图标 32px 在左、数字 24px/700 与标签 13px 在右）；卡内边距 `20px → 16px 18px`；删除 `minHeight: 108` |
| 3 | 最新告警每条未排满整行、空白过多 | 属实：两行布局整体靠左，右侧约半宽留白；实例名/时间/状态挤在第二行左侧 | 改**单行五列贴边撑满** + 行间 0.5px 细分隔线（末行不加）；列宽 级别 44 / 实例名 66 / 时间 62（右对齐）/ 状态 48 固定，告警名弹性 + 超长省略 |
| 4 | 分页与最近下发记录是否有文档记录、前端是否体现 | 属实的**双向缺口**：docs（`module-05` 全目录 + PRD v1.4 + 原型 v1.1）grep「分页 / 查看更多 / 查看全部 / pagination」**零命中**；代码最近下发表格写死 `pagination={false}`、告警列表写死 `slice(0,5)`，**两块列表均无「查看全部」入口** | 补 §3.7 口径（首页**不放分页器**，理由含 M08 接口无分页能力）；两卡标题右侧加「查看全部 →」，分别深链 `/alert-status`、`/deployments` |

**同期附带处理**：告警卡底部「Prometheus 参考行 + 深链」改 `margin-top: auto` 贴底，消除卡片被右侧内容撑高后的下部留白（取舍说明见 §3.7 末段）。

### 10.2 为什么「分页」是设计缺口而非实现遗漏

第一轮设计意见 §3.3 只写了「卡片标题左对齐，右侧可放『查看更多』链接」，未明确两块列表的看更多方式；PRD v1.4 §3.1 亦只写「最近下发记录（5 条）」。实现按字面落地了「5 条」，未推导出「那 6 条以后怎么看」——这是设计规范本身的缺项，已作为 §7 第 1 项的必补条目登记。

### 10.3 代码改动（分支 `feat/module-05-homepage-mvp`）

| 文件 | 改动 |
|---|---|
| `src/pages/home/HomePage.tsx` | 副标题文案；`MetricCard` 改横向排版（`styles.body.padding = '16px 18px'`、图标 32px 左、数字 24/700 + 标签 13px 右、ⓘ 绝对定位右上）；最近下发卡 `extra` 加「查看全部 → `/deployments`」；新增 `Link` 导入 |
| `src/pages/home/AlertStatusCard.tsx` | `LatestAlertRow` 改单行五列（`Typography.Text ellipsis={{ tooltip }}` 处理超长告警名，替换原 `EllipsisText` 固定 `maxWidth` 写法；新增 `isLast` 控制末行无分隔线）；卡片 `extra` 加「查看全部 → `/alert-status`」；`styles.body` 改纵向 flex + 底部区块 `margin-top: auto` |
| `src/pages/home/HomePage.test.tsx` | 副标题断言更新；**新增 2 用例**：「两卡标题右侧『查看全部 →』深链正确」「最新告警为单行五列结构（flex 行容器 + 恰 5 个直接子元素）」 |

### 10.4 验证结果

- `tsc --noEmit` ✓；`eslint src/pages/home` ✓
- `vitest run src/pages/home/HomePage.test.tsx --maxWorkers=2 --minWorkers=1` → **22 passed**（原 20 + 新增 2）
- `vite build` ✓（仅既有 chunk > 500 kB 警告）
- `scripts/check-repo-map.sh` → `OK: repo-map 与当前业务代码一致`（本轮无新增 Go 符号，无需刷新）
- 静态预览（`VITE_STATIC_PREVIEW=true`，1440×1000）截图复核：四项改动均已在渲染中生效

### 10.5 未闭环（第二轮新增）

- §7 第 1 项回填内容增加：PRD v1.5 须补「两卡『查看全部 →』深链 + 首页不放分页器」与「指标卡 6 列 / 卡内横向排版」两处规范 —— 否则下一模块复用首页模式时会再次缺失。
- 告警卡在告警条数少于 5 条时仍有下部留白（等高的必然结果，已用底栏贴底缓解）；若产品要求完全无留白，需改为「取消左右等高」，属后续可选优化。
- 静态预览 mock（`ALERT_MOCK_LATEST` 仅 2 条）与真实 5 条场景的视觉密度差异未做截图对照；5 条场景由 `HomePage.test.tsx` 的「latest 5 alerts」用例覆盖（断言 `latest-alert-4` 存在、`latest-alert-5` 不存在），列位置由固定列宽保证不会破位。

---

## 11. 第三轮内容反馈修复（T17，2026-09-14）

> **触发**：产品负责人第三轮评审，三点意见——最新告警无表头（看不出列义）/ 只留 5 条导致卡高偏矮、下方留白 / 「查看告警中心」与「查看全部」功能重复。

### 11.1 逐条核实与处置

| # | 评审意见 | 核实结论（含证据） | 处置 |
|---|---|---|---|
| 1 | 最新告警没有表头，不知道每列具体是什么 | 属实：`LatestAlertRow` 只渲染数据行，列义靠胶囊文案（`severityLabel` / `notifyStatusLabel`）反向推断；「状态」尤其易与同卡底部的 Prometheus 求值态混淆 | 新增 `LatestAlertHeader`（级别 / 告警名 / 实例名 / 时间 / 状态）；列宽与数据行**共用 `ALERT_COL_WIDTH` 常量**（各写一份会列位错开，形同没有表头）；「状态」列加 tooltip 消歧 |
| 2 | 只保留 5 条，高度太窄、下面留空太多；建议改近 10 条，或调整右侧版面高度 | 属实：`LATEST_ALERT_LIMIT = 5`，单行约 34px → 列表区约 170px，左列比右列矮约 170px | 采**近 10 条**；同时给该行 `<Row>` 加 `align="stretch"` 兜底：条数少时左卡跟随右列高度，由卡内 `margin-top:auto` 把参考行贴底 |
| 3 | 告警已有「查看全部」，底部「查看告警中心」重复 | 属实：标题 `extra` 的「查看全部 →」与底部「查看告警中心 →」**均指向 `/alert-status`** | 删除底部「查看告警中心 →」，保留标题「查看全部 →」；底部仅留「配置告警通知 → `/alert-config`」 |

### 11.2 为什么选「近 10 条」而不是「压低右侧版面」

按 1440 宽、右列 `lg=14` 粗算：左卡 ≈ 卡头+内边距 95 + 主数字 60 + 分布行 56 + 分隔线 25 + 小标题 22 + 表头 22 + 行 34×N + 底栏 58；右列 = 快捷入口（5 项 → 3+2 两行瓦片 ≈ 371）+ 间距 16 + 最近下发（表头 + 5 行 ≈ 285）≈ **672**。取 N=10 时左卡 ≈ 675，两列自然齐平——即「近 10 条」本身已是版面解法，且比压缩右侧内容少改一处组件、不牺牲右列信息。

`align="stretch"` 是条数不足时的通用兜底（如仅 2 条），因此 §10.5 第 3 项「少于 5 条仍有下部留白」随之闭环。

### 11.3 代码改动（分支 `feat/module-05-homepage-mvp`）

| 文件 | 改动 |
|---|---|
| `src/pages/home/AlertStatusCard.tsx` | 新增 `export const LATEST_ALERT_LIMIT = 10`（标题与取数共用一份，避免两处数字漂移）、`ALERT_COL_WIDTH`（列宽单一来源）、`LatestAlertHeader`；数据行改用 `ALERT_COL_WIDTH`；删除底部「查看告警中心 →」，未再使用的 `Space` 导入一并移除 |
| `src/pages/home/HomePage.tsx` | 删除本地 `LATEST_ALERT_LIMIT`，改从 `AlertStatusCard` 导入；第二行 `<Row>` 加 `align="stretch"`；静态预览 mock 由 2 条扩到 10 条（便于在预览中校验行高与表头对齐） |
| `src/pages/home/HomePage.test.tsx` | 用例名与标题断言改「近 10 条」；新增表头 5 列断言；「查看告警中心 →」改为**断言不存在**；**新增 1 用例**「12 条告警只渲染 10 行」 |

### 11.4 验证结果

- `tsc --noEmit` ✓；`eslint src/pages/home` ✓
- `vitest run src/pages/home/HomePage.test.tsx --maxWorkers=2 --minWorkers=1` → **23 passed**（原 22 + 新增 1）
- `vite build` ✓（仅既有 chunk > 500 kB 警告）
- `make repo-map` 后 `scripts/check-repo-map.sh` → `OK`（新增导出常量 `LATEST_ALERT_LIMIT` 改动符号清单，本轮必须刷新；否则 pre-commit 门禁阻断）
- 预览服务已热更新（`curl :5199/src/pages/home/AlertStatusCard.tsx` 可见 `latest-alert-header`）

### 11.5 未闭环（第三轮）

- 三处新规范需回填 PRD v1.5（并入 §7 第 1 项清单）：告警列表**近 10 条 + 表头列序**（级别 / 告警名 / 实例名 / 时间 / 状态）、告警中心入口**只保留标题右侧「查看全部 →」**（卡内不重复）、左右两列**等高**。
- 「最近下发记录」表复用 `DEPLOYMENT_COLUMNS` 自带表头，本轮未改；其首页列宽与 `/deployments` 是否一致未做对照。
- 表头列宽为固定像素（实例名 66 / 时间 62 / 状态 48），窄屏（<992px 单列堆叠）下不换行；移动端是否需响应式列宽未做设计确认。

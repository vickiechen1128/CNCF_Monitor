# M05 首屏版式精修 + 反馈 11 遗留裁定结案

> **状态**: approved —— 产品负责人 2026-10-17 两轮拍板：**首轮**（§2.3 告警卡两栏化不视为偏离、§2.7 拨测保留异常短名单）；**同日第五~七轮走查后**告警卡改为与 04 对分、拨测短名单下架并改「正常率圆环 + 两分区计数」。正文已按最终落地形态回填（各节「裁定演变」留痕），并新增 §2.8 / §7。
> **日期**: 2026-10-17（初版 00:55；最终形态回填 14:00，代码已落地）
> **触发**: `dev-feedback.md` 反馈 11 §11.8.4「仍待裁定（本轮未擅自改动）」5 项 + 产品负责人 2026-10-17 追加的样式与拨测简化议题
> **关联**: `dev-feedback.md` §11（反馈 11 全文）与 **§11.9（第五~七轮走查落地记录，本文件的变更来源）**、`design-proposals/homepage-mvp-content-restructure.md`（**v1，§3 首页内容规范部分失效，见 §1.2**）、`design-proposals/probe-ownership-alignment.md`（拨测归属口径）、`api-contract-snapshot.md`
> **关联 PRD**: `docs/02-product-requirements/Modules/Module_05_Custom_UI.md` v1.8（受冻结门禁，回填见 §6）
> **角色**: prototype-designer（口径）→ backend-developer / frontend-developer（实现）
> **说明**: 本文件为落版设计说明，**已按落地代码回填**；PRD 与执行记录的版本化回填仍由 prototype-designer 在 `design/module-mvp-demo` 执行（§6）。

---

## 1. 结论摘要

### 1.1 裁定总表

| # | 议题 | 裁定 | 性质 | 后端 | 前端 |
|---|---|---|---|---|---|
| 1 | 云卡深链失效 | **补齐前端 `cloud` 客户端过滤**，不退化为无参跳转 | 前端 | 零改 | 改 |
| 2 | Top 4 +「其他」收敛规则 | **升为正式产品口径**（PRD 回填落版） | 文档 | 零改 | 零改 |
| 3 | 告警卡形态 | 位置**不再独立整宽**：第五~六轮改为**与 04 段对分一行**（1:1），内部保留「左统计块（220px 纵排）/ 右列表」两栏 | 前端 | 零改 | 改 |
| 4 | 应用覆盖明细表 | **删除**（契约字段保留） | 前端 | 零改 | 改 |
| 5 | `summary.go`「五类」陈旧注释 | **订正 3 处**（原报 2 处，核对发现第 3 处） | 后端 | 改注释 | 零改 |
| 6 | 04 段纳管率不醒目 | 初版「32px 大数字 + 8px 进度条」→ 第五轮改为 **百分比圆环 + 六行资源类型表**（§2.6） | 前端 | 零改 | 改 |
| 7 | 拨测态势面板 | 初版「2 子面板计数 + 异常短名单 ≤3」→ 第六轮改为 **单卡 + 正常率圆环 + 2 子分区计数**，短名单与汇总行下架（§2.7） | 前端 | 零改 | 改 |
| 8 | 02/03 走查微调 | 02 收窄 260px + 标题口径进 Tooltip + 新增合计行；03 末列末行统一「合计」+ 脚注合并；02+03 整组可隐藏（§2.8） | 前端 | 零改 | 改 |
| 9 | 字号 / 字重散点 | **收敛为 6 级阶梯**：hero 24 / primary 20 / title 16 / label 13 / body 12 / note 11；数字一律 600、700 仅「合计」（§7.1） | 前端 | 零改 | 改 |
| 10 | 手机端 04 表末列被裁 | **窄屏 `alignItems` 缺陷修复** + 列宽合计 300 + 卡内边距 12（§7.2） | 前端 | 零改 | 改 |
| ★A | `ProbePanel` 深链 `/strategy` 死链 | **必修**，改指 `/scrape-jobs` | 前端 | 零改 | 改 |
| ★B | M07 约 15 处「五类」陈注释 | 开**后续票**，本轮不动 | 文档 | 不动 | 不动 |

### 1.2 与 v1 提案的关系（`homepage-mvp-content-restructure.md`）

v1（2026-09-14，决策 72-3）的 **§3.1 信息架构、§3.2 关键指标卡区已被反馈 11 整块推翻**（L0 六张指标卡删除、新增 03 矩阵、告警卡位置变更），**不再作为首页版式依据**；v1 的 §3.3~§3.7（告警卡内部口径、最新告警列表、已监控口径、单次请求 / 局部降级、不分页）**继续有效**，本轮 §2.3 的两栏化仅调整告警卡**内部布局**，不触碰这些口径。

本文件是 v1 之后的首屏权威版式口径；v1 正文保留不改写（其 §7 回填清单、§8.3 仍被 `task-sequence.yaml` / `frontend-prototype-map.md` / `dev-feedback.md` 引用）。

**本文件内部也有一次演化（2026-10-17 同日）**：§2.3 / §2.6 / §2.7 的初版形态（告警卡独立整宽、04 段「大数字块 + 进度条」、拨测卡「计数 + 异常短名单」）在当天第五~七轮走查中被逐条推翻。**正文现已是最终落地形态，旧形态只在各节「裁定演变」里用一句话留痕**——不保留旧线框图与旧细则，避免后续开发把作废口径当成依据。变更来源与逐轮记录见 `dev-feedback.md` §11.9。

### 1.3 本轮红线（任一不成立即视为实现错误）

| # | 红线 | 出处 |
|---|---|---|
| R1 | 取数失败**不静默成 0、不回落静态样例**（真库 `by_cloud` 缺失 → 空态「暂无主机数据」） | 决策 68-2 / 反馈 11 §11.8.3 |
| R2 | `sum(行 host_count) == sum(列 host_count) == by_category[host].resource_count` | 反馈 11 §11.4 不变量 1 |
| R3 | `by_platform_app` 缺失 / 空 → **不可用态**，绝不渲染全 0 矩阵 | 反馈 11 §11.4 不变量 4 |
| R4 | 首页整体纳管率**唯一**呈现点为 04 段（圆环 + 六行表）；按云维度不呈现纳管率 | 反馈 11 §11.2 ⑤ / §11.5 / 本文件 §2.6 |
| R5 | 云卡口径**仅主机**（不含数据库 / 中间件 / 应用 / 拨测目标） | 反馈 11 §11.2 ② |
| R6 | 告警卡：5 行/页（`ALERT_PAGE_SIZE`）与视口解耦、数据池 8 条（`LATEST_ALERT_LIMIT`）、页面**不出现「待处理」字样** | `homeLayout.ts` / 决策 72-3 |
| R7 | 拨测 `status` 空串 = 未知（中性色），**不臆造** up/down；拨测目标不进 `resource_count` | 决策 93 |
| R8 | 手机端（≤767px）首页**零横向滚动**：04 表列宽合计 ≤ 300px 且容器必须 `alignItems: stretch`；03 矩阵保留自身横滚（二维可比性优先） | 本文件 §7.2 |
| R9 | 字号只允许 6 级（24/20/16/13/12/11），数字字重**一律 600**，700 仅「合计」 | 本文件 §7.1 |

---

## 2. 逐项裁定与实现口径

### 2.1 云卡深链：前端补 `cloud` 客户端过滤（后端零改）

**现状求证**（2026-10-17 核对）：

| 事实 | 位置 |
|---|---|
| 云名链接指向 `/resources?cloud=<cloud_code>` | `CloudDistributionPanel.tsx:40` |
| 资源页只解析 `resource_category` / `subtype` / `app_code`，`import=1` 开导入弹窗 | `ResourcesPage.tsx:242-245`、`:314` |
| `subtype` / `app_code` 深链为**客户端当页过滤**（非服务端） | `ResourcesPage.tsx:294-303`（`visibleList`） |
| 后端 `ParseListFilter` 无 `cloud` 参数 | `platform/config/resource/query.go:60-71` |
| ⚠️ **列表 item 已带回 `cloud_code`**（决策 103 scheme-B：网域派生，五类均有） | `platform/config/resource/list.go:139`；前端类型 `useResources.ts:37` |
| FilterBar 无「云」筛选器（只有网域 / 平台 / 应用 / 业务 / 运行状态 / 采集状态 / 搜索） | `ResourcesPage.tsx:1076-1186` |

**裁定**：补前端 `cloud` 过滤链，**不**改后端契约。

**为什么不做「退化成无参跳转」**：无参跳转后，用户落在无筛选的资源列表，而 FilterBar 没有云筛选器可自助复现 —— 可点击但无真实动作，与 `PlatformAppMatrixPanel.tsx:121-124` 注释「不支持的维度只展示不做链接（避免点了跳过去却没按平台筛的假动作）」同源冲突，也违反 §11.2 ②「云名点击仍深链」的既有裁定。

**实现口径**：

1. 解析 `const deepLinkCloud = searchParams.get('cloud')`，纳入 `hasDeepLinkFilter`；
2. 默认 Tab 落 `host`（云卡口径仅主机，R5）：`useResources(deepLinkInitialCategory ?? 'host')`；
3. `visibleList` 追加 `if (deepLinkCloud) list = list.filter((r) => (r.cloud_code ?? '') === deepLinkCloud)`；
4. 纳入既有下钻提示条（`ResourcesPage.tsx:1302-1322`，`data-testid="deep-link-hint"`）：文案「已按首页下钻条件预筛选：云 {cloud_name}（{cloud_code}）（共 N 条）」；云名经 `cloudDicts` 解析（缺条目回落 `cloud_code`，复用 `:423-431` 既有解析函数）；一键清除沿用 `setSearchParams({})`；
5. **显式披露当页限制**：参照 `monitorState` 的 Alert（`:1268-1286`），在下钻提示条内注明「该条件为前端过滤，仅作用于当前页；分页总数为未按此条件过滤的总数」；
6. **「未指定云」卡（`cloud_code === ""`）不做链接** —— 空参与无参不可区分，与矩阵「未指定平台 / 其他」行不可下钻（`PlatformAppMatrixPanel.tsx:50-53`）同口径；该卡云名保留 hover 提示说明为何不可点。

**影响**：`ResourcesPage.tsx`、`CloudDistributionPanel.tsx`、`ResourcesPage.test.tsx`（新增 2~3 用例：带参与不带参、`未指定云` 卡无链接）。

### 2.2 Top 4 +「其他」：升为正式产品口径

**现状**：后端已实现且行为确定（`platform/dashboard/summary.go:30-37` 常量、`:680-745` `buildPlatformAppSummary`），前端已按此渲染（`PlatformAppMatrixPanel.tsx`，`OTHER_PLATFORM_CODE = '__other__'`）。当前状态是「实现选择」，未经产品落版。

**裁定**：**升为正式产品口径**，随 PRD 回填落版（§6 第 1 项）。

**升正的理据**：① 已是事实行为，不落版则契约长期停在灰色状态；② 它是**纯呈现粒度规则**，R2 不变量不被收敛破坏（`:682-687` 自证「收敛只改呈现粒度，不改合计」）；③ 「其他」行不可下钻是需要产品授权的口径，不落版用户会质疑。

**落版细则（照抄实现，PRD 回填须逐条写入）**：

| # | 规则 | 位置 |
|---|---|---|
| a | 非空平台按主机台数降序取前 `platformAppTopPlatforms = 4` 个单独成行 | `summary.go:728-735` |
| b | 计数**并列时按 `platform_code` 字典序升序**（保证输出确定性） | `summary.go:719-724` |
| c | 落选平台合并进 `__other__`；**「其他」行仅在有落选平台时渲染**（空则不出现） | `summary.go:737-739` |
| d | 「未指定平台」（`platform_code = ""`）**恒单独末行、不占 Top N 名额** | `summary.go:740-743` |
| e | 输出序固定：Top N → 其他 → 未指定平台（不按台数全局重排） | `summary.go:691-692` |
| f | 「其他」行与「未指定平台」行**不可下钻**，带角标（聚合 / 待补录） | `PlatformAppMatrixPanel.tsx:120-133` |

### 2.3 告警卡：与 04 段对分一行，内部两栏不变

**裁定演变**：

- 初版（本节原文）：位置「04 之下独立整宽」不变，内部改两栏（左统计 / 右列表）；
- **第五~六轮走查（产品负责人裁定，最终）**：告警卡**不再独立整宽**，与 04 段**按 1:1 对分同一行**（`home-coverage-alert-row`，两列均 `flex: 1 1 460px`、`align-items: stretch` 等高）；统计块由 280px 收到 **220px**、四格**纵排**并 `flex: 1` 分摊卡高；Prometheus 求值参考行从右栏页脚**上移**至统计块底部（`margin-top: auto` 沉底），填掉四格下方空挡；「配置告警通知」深链**删除**（通知配置入口收敛到告警状态页与使用指引）。
- 动因：04 段改「圆环 + 六行表」后本身变矮，告警若继续独占整宽会把首屏拉长；对分后两卡等高、首屏信息密度提升，且「告警状态」与「纳管完成率」首屏并置，正是领导一眼要看的两个结论。

**最终形态**（`AlertStatusCard.tsx`）：

```
┌─ 告警状态（与 04 段对分，@1440 约 588px 宽）──────────────────┐
│ 左统计块 220px（四格纵排）    │ 右栏 flex:1                   │
│ 当日告警              12      │ 最新告警          查看全部 →   │
│ 近 7 天告警           38      │ ─ 紧急 主机CPU过高 5分钟前 通知中│
│ 通知中                 2（红）│   prod-web-01 · CPU 92%…      │
│ 已静默 · 已抑制      1 · 0    │ …（5 行/页，分页器超出才出现） │
│ 告警规则 · 已触发 5 · 观察中 1 │                               │
└───────────────────────────────────────────────────────────────┘
```

**必须保留的既有口径（R6 + v1 §3.3/§3.4，不得因改版回归）**：

- 四格语义与取值：当日 / 近 7 天（M02 history，前端计数）、通知中（AM `active`）、已静默 · 已抑制（合并一格 `'x · y'`）；**数字与 Tooltip 口径文案一字不改**；
- 降级：`historyError` → 当日 / 近 7 天显示 `'-'`；`amError` → 治理态两格显示 `'-'`（不静默成 0）；
- `LATEST_ALERT_LIMIT = 8` 数据池、`ALERT_PAGE_SIZE = 5` 分页（`computeAlertPageSize`）、与视口解耦；
- 行制：级别 Tag + 告警名（行 1）/ 实例名 · 告警具体内容（行 2）；`resource_name` 空 → `'-'`；
- `unprocessed` 不计数、不进列表；仅 N > 0 时一行灰字「另有 N 条告警仍在计算通知状态」；
- **不出现「待处理」字样**（`PROM_EVAL_LABEL.pending = '求值中'`）；
- 空态判定（双链路成功且八项计数全 0 + history 可用）与 `showEmptyGuide` 逻辑不变；
- 窄屏（≤767px）：统计条维持 **2×2**，与右栏**上下堆叠**（不横向并排）。

**第六轮走查新增（文案与视觉）**：

| 项 | 处理 |
|---|---|
| 「最新告警（近 8 条）」 | 标题去掉「近 8 条」——上限是内部实现，带条数与「没有告警」自相矛盾 |
| 无待处理告警的空态 | 由 12px 灰字改为**成功色提示块**：`CheckCircleFilled` + `colorSuccessBg` + `colorSuccessBorder`，标题「当前没有需要处理的告警」16/600。原灰字在扫读时会被当成「没加载出来」 |
| 数字规格 | 四格 **20/600**（原 24/700）、格标签 13/500、两处注释 11px（`unprocessed` 提示、Prom 参考行）。原 24px 让首页出现 6 个同尺寸大数字（2 环 + 4 格），与圆环抢层级（见 §7.1） |

**影响**：`AlertStatusCard.tsx`（`AlertStatStrip` 纵排变体 + 卡体两栏容器，横向变体保留给窄屏）、`HomePage.tsx`（`home-coverage-alert-row` 对分容器）、`HomePage.test.tsx`。

### 2.4 应用覆盖明细表：删除

**裁定**：**删除**。03 矩阵已承载平台 × 应用的主机分布，「未指定应用」列覆盖补录诉求；按应用维度的纳管率属运营视角，与反馈 11「首屏不堆数字 / 领导视角」方向不一致。

**实现口径**：

- 删除 `AppDetailTable.tsx` 组件文件、`HomePage.tsx` 的 `import` 与 `<div id="app-detail">…</div>` 区块（当前 `:807-816`）；
- `HomePage.tsx` 头注释 §结构段落中「应用覆盖明细表」一行同步删除；
- **后端零改、契约零改**：`by_app` / `unclassified_resource_count` / `unclassified_monitored_count` 字段保留（`api-contract-snapshot.md` 不动），仅前端不再消费；`DASHBOARD_MOCK.by_app` 保留以维持契约完整性；
- 测试：`HomePage.test.tsx` 移除 `l2-app-*` 全部断言与「应用覆盖明细表在采集健康之后」的顺序断言（§11.8.4 该行同步改为「已裁决：删除」）；
- **遗留补偿**：首页失去「未归类应用 → 去补填」入口，该补录动线由 03 矩阵「未指定平台（待补录）/ 未指定应用」列 + 资源页承担，需在 03 矩阵脚注（现 `pam-footnote`）补一句指向资源页的补录引导。

### 2.5 `summary.go` 陈旧注释：订正 3 处

| # | 位置 | 现状 | 订正为 |
|---|---|---|---|
| 1 | `summary.go:136` | `// 按资源类型分组，5 类固定齐全（缺则补 0 值条目）` | `6 类` |
| 2 | `summary.go:593` | `// 8. 组装 by_category：五类固定齐全（缺则补 0 值条目）。` | `六类` |
| 3 | `summary.go:228` | `// host/database/middleware/application/generic_target` | 补 `interface_service` |

第 3 处为本次核对**新发现**（产品负责人原报 2 处）。自证依据：`resourceModels()`（`:58-67`）已是 6 项；`models_test.go:168` 断言 `Len(ValidResourceCategories(), 6)`。

**性质**：纯注释、零行为改动。**时机**：该文件已有本分支未提交改动（反馈 11 落地），折叠进同批提交，不新增冲突面。

**后续票（本轮不动）**：M07 侧同款陈注释约 15 处，代码逻辑已支持 6 类但注释仍写「五类」—— `platform/config/resource/query.go`（L36/45/80/107/108/127）、`list.go`（L2/17/129/202）、`update.go`（L2/17/68）、`config/label/instances.go`（L80/111）、`config/label/list.go`（L120）、`cmd/metric-center/main_test.go`（L295/501/512）。

### 2.6 04 段：百分比圆环 + 六行资源类型表（唯一纳管率呈现点）

**裁定演变**：

- 初版（本节原文）：头部改「32px 大数字 + 8px 宽进度条」（解决「这行太窄、不醒目」）；
- **第五轮走查（产品负责人裁定，最终）**：改为**左侧百分比圆环 + 右侧六行表格**。三条理由：① 圆环比进度条更省纵向高度；② 六类本是同一整体的六个部分，与整体圆环构成「一个整体 + 六个明细」的共同读法——原六张类型卡与区块头部大数字**平级排布**，产品负责人原话「看不出是一个共同的关系」；③ 32px 大数字与告警卡四格数字抢层级（§7.1 进一步收到 24px 且仅圆环使用）。

**最终形态**：

```
┌─ 监控对象纳管完成率 ⓘ                      查看采集任务 → ┐
│   ╭────╮   资源类型   已配置采集  总数  纳管率  未配置采集  │
│  │ 84%  │   主机          36       42    86%       6      │
│   ╰────╯   数据库         2        2   100%       0      │
│  整体纳管完成率  中间件    0        2     0%       2      │
│  已配置 96 / 共 128  应用服务 1     1   100%       0      │
│                      接口服务 1     1   100%       0      │
│                      其他监控目标  -   -     -       -    │
│ 按「已配置采集任务的资源数 ÷ 资源总数」计算，只反映配置进度，  │
│ 不代表数据已采到；实际采集情况见下方「采集健康」。          │
└────────────────────────────────────────────────────────────┘
```

| 项 | 口径 |
|---|---|
| 圆环 | `CoverageDonut`：几何取自 `homeDonut.ts`（120×120 / r=47 / stroke=11），心字号 24·600；`percent` 缺失 → 圆心 `-`、只留轨道，**绝不渲染 0%**（决策 68-2）；弧恒 `colorPrimary`——整体口径只报数、不预警 |
| 圆心下两行 | 「整体纳管完成率」+「已配置 N / 共 M」，均 12px 次色 |
| 表列 | 资源类型（22px 单字徽标 + 名称；桌面 124 / 窄屏 92）、已配置采集（86/54）、总数（68/46）、纳管率（64/54）、未配置采集（86/54） |
| 纳管率列 | 只给百分数——**行内进度条已去除**（与百分数信息重复、且占掉半列宽，整体比例已由左侧圆环承担）；< 70% 百分数转 `colorWarning`（颜色不是唯一语义，数字本身可读） |
| 未登记类目 | `resource_count = 0` → 各计数列显示 **`-`**。`0` 是「登记了但没配置采集」的有效计量值，`-` 是「压根没有这类对象」，两者不可混用 |
| 单位 | 「已配置采集」列**不带「台」**（表头已说明是采集配置），与右侧纯数字列对齐 |
| 口径正名 | 「已下发 / 未下发」→ **「已配置采集 / 未配置采集」**（产品负责人：「已下发」说不清是下发什么） |
| 卡头深链 | 「查看采集任务 →」→ `/scrape-jobs?job_type=standard`（预筛采集类 Job，与拨测 Job 分开）；`useScrapeJobs` 增 `initialFilters` 入参，页面读 `job_type` URL 参数 |
| 卡底脚注 | 「按『已配置采集任务的资源数 ÷ 资源总数』计算……」11px、左对齐、贴卡底（旧版在圆环下挤成 5 行小字，产品负责人要求移出） |
| 角标 | Tooltip **只讲边界**（按资源条数计、同一资源多实例只算一条、拨测目标不计入、分母含未配置采集的资源）——计算式与「与采集健康的分工」由卡底脚注一句话说完，两处不重复 |
| 窄屏 | 圆环与表格**纵排**：`coverage-body` 必须 `alignItems: stretch` + 圆环块 `alignSelf: center`（见 §7.2）；列宽合计 300，零横向滚动 |

**影响**：`HomePage.tsx`、`CoverageDonut.tsx`（新增）、`ResourceTypeGrid.tsx`（六卡 → 表格）、`homeDonut.ts`（新增）、`HomePage.test.tsx`。

### 2.7 拨测态势：单卡「正常率圆环 + 两个子分区计数」

**裁定演变**：

- 初版（本节原文）：2 子面板计数总览 + **异常短名单（≤3）** + 深链，明细表与分页移除；
- **第六轮走查（产品负责人裁定，最终）**：**异常短名单下架**——原话「异常的详细值不用在首页展示，可以去 M09 的采集对象监控那边查询，深链可以做进去，自动筛选好拨测类型」；区头汇总行「拨测目标 N · 正常 X · 异常 Y · 未知 Z」一并移除；新增**正常率圆环**（整体健康度）仿 04 纳管圆环，形成「一个整体 + 两个分区明细」；区头与两个子版面**合为一张卡**（旧版区头是卡外一行、两子版面各套一层卡，视觉上是三块，产品负责人要求「样式上要做在一起」）。

**最终形态**（`ProbePanel.tsx`）：

```
┌─ 拨测态势                                查看异常拨测目标 → ┐
│  ╭────╮  ┌ 接口服务拨测 ──────────┐ ┌ 应用服务拨测 ────────┐│
│ │ 50%  │  │ 对外 API 的可用性…（hint）│ │ 应用健康检查地址…   ││
│  ╰────╯  │   2      1     0     1   │ │   0    0    0    0  ││
│  正常率   │ 拨测目标 正常 异常 未知   │ │ 拨测目标 正常 异常 未知││
│ 正常1/共2 │ 查看接口服务采集对象 →   │ │ 查看应用服务采集对象 →││
└──────────────────────────────────────────────────────────────┘
```

| 项 | 口径 |
|---|---|
| 圆环 | `ProbeHealthDonut`：**与 04 圆环同几何、同心字号**（`homeDonut.ts` 唯一定义）；100% → `colorSuccess`（全部正常）、其余 `colorPrimary`（报数）、无拨测目标 → 中性灰 + 圆心 `-`（不把「没有数据」表达成「健康度零」）；环下「正常率」+「正常 N / 共 M」 |
| 子分区 | 2 个浅底圆角块（`colorFillQuaternary`，非卡中卡），标题 16/600 + 一句 hint（12px，不暴露字段名）；空分区照常渲染（计数全 0），避免另一半版面空缺 |
| 分区计数 | 每区 **2×2** 四格：拨测目标 / 正常 / 异常 / 未知；数值 16/600、标签 12px；异常 > 0 转 `colorErrorText`，未知 > 0 转次色 |
| 深链 · 卡头 | 「查看异常拨测目标 →」→ **`/targets?health=down`**（M09 监控目标状态页新增 `health` URL 参数预筛，非法值忽略），替代原「拨测任务管理 →」；落页即只看异常节点 |
| 深链 · 子分区 | 「查看接口服务 / 应用服务采集对象 →」→ **`/resources?resource_category=<key>`**（资源清单首屏 Tab 预筛，该页自带采集状态列，比另开参数体系更稳） |
| 未知态 | `status` 空串 = 未知（中性），不臆造 up/down；计数三项与总数自洽（未知 = 总数 − 正常 − 异常） |
| 移除项 | 明细表、per-section 分页器、**异常短名单**、区头汇总行、卡脚注 |
| 全空态 | 不变（「暂无拨测目标」+ 去配置深链 `/scrape-jobs`），标题字号随 §7.1 收到 16/600 |

**为什么可以去掉短名单（替代初版的保留理由）**：初版保留短名单的顾虑是「纯计数会让『异常 3』成为没有下文的数字」。最终形态用两条深链替代了这个职责——卡头直达**异常目标清单**（M09 `/targets?health=down`，可看到具体节点），子分区直达**该类采集对象清单**（按 `resource_category` 预筛）。数字后面有可点的下文，短名单就不必占用首屏高度。

**必须保留的既有口径（R7）**：`status` 空串 = 未知（中性，不渲染红绿）；`service_name` / `url` / `platform_names` / `network_domain_id` 缺失 → `'-'`（首页不再渲染这些字段，降级规则随字段下线，后端契约不变）；排序（down 强制排前、其余按 `last_probe_at` 倒序、缺失计最小安全值）不变；`probe_targets` 不进 `resource_count`。

**影响**：`ProbePanel.tsx`、`ProbeHealthDonut.tsx`（新增）、`TargetStatusPage.tsx`（`health` 参数）、`HomePage.test.tsx`、`TargetStatusPage.test.tsx`。

**契约副作用（登记，非缺陷）**：明细表与短名单移除后，首页不再展示 `probe_targets[].platform_names`（应用服务所属平台）与 `network_domain_id`。后端仍返回、契约不变，仅首页不再消费；PRD 回填（§6 第 3 项）须登记「首页不消费 `platform_names` / `network_domain_id`」，避免回填时误判为字段删除。

### 2.8 02 云面板与 03 矩阵：走查微调 + 资源分布可隐藏

**裁定**（2026-10-17 第五~六轮走查，产品负责人逐条走查）：

| 项 | 改动 | 动因（产品原话 / 缺陷） |
|---|---|---|
| 02 宽度 | 由 1:1 均分改为 **`0 1 260px` 固定窄列**，03 矩阵分享剩余宽度 | 「不同云的主机数量的宽度过长，请缩短」 |
| 02 标题 | 260px 下卡头「标题 + 口径速记」同行放不下、标题被 ellipsis → 口径速记**移入标题 Tooltip**，卡头只留标题 | 「『不同云的主机数量』这几个字显示不全」 |
| 02 合计 | 新增合计行 `cloud-total-row`（各云台数之和 + 「台主机」），与 03 末列「合计」同口径（仅主机） | 「可以增加一个合计」 |
| 03 命名 | 末列「平台合计」/ 末行「应用合计」交叉命名看不懂 → 统一 **「合计」**，位置即语义；精确口径（行合计 / 列合计）进各自 Tooltip | 「『平台合计 / 应用合计』看不懂要表达的意思」 |
| 03 脚注 | 两句合并为**一行**（速记 + 补录引导），省一行高度；窄容器自然换行 | 「不要分 2 行，看怎么节约下高度」 |
| 资源分布开关 | 02+03 整组合并为「资源管理」组，页头行提供「隐藏/显示资源分布」开关；隐藏时**整行不渲染**（不露面板标题），偏好走 `localStorage`（`homePanelVisibility.ts`） | 「想做到可隐藏的版面」「隐藏是我想把资源管理这个模块一起隐藏，不显出来面板标题」 |
| 三段版式 | ① 资源管理行（02 260px + 03 flex）② 「04 + 告警」**对分** ③ 「采集健康 + 拨测」**flex 1 : 2 填满** → 使用指引 | 「04 适当增加，可以和告警状态对分；拨测面板和采集健康需要填满一行」 |

**布局实现红线（踩过的坑，改版时勿回退）**：

1. 行容器 **不能**设 `display: flex` 后再指望卡片撑满——flex 子项只按内容宽排版，卡在宽列里会右侧留白；行容器用普通块级 `display:flex; flexWrap:wrap; alignItems:stretch` 时卡片必须自带 `height: 100%`；
2. 卡内要撑高必须**三段链**：卡根 `display:flex; flexDirection:column` → `styles.body` 加 `flex:1` → 内容行 `flex:1`。缺任一段，卡高满而内容悬在卡顶（采集健康四态、拨测子分区都踩过）；
3. 窄屏改 `column` 时 `alignItems` 必须从 `center` 改 `stretch`（这是 §7.2 手机端裁列的根因）。

---

## 3. 清单外发现（本轮一并处理 / 登记）

### ★A `ProbePanel` 深链 `/strategy` 为死链（必修）

- 事实：`ProbePanel.tsx:45` `PROBE_STRATEGY_HREF = '/strategy'`，而 `App.tsx` **无 `/strategy` 路由**（采集策略相关路由为 `/scrape-jobs` / `/collectors` / `/rules` / `/metric-library`），命中 `path="*"` → `<Navigate to="/" replace />` —— 「拨测任务管理 →」与「去配置拨测任务 →」**实际跳回首页**。自 `5506321`（首页拨测面板接线）起即存在。
- 修复：改指 **`/scrape-jobs`**（侧边导航「采集策略 · 采集 Job」）。该页经本分支在途改动已提供拨测 Job 的「通过 x / 总数 y」聚合（`useJobScrapeStatus`），Job 详情抽屉可看逐目标探测状态 —— 明细查阅路径成立。
- 验收：`ProbePanel` 两处链接 `href="/scrape-jobs"`；`HomePage.test.tsx` 断言链接目标（防再次漂移）。

### ★B M07 约 15 处「五类」陈注释（后续票）

见 §2.5 后续票清单；本轮不动，登记于 `dev-feedback.md` §11.8.4。

---

## 4. 落地分工

### 4.1 后端（backend-developer）

| # | 文件 | 动作 |
|---|---|---|
| 1 | `platform/dashboard/summary.go:136` | 注释「5 类」→「6 类」 |
| 2 | `platform/dashboard/summary.go:593` | 注释「五类」→「六类」 |
| 3 | `platform/dashboard/summary.go:228` | 类别清单补 `interface_service` |

零行为改动、零契约改动。**不得**触碰该文件其余在途改动（反馈 11 的 `by_platform_app` / `by_cloud` / 拨测字段）。

### 4.2 前端（frontend-developer）

| # | 议题 | 文件 |
|---|---|---|
| 1 | 云卡深链 | `ui-custom/web/src/pages/resources/ResourcesPage.tsx`、`ui-custom/web/src/pages/home/CloudDistributionPanel.tsx` |
| 2 | 告警卡两栏 + 与 04 对分 | `ui-custom/web/src/pages/home/AlertStatusCard.tsx`（统计块 220px 纵排、参考行沉底）；`HomePage.tsx`（`home-coverage-alert-row`） |
| 3 | 删除应用覆盖明细表 | 删 `ui-custom/web/src/pages/home/AppDetailTable.tsx`；`HomePage.tsx` 区块与 import；03 矩阵脚注补补录引导（`PlatformAppMatrixPanel.tsx`） |
| 4 | 04 段圆环 + 六行表 | `HomePage.tsx`（`coverage-body`）、`CoverageDonut.tsx`（新增）、`ResourceTypeGrid.tsx`、`homeDonut.ts`（新增） |
| 5 | 拨测单卡 + 正常率圆环 + 修死链 | `ProbePanel.tsx`、`ProbeHealthDonut.tsx`（新增）、`TargetStatusPage.tsx`（`health` 参数） |
| 6 | 02/03 走查微调 + 资源分布开关 | `CloudDistributionPanel.tsx`、`PlatformAppMatrixPanel.tsx`、`HomePage.tsx`、`homePanelVisibility.ts`（新增） |
| 7 | 字号阶梯 / 表头 | `homeTypography.ts`（新增）、`TableHeaderText.tsx`（新增），全部 home 组件改用常量 |
| 8 | 手机端适配 | `HomePage.tsx`（`alignItems`）、`ResourceTypeGrid.tsx`（窄屏列宽）、`src/App.css`（卡内边距 12） |
| 9 | 测试同步 | `HomePage.test.tsx`、`ResourcesPage.test.tsx`、`TargetStatusPage.test.tsx` |

**禁区**：不得改动 `ui-custom/web/src/pages/strategy/*`、`api/scrapeJobs.ts`、`api/dashboard.ts`（含本分支 M08 在途未提交改动）；不得 `git checkout` / `stash` / 切分支 / 覆盖他人改动。

### 4.3 文档（prototype-designer）

- `dev-feedback.md` §11.8.4「仍待裁定」表：5 项逐条改为「已裁定 + 本提案链接」，并追加 ★A / ★B 登记（已完成）；
- `dev-feedback.md` **新增 §11.9**：第五~七轮走查的逐轮落地记录，并**删除被推翻的旧形态描述**（大数字块 / 异常短名单 / L0-L5 旧区块），只留一句话指针；
- 新增本文件到 `design-proposals/`，并于 2026-10-17 按落地代码回填 §2.3 / §2.6 / §2.7 与新增 §2.8 / §7（已完成）。

---

## 5. 验证策略（按产品负责人指示「只跑修改的部分」）

| 范围 | 命令 |
|---|---|
| 后端 | `go test -count=1 ./platform/dashboard`（包级定向；不跑 `make test-platform` 全量） |
| 前端类型 | `./node_modules/.bin/tsc --noEmit` |
| 前端规范 | `./node_modules/.bin/eslint src/pages/home src/pages/resources --ext ts,tsx` |
| 前端用例 | `./node_modules/.bin/vitest run src/pages/home src/pages/resources --maxWorkers=2 --minWorkers=1` |
| 符号地图 | `make repo-map && make check-repo-map`（本轮有组件文件增删） |

---

## 6. 回填清单（design 分支，受 PRD 冻结门禁）

| # | 文件 | 动作 |
|---|---|---|
| 1 | `Module_05_Custom_UI.md` §3.1 矩阵小节 | 落 §2.2 六条细则（Top 4 阈值、并列次序、其他行条件、未指定平台不占位、输出序、不可下钻）+ R2 不变量 |
| 2 | `Module_05_Custom_UI.md` §3.1 版式 | 落 **04 段圆环 + 六行资源类型表**（§2.6）、**告警卡与 04 对分**（§2.3）、应用覆盖明细表删除（§2.4）、**02/03 走查微调与资源分布可隐藏**（§2.8） |
| 3 | `Module_05_Custom_UI.md` §3.1 拨测 | 落「**单卡：正常率圆环 + 2 子分区 2×2 计数 + 两条深链**」，明确**无异常短名单、无明细表、无汇总行**（§2.7） |
| 4 | `Module_05_Custom_UI.md` §3.1 云卡 | 落「云名深链按 `cloud` 客户端预筛，仅当前页；未指定云不可下钻」（§2.1）+ 合计行（§2.8） |
| 5 | `Module_05_Custom_UI.md` §3.1 视觉规范（新增小节） | 落**字号 / 字重阶梯 6 级**（§7.1）与 R9，作为首页及后续模块的视觉基线 |
| 6 | `Module_05_Custom_UI.md` §3.1 移动端（新增小节） | 落 §7.2：断点 767px、04 表零横滚（列宽 300 / 卡内 12px）、`alignItems` 纵排必须 stretch、矩阵保留横滚 |
| 7 | `frontend-prototype-map.md` §5.3 | 新增 C-x：告警卡与 04 对分、04 圆环 + 六行表、拨测单卡 + 正常率圆环、资源分布可隐藏、字号阶梯 |
| 8 | `design-decisions.md` | 新增决策：首屏版式精修 + 反馈 11 遗留裁定结案（含 Top 4 升正、04 圆环、拨测短名单下架、字号阶梯） |
| 9 | 原型 `docs/prototypes/module-05/` | 按 §2.3 / §2.6 / §2.7 / §2.8 / §7 调整（版本 +1） |

---

## 7. 第七轮走查：字号阶梯收口与手机端修复（2026-10-17）

> 本节是本文件新增的**视觉基线与移动端口径**，与 §2.x 的「区块形态」互补：§2.x 说每块长什么样，§7 说全页的字与数字怎么排、手机上怎么不退化成横滚。
> 逐轮变更来源见 `dev-feedback.md` §11.9。

### 7.1 字号 / 字重阶梯（6 级，一角色一尺寸）

**走查实测（改前）**：首页同时存在 **9 级字号**（11/12/13/14/15/16/18/20/24）与 **4 种字重**（400/500/600/700），同一角色多套尺寸——

| 角色 | 改前的多套尺寸 |
|---|---|
| 行级计数 | 18（云台数）· 20（拨测四格）· 14（采集图例） |
| 空态标题 | 14/700 ×3 · 15/600 ×1 |
| 整体率圆环中心 | 24/500（04）· 20/600（拨测） |
| 表头 vs 表体 | 表头 14/600 **大于** 表体 12~13 |

散点字号的后果不是「某一块不好看」，而是整页看着不像一套设计。

**定稿阶梯**：

| 级别 | 尺寸 / 字重 | 唯一用途 |
|---|---|---|
| hero | **24 / 600** | 圆环中心百分数——全页仅 2 处（04 纳管完成率、拨测正常率） |
| primary | **20 / 600** | 告警四格主数字（当日 / 近 7 天 / 通知中 / 已静默·已抑制） |
| title | **16 / 600** | 卡标题、卡内分区标题、**所有行级计数**、空态标题 |
| label | **13 / 500** | 标签：表格资源类型、告警名、指标名、卡头深链 |
| body | **12 / 400** | 说明、单位、次行、**表头**、口径副标题 |
| note | **11 / 400** | 注释：卡底脚注、Prom 参考行、未处理提示 |

**两条硬规则**：

1. **数字一律 600**，700 只保留给「合计」（行列合计是全表唯一的闭合数）。24px 的 700 在大屏上偏粗黑，且会让 2 个圆环 + 4 个告警数字共 6 个数字同尺寸互抢层级；
2. **行级计数一律 16**——云台数、采集四态、拨测四格从此同尺寸同字重，横向扫读时数字等高。

**圆环几何收口**：两个「整体率」圆环原为 120/r47/stroke11（04）与 100/r42/stroke9（拨测），同屏并排时直径与环厚都不同。现由 `homeDonut.ts` 提供**唯一定义**（120 / r47 / stroke11 / 圆心 60），两环只保留语义色差异。

**落点（杜绝再散点）**：

- `homeTypography.ts`：`HOME_FONT` / `HOME_WEIGHT` 常量，全页唯一来源；
- `homeDonut.ts`：圆环几何 + 周长；
- `TableHeaderText.tsx`：表头 12/500 次色（antd 默认 14/600 比表体还大，层级是反的）；
- 常量与组件**分文件**：react-refresh 不允许组件文件混导出常量，否则 `eslint --max-warnings 0` 直接失败。

### 7.2 手机端：04 表末列被裁（真缺陷，非样式偏好）

**现象**：产品负责人截图——iPhone 竖屏下 04 表最右「未配置」列被卡片右边缘切掉，表内出现横向滚动。

**根因（不是列宽）**：`coverage-body` 在窄屏由 `row` 转 `column` 后，仍沿用 `alignItems: 'center'`。在**纵轴布局**里，`center` 的语义是「横向居中 + 按内容收缩」——表格容器被压回 flex-basis 的 **260px** 并居中，卡片内剩下的 80 多 px 只能靠表内横滚消化，末列自然被裁。同一缺陷也存在于拨测卡内容行（两个子分区会被压成内容宽）。

**修法（三条一起）**：

| # | 改动 | 说明 |
|---|---|---|
| 1 | `coverage-body` → `alignItems: narrow ? 'stretch' : 'center'`，圆环块 `alignSelf: narrow ? 'center' : undefined` | 纵排时容器撑满卡宽，圆环单独居中；拨测内容行同样改 `stretch` |
| 2 | 窄屏列宽 96/60/52/60/60（328）→ **92/54/46/54/54（300）** | 12px 表头 3 字（已配置 / 未配置）需 36 + 内边距 16 = 52 ≤ 54，不折行 |
| 3 | `src/App.css` 移动端块：`.app-content .ant-card-body { padding: 12px !important }` | antd `styles.body` 渲染为**内联样式**，必须 `!important`；卡内边距 20 → 12，为表格腾出 16px |

**验收（写成回归断言，防复发）**：iPhone 390 机型内容区 = 390 − 24（内容区 padding）− 24（卡内） = **342**；360 机型 = **312**；300 < 312，360 以上竖屏**全部零横滚**，更窄机型才回落到横向滚动兜底。`HomePage.test.tsx` 的移动端用例断言：`coverage-body.alignItems === 'stretch'` 且窄屏表 `width ≤ 300`。

**已知非缺陷**：吸顶顶栏（`position: sticky`）会压住正在滚动的卡片标题，属正常滚动行为，不改。

### 7.3 本轮改动文件清单

| 层 | 文件 |
|---|---|
| 新增 | `homeTypography.ts`、`homeDonut.ts`、`TableHeaderText.tsx`、`CoverageDonut.tsx`、`ProbeHealthDonut.tsx`、`PlatformAppMatrixPanel.tsx`、`homePanelVisibility.ts` |
| 删除 | `AppDetailTable.tsx` |
| 改写 | `HomePage.tsx`、`AlertStatusCard.tsx`、`ProbePanel.tsx`、`ResourceTypeGrid.tsx`、`CloudDistributionPanel.tsx`、`SurfaceCard.tsx`、`OnboardingSteps.tsx` |
| 样式 | `src/App.css`（移动端卡内边距） |
| 测试 | `HomePage.test.tsx`（58 例）、`TargetStatusPage.test.tsx`、`ScrapeJobListPage.test.tsx` |

**验证口径**（按产品负责人指示「只跑修改的部分」，不跑全量）：`tsc -p tsconfig.json` / `-p tsconfig.test.json`、`eslint src/pages/home --max-warnings 0`、`TZ=America/New_York vitest run src/pages/home/HomePage.test.tsx`（58/58 绿）。

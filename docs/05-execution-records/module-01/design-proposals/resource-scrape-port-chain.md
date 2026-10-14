# 设计提案：实例级采集端口 `Resource.scrape_port` 落地（M01 §5.1.1 第3 层）

> 类型：设计提案（feature 开发空间 `CNCF_Monitor-feature`；原稿产自 design 工作树，2026-10-10 评审后迁移至此）
> 作者：chenrt / Orchestrator
> 日期：2026-10-10
> 状态：**已评审 → 实现已完成**（2026-10-10 用户拍板 §10 三问：Q1 保留业务端口兜底 + 来源警示；Q2 拆分 D3a/D3b，D3b 修 PRD 对齐实现；Q3 网域级覆盖维持 v0.2 不提前。T01-P1~P7 已全部落地，§8 回填清单已随 T01-P8 回填；剩余为设计侧 PRD 修订待办 #1~#4/#8）
> 关联：M01 PRD `Module_01_Metric_Collection_Center.md` §5.1.1「端口一致性说明」、§5.4「端口不在 Job 层的理由」；M07 PRD `Module_07_Monitoring_Object_Management.md` §5.2 字段表（`scrape_port` {v0.2}）、验收条 :1539
> 决策归属：**M01 设计侧**（端口解析链），跨 M07（字段归属）/ M09（生成器）执行
> 触发事件：2026-10-10 nginx 实例端口被填成 Redis 端口 6379 的排障（详见 §1）

---

## 1. 背景与问题陈述

2026-10-10 排障「nginx 实例采不到数据」，定位到一条完整链路：

| 环节 | 事实 |
|------|------|
| 用户操作 | 新建 nginx 中间件资源 → 建采集任务 `test-nginx-01`，**未选采集器模板** |
| 资源侧 | `middlewares.port = 6379`（Redis 端口，nginx 应为 80/443） |
| 映射侧 | `ci_type_exporter_mappings` 无 `monitor_type=nginx` 行（内置 6 条只有 host/windows/mysql/redis/kafka/snmp） |
| 生成侧 | `exporterPort = LoadExporterPort(...) = 0` → `exporterPortOr(0, middleware.Port=6379)` →拼出 `172.16.1.2:6379` |
| 结果 | 边缘 vmagent 对 6379 拉 nginx metrics → `up=0`，中心无任何 `nginx*` 指标 |

**用户提出的核心诉求**（原话要点）：

> 「用户在配置采集 Job 的时候，只有采集路径地址是需要填写（通常这类地址是统一的），M01 的采集模板变成了一个相对独立的功能……如果采集端口用户配置了一个默认的，后续在配置采集 Job 的时候，是选择默认还是手填，是否需要有一个校验，选择默认的时候，默认模板里面的端口和 M07 用户手填的采集端口需要都一致，如果不一致其实走的就是手填这条路」

**用户补充的关键业务约束**（改变了本提案的设计取舍）：

> 「用户在创建资源的时候，对于 host 主机由于动线上是可以要求运维工程师部署完新机器的时候同步把 node-exporter 进行安装，会比较清楚采集端口；但是 **database / middleware 的登记和采集器安装不一定是同步的，而是异步的；用户在配置采集策略的时候，才会关心采集器端口的问题**……实际场景中，不同域的机器确实会因为各自的要求经常更改采集器的端口」

---

## 2. 现状实证（代码级，全部已核对）

| # | 证据 | 结论 |
|---|------|------|
| A | `platform/strategy/scrapejob/validate.go:217-218` 注释：「模板层回落（**仅 metrics_path/scheme 有采集器级默认；端口由生成器 LoadExporterPort 单独解析，不在 Job 快照内**）」 | **Job 表单本来就没有端口字段**——这是设计而非缺陷。用户「选默认 vs 手填」的纠结在路径/协议上真实存在，在端口上不存在 |
| B | `scrape_jobs` 表实测 28 列，**无任何 port 列** | 端口无Job 层存储位 |
| C | 五类资源表实测**均无 `scrape_port` 列**（`hosts` 连业务 `port` 都没有） | PRD §5.1.1 第 3 层**完全未落地** |
| D | `platform/configcenter/generator/targets.go:48` `exporterPortOr(exporterPort, fallback)`：`exporterPort>0 ? exporterPort : fallback` | 兜底逻辑存在，但fallback 误用了**业务 `port`** |
| E | `targets.go:81/102/121` 三类资源地址拼接：`host` → `instanceAddress(host.PrivateIP, exporterPort)`（**不传业务 port**）；`database`/`middleware` → `exporterPortOr(exporterPort, X.Port)` | **host 与 db/mw 口径不一致**：host 无兜底、db/mw 拿业务端口兜底 |
| F | `targets.go:140/161` `application`/`generic_target` → `instanceAddress(X.Endpoint/X.InstanceIP, X.Port)`，**完全不用 exporterPort** | 这两类走「资源自身端口即采集端口」语义，与 db/mw 的兜底逻辑又不同 |
| G | `platform/configcenter/generator/data_source.go:115-135` `LoadExporterPort`：映射 `Order("is_default desc, created_at asc").First()`，**未过滤 is_default** | 与 `validate.go:197`（`WHERE is_default = true`）**口径不一致**（详见 §7缺陷 D2） |
| H | 前端 `ui-custom/web/src/` grep「采集端口」→ 仅测试断言与注释，无独立 `scrape_port` 输入框 | 前端无 `scrape_port` 入口 |

### 2.1 由此判定的真实行为（回答用户三问）

- **Q1「选默认还是手填」**：**端口上不存在此二选一**。模板的 `default_port` 与映射的 `default_port` 都只是「留空时的兜底」，用户从不在 Job 层手填端口。真正需要用户决策的是 `metrics_path` / `scheme`（这两个**是** Job 快照字段）。
- **Q2「是否需要校验模板端口与M07 端口一致」**：**不需要，且不应加**。两者是「默认值 vs 覆盖值」的优先级关系，不是「两个并行生效的配置」。加一致性校验会把**正常的实例级覆盖**误判为错误并阻塞保存。
- **Q3「不一致其实走手填这条路」**：实际是「实例填了就用实例的，没填才用兜底」，即**优先级链**而非二选一。

---

## 3. 设计目标与非目标

**目标**
- 落地 M01 PRD §5.1.1 第 3 层 `Resource.scrape_port`（可选字段），补齐「实例级端口偏差无处表达」缺口。
- 端口解析链单一来源、优先级明确：**实例 → 类型映射 → 采集器模板 → 业务 port（最后兜底）**。
- 支持「**登记与安装异步**」的真实动线：db/mw 登记时可留空，装完采集器再回填，不阻塞首次登记。
- M01 采集 Job 抽屉提供「生效端口」**只读回显** + 不一致时跳回 M07 修改的引导（PRD :290 原本就写了这条，本提案补实现）。
- 修复 §7 的两个既有缺陷（D1 口径不一致、D2 `is_default` 不一致）。

**非目标（本期不做）**
- **不改M01 PRD §5.4「端口不在 Job 层的理由」**——本提案完全遵循该决策，Job 层不加端口字段。
- 不做「Job 级端口映射表」（PRD 明确不做，与 filter/service_discovery 动态纳入冲突）。
- 不做网域级覆盖 `CITypeExporterMappingOverride`（PRD 标 v0.2；解决「整域统一改端口」，频率低于实例级，**本期不阻塞**）。
- 不给 `host` 增加业务 `port`（用户明确要求）。
- 不改动 `application` / `generic_target` 的端口语义（D3 已裁决：application 现状自洽；generic_target 修 PRD 对齐实现，见 §7 D3）。

---

## 4. 方案对比

### 4.1 端口字段的归属层

| 选项 | 内容 | 评价 |
|------|------|------|
| **A（采纳）** | 新增独立列 `Resource.scrape_port`（五类资源，可选）+ 生成器按四级优先级解析（实例 → 映射 → 模板 → 业务 port） | 合 PRD §5.1.1；语义清晰（业务 `port` 与采集端口分离）；支持异步回填 |
| B | 复用/改名现有 `port` 列 | ❌ `port` 已被 PRD 定义为「服务端口」（业务语义，3306）。复用会让「填 3306 还是 9104」成为**新的**困惑源，得不偿失 |
| C | 在 Job 抽屉加端口字段 | ❌ 直接违反 PRD §5.4；且端口本就不在 Job 快照内（证据 A），加了等于新造第二套语义 |

**采纳 A**，理由：与用户「host 同步登记 / db·mw 异步登记」的两种动线都兼容——登记时知道就填、不知道就留空后续回填，两种情况都不阻塞。

### 4.2 模板端口与实例端口的关系

| 选项 | 内容 | 评价 |
|------|------|------|
| **A（采纳）** | 优先级链：实例 `scrape_port` → 映射 `default_port` → 模板 `default_port`；**不加一致性校验** | 语义正确（默认 vs 覆盖），不阻塞正常操作 |
| B | 加校验：两者不一致则报错 | ❌ 把正常覆盖误判为错误 |
| C | 加校验：不一致时静默改用实例值并提示 | ⚠️ 行为对，但「静默改写+ 提示」易被忽略，且用户失去「我填的端口为何没生效」的可见性 |

**采纳 A**，另在 M01 抽屉做**只读回显**解决可见性：用户能看到「生效端口 = 19100（来自实例覆盖）」，一眼明白优先级。

---

## 5. 端口解析链（权威定义）

### 5.1 端口解析优先级（四级链，2026-10-10 拍板 Q1 确认）

```
Resource.scrape_port（实例级，可选，0/空 = 未指定）
  → CITypeExporterMapping.default_port（类型默认，取 is_default=true 行）
    → ExporterTemplate.default_port（采集器默认）
      → 业务 port（最后兜底，仅 db/mw 有此列；host 无业务端口概念，到模板层为止）
```

**取值口径**：`0` 与 `NULL` 统一视为「未指定」，向下回落。避免出现「填了 0 却被当作有效端口」的歧义。

**兜底保留理由**：四级链保证「`scrape_port` 留空即零回归」（R1）；保留兜底**不能**防止 6379 型事故（事故链路正是「无映射 + 无模板 → 回落业务 port 6379」），补偿控制是**把兜底来源显性化**（§5.3 第 4 种来源标注 ⚠️），把「静默错误」变「可见可疑」。

### 5.2 各资源类型的落点（本提案的核心修正）

现状（证据 E/F）**四类资源口径互不相同**，本提案统一为「都支持实例级覆盖，但保留各自的兜底语义」：

| 资源类型 | 现状地址拼接 | 本提案 | 说明 |
|---------|-------------|--------|------|
| **host** | `instanceAddress(PrivateIP, exporterPort)` —— 无业务 port 兜底 | `instanceAddress(PrivateIP, 优先级端口)` | 保持「无业务 port 兜底」（host 无业务端口概念）；`scrape_port` 补上非标端口能力 |
| **database** | `instanceAddress(InstanceIP, exporterPortOr(exporterPort, Port))` | `instanceAddress(InstanceIP, 四级链解析端口)` | **保留业务 port 最后兜底**（拍板 Q1）：`scrape_port` 有值时优先、留空行为与现状完全一致（零回归）；业务端口兜底时来源标注警示（§5.3） |
| **middleware** | 同上（含6379 事故） | 同上 | 同上 |
| **application** | `instanceAddress(Endpoint, Port)` —— 完全不用 exporterPort | **不动** | PRD :629 已定义 `port` = 「应用采集端口」，语义已对；D3a 裁决：:654 属 §5.9 局部口径，不适用于 §5.8 |
| **generic_target** | `instanceAddress(InstanceIP, Port)` —— 完全不用 exporterPort | **不动** | 端口是端点自身属性（实例级异构），「资源 `port` 直用」符合本质语义；PRD :654「归 M01 承载」与实现分歧已裁决**修 PRD 对齐实现**（见 §7 D3b） |

✅ **拍板 Q1 后无回归**：业务 port 保留为最后兜底，`scrape_port` 留空时 db/mw 生成地址与现状逐字节一致；仅 `scrape_port` 有值时改变行为（详见 §6 风险 R1）。

### 5.3 录入动线（同一字段、两个时机）

```
┌─ M07 资源登记/编辑：「采集端口（选填）」 ─────────────────┐
│  · host：部署即装 node-exporter → 登记时当场填          │
│  · db/mw：登记与安装异步 → 留空，装完采集器后回填       │
│  · Excel 导入模板同步加该列（M07 PRD :930 已登记此列）   │
└─────────────────────────────────────────────────────────┘
┌─ M01 采集 Job 抽屉：只读回显「生效端口」 ────────────────┐
│  · 展示本Job 各实例的生效端口 + 来源标注（四种）：      │
│    实例覆盖 / 类型默认 / 采集器默认 / 业务端口兜底 ⚠️   │
│  · 兜底来源为「业务端口」时附警示提示：                 │
│    「采集端口未配置，当前以业务端口兜底，请确认         │
│    exporter 是否监听该端口」（不阻断，仅显性化）        │
│  · 与实例 `scrape_port` 不一致时，给「前往 M07 修改」引导 │
└─────────────────────────────────────────────────────────┘
```

---

## 6. 影响面与风险

| # | 风险 | 等级 | 处置 |
|---|------|------|------|
| **R1** | **db/mw 移除业务 port 兜底后，若某实例 `scrape_port` 留空且映射/模板也未配端口 → 地址变成裸 IP**（`instanceAddress` port=0 时只返回 IP），生成出无端口 target | **高** | ✅ **已拍板（Q1）**：**保留业务 port 作为最后兜底**，最终四级链 `scrape_port → 映射 → 模板 → 业务port`。只在 `scrape_port` 有值时改变行为，留空则行为与现状完全一致（零回归）；兜底来源在 Job 抽屉显性化警示（§5.3 第 4 种标注） |
| **R2** | 端口变更 → `labels.instance`（`ip:exporter端口`，决策 70）变化 → **时间序列断裂**（旧序列留 15 天，新序列另起，图表断点） | **高** | 端口变更**必须走 M09 变更单下发**，禁止静默生效；复用 `exporter_installation_confirmations.actual_port`（该列已存在）做「实际监听端口 ≠ 生效端口」提示 |
| **R3** | 新增字段涉及五类资源表 + 生成器 + 前端表单 + Excel 导入 | 中 | 分两期：**P0 middleware + database**（异步登记主战场，且含 6379 事故类）、**P1 host**（同步登记）；application / generic_target 不动 |
| **R4** | 与 M07 PRD :654「端口不出现、归 M01 承载」的表述冲突（已裁决拆分：D3a 澄清适用范围、D3b 修 PRD 对齐实现，见 §7 D3） | 中 | D3b 由 prototype-designer 修订 :654/:660/:1671；`scrape_port` 作为**例外出口**（实例偏差）的表述一并回写；端口承载分口径矩阵见回填清单 #8 |
| **R5** | `LoadExporterPort` 未过滤 `is_default`，可能取到非默认映射行的端口 | 中 | 本提案一并修（§7 D2） |

---

## 7. 连带发现的既有缺陷（本提案一并修复）

**D1 · 生成器四类资源端口口径不一致**（证据 E/F）
`host` 不兜底、`db/mw` 兜底业务 port、`application/generic_target` 完全不用 `exporterPort`。本提案按 §5.2 统一。

**D2 · `LoadExporterPort` 与 `resolveJobScrapeParams` 的 `is_default` 口径不一致**（证据 G）
- `data_source.go:118`：`Order("is_default desc, created_at asc").First()` —— **不过滤**
- `validate.go:197`：`Where("is_default = true")` —— **过滤**

后果：同一 `monitor_type` 有多行映射时，生成器可能取到 `is_default=false` 行的**端口**，而路径/协议取的是默认行 → **端口与路径来自不同映射行**。
MVP 内置 6 条映射恰好各1 行且 `is_default=1`，故当前未暴露；**用户自建多映射即触发**。修法：`LoadExporterPort` 补 `is_default = true` 过滤。

**D3 · 已裁决（2026-10-10，拆分为 D3a / D3b）**
`generic_target` / `application` 现状是「资源 `port` 直用、不经 exporterPort」，与 M07 PRD :654「端口归 M01 承载」表述有张力。按「**job_type × 资源类别**」矩阵拆分后裁决：

| 场景 | 端口/地址语义 | 承载方 | 证据 |
|------|-------------|--------|------|
| 拨测（job_type=blackbox） | 目标 = **完整地址/URL**（`host:port` 或 `https://...`），无「端口解析」概念——用户填什么探什么 | M01 Job 的 `blackbox_targets` | targets.go:250-265：blackbox 分支在资源解析之前**短路**，`resolveResource`/`LoadExporterPort` 不进入；render.go:228-236：`__address__` 被 relabel 成 blackbox_exporter 自身，原地址进 `__param_target`/`instance` |
| standard + host/db/mw | exporter 旁路部署，采集端口 ≠ 业务端口，是**采集器侧知识** | M01 四级解析链（§5.1） | 本提案主体 |
| standard + application | 应用同体暴露 /metrics，`port` **就是**采集端口，是**资源自身固有属性** | M07 必填直用，不进链 | M07 PRD :629（必填）；targets.go:140 |
| standard + generic_target | 自带 HTTP 指标端点，端口是**实例级异构**的端点属性（etcd 2379 / kube-state-metrics 8080 / DCGM 9400） | 现状 M07 直用；PRD :654 说归 M01 链 ← **真矛盾在此** | targets.go:161 vs M07 PRD :654 |

- **D3a（application）→ 无需裁决动作**：:654 位于 M07 §5.9（generic_target 小节）属**局部口径**，application 的端口权威在 §5.8（:629，`port` = 应用采集端口、必填，且已废止「endpoint 自带端口可省略」）。application 的端口就是采集端口本身，不属「采集实现知识」范畴，仅回填澄清「:654 不适用于 §5.8」。
- **D3b（generic_target）→ 修 PRD 对齐实现**（而非改实现对齐 PRD）。理由：
  1. generic_target 的端口本质是**端点自身属性**、实例级异构，「类型默认端口」对兜底类不成立——映射链给默认值的前提（该类型普遍用某端口）在此失效。若硬走 M01 链，「自定义 HTTP 指标端点」每个端口都不同，最终还得靠实例级 `scrape_port` 逐个填——绕一圈回到资源级字段，只是换了个名字，还多拆已交付的表单。
  2. PRD 是目标态、实现 + 原型已按现状交付（`ResourceFormDrawer.tsx` generic_target 表单已有可选端口/采集路径/协议三字段），改 PRD 一处表述的成本远小于改表单 + 生成器 + 补各 exporter_type 映射默认值。
  3. 修订方向：:654/:660/:1671 改为「generic_target 的端口与路径是**端点自身属性**，随资源登记（可选，留空走 scheme 默认端口）；与 host/db/mw 的『采集器侧端口归 M01 解析链』口径区分」。`metrics_path`/`scheme` 两字段属同一处分歧，一并澄清（风险低于端口，不影响 instance 标签）。
  4. **执行归属**：PRD 修订属 `docs/02-product-requirements/` 设计侧领地，由 prototype-designer 在 `design/module-mvp-demo` 执行（本提案仅登记裁决结论）。

**拨测与指标采集的天然分流（口径澄清，无需代码改动）**：blackbox Job 的 `monitor_type` / `exporter_template_id` 留空（M01 PRD :562），不进映射/模板链；M07 侧唯一拨测相关字段 `health_check_url` 仅资源画像、不参与采集地址（M07 PRD :626）。表单形态已区分：blackbox Job 填完整地址/URL，standard Job 选实例 + 解析链。**无需任何代码改动**，需把分口径矩阵写死（回填清单 #8），防止「端口归 M01 承载」被过度泛化误读。

---

## 8. 回填清单（PRD / 契约同步项）

> 按项目约定：设计说明必带「回填清单」；口径类须写清代码级依据（路径:行号）、分子分母同源、失败态 `-` 非 `0`。

| # | 回填目标 | 具体动作 | 状态 |
|---|---------|---------|------|
| 1 | M01 PRD §5.1.1 第 3 层 | 由「{v0.2} 规划」标注为「v0.1已落地」，补「登记异步时可留空回填」动线说明 | **设计侧待办（prototype-designer）**——实现已落地（T01-P1 `9d1c29e`）；开发侧不改 `docs/02-product-requirements/`（T01-P8 确认） |
| 2 | M01 PRD §5.4 | 补一句交叉引用：端口优先级链以 §5.1.1 为准，Job 层仍不持端口 | **设计侧待办（prototype-designer）**——实现侧无改动（Job 层本就无端口字段，§7 证据 A） |
| 3 | M07 PRD §5.2 字段表 :1633 | `scrape_port` 去掉 {v0.2} 标注，改为已落地 + 说明与业务 `port` 的分工 | **设计侧待办（prototype-designer）**——字段已落地（T01-P1），契约已回写 M01/M07 快照 |
| 4 | M07 PRD :654/:660/:1671（D3b） | **修 PRD 对齐实现**：改为「generic_target 的端口与路径是端点自身属性，随资源登记（可选，留空走 scheme 默认端口）」，与 host/db/mw 的「采集器侧端口归 M01 解析链」区分；一并澄清 `scrape_port` 是实例偏差的例外出口 | 已裁决；**设计侧待办（prototype-designer 在 design/module-mvp-demo 回写）** |
| 5 | `api-contract-snapshot.md`（M01） | 资源 DTO 新增 `scrape_port`；采集 Job 响应新增「生效端口 + 来源」只读字段（来源含 4 种枚举） | ✅ **已完成（T01-P8）**：M01 契约快照 v2026-10-10 增量回写（§6 生效端口回显、§9 `port_source` 五值枚举、§10 资源 DTO 四通道、§11 UI 映射）；实现 commit `9d1c29e`（P1 字段）/ `98e7c3f`（P4 后端回显）/ `f60bdc0`（P6 前端）/ `498e026`（P7 模板列） |
| 6 | M09 契约 | 端口解析链**四级**优先级的权威表述落 M09 契约快照（生成器行为的唯一依据） | ⏭️ **跳过（T01-P8 裁决）**：`module-09/api-contract-snapshot.md` 无任何端口/解析链表述（grep「端口/四级/解析链/default_port」零命中），无补写落点；四级链权威表述已落本提案 §5.1 与 M01 契约快照 §6（M09 侧生成器消费方口径以提案 §5.1 为准） |
| 7 | dev-feedback | 登记「nginx 实例端口被填成业务端口」事故与「中间件端口字段认知混淆」的用户反馈 | ✅ **已完成（T01-P8）**：`dev-feedback.md` **F-40** 登记（2026-10-10），含补偿控制与设计侧待办指引 |
| 8 | M07 :654/:660/:1671 + M01 §5.4/:583 | **端口承载分口径矩阵（权威表述）**：拨测目标 = 完整地址归 M01 Job（`blackbox_targets`）；host/db/mw 采集端口 = 采集器属性归 M01 四级解析链；application/generic_target 端口 = 资源自身属性归 M07。M01 §5.4/:583 的解析链描述注明 application/generic_target 例外，防止「端口归 M01 承载」被过度泛化 | **设计侧待办（prototype-designer）**——矩阵本身已定稿于本提案 §7 D3 表格，落 PRD 文字归设计侧 |

### D-6 结论（change_detect 对新增 `default:0` 列的核查，T01-P1 实测确认）

- **无行哈希**：`SourceDataVersion`（`platform/configcenter/generator/change_detect.go:63`）对参与配置生成的各源表取 `MAX(updated_at)` 与 `MAX(deleted_at)` 的**较大值聚合成字符串**（`change_detect.go:47/67`），**不存在按行的内容哈希**。
- **加列不产生行变更**：`scrape_port` 为纯新增列（`gorm:"default:0"`），AutoMigrate 加列不 UPDATE 数据行、不推进任何 `updated_at` → 源数据版本不变，变更检测预筛无感。
- **升级首启无变更单噪声**：变更基线 `ConfigChangeBaseline` 从 DB 派生持久化（首次启动以当前 `MAX(updated_at)` 建基线），叠加「加列不推进版本」→ 升级首启**不会**因本次 schema 变更误判出一轮变更单噪声。
- **白名单与测试 helper 零改动**：只加列不加新表 → `sourceTableScopes` 源表白名单与 6 处测试 DB helper 的 `AutoMigrate` 清单均无需改动（加列自动生效），T01-P1/T01-P3 实测 `go test ./platform/...` 全绿确认。

---

## 9. 验收标准（对齐 M07 PRD :1539 口径）

- [ ] {P0} `middleware` / `database` 资源可登记**可选** `scrape_port`；留空时行为与现状**完全一致**（零回归）。
- [ ] {P0} M09 生成 target 时端口按 `scrape_port → 映射 → 模板 → 业务 port` 解析；`scrape_port` 有值时优先于业务 `port`。
- [ ] {P0} M01 采集 Job 抽屉**只读**展示「生效端口」及其来源（四种：实例覆盖 / 类型默认 / 采集器默认 / 业务端口兜底）；不一致时提供跳回 M07 的引导。
- [ ] {P0} 生效端口兜底来源为「业务端口」时，展示 ⚠️ 警示与「请确认 exporter 是否监听该端口」提示（**不阻断**，仅显性化）。
- [ ] {P0} `host` 可登记 `scrape_port`（**不加**业务 `port`），支持 node_exporter 非标端口（9100/19100 混用）。
- [ ] {P0} 端口解析链单元测试覆盖：四级取值全排列 + `0`/`NULL` 等价于未指定。
- [ ] {P0} 回归断言：db/mw 留空 `scrape_port` 时生成的 target 地址与改动前**逐字节一致**。
- [ ] {P1} 端口变更走 M09 变更单下发；`actual_port` 与生效端口不一致时有一致性提示。
- [ ] {P1} Excel 导入模板含 `scrape_port` 列（M07 PRD :930 已登记）。

**失败态口径**：端口未指定且无任何兜底时，地址为裸 IP（`instanceAddress` port=0 语义），前端展示 `-`，**不展示 `0`**。

---

## 10. 已决问题（2026-10-10 用户拍板）

1. **R1 兜底层级 → 确认保留「业务 port」作为最后兜底**：最终四级链 `scrape_port → 映射 → 模板 → 业务 port`（db/mw 适用；host 无业务端口概念，到模板层为止），`scrape_port` 留空零回归。增强：生效端口来源标注增加第 4 种「业务端口兜底 ⚠️」+ 可疑端口提示（§5.3），把 6379 型事故从「静默错误」变「可见可疑」（保留兜底本身不能防事故——事故链路正是「无映射 + 无模板 → 回落业务 port」，显性化才是补偿控制）。
2. **D3 → 拆分裁决（D3a / D3b）**：D3a（application）无需动作、仅回填澄清「:654 属 §5.9 局部口径，不适用于 §5.8」；D3b（generic_target）**修 PRD 对齐实现**（结论与理由见 §7 D3b），PRD 修订由 prototype-designer 在 `design/module-mvp-demo` 执行。拨测（job_type=blackbox）与指标采集已天然分流（blackbox 分支在资源解析前短路，不消费 M07 端口），无需代码改动，分口径矩阵落回填清单 #8。
3. **网域级覆盖 `CITypeExporterMappingOverride` → 确认不提前**，维持 v0.2：实例级 `scrape_port` 已能覆盖单点差异；网域级解决「整域统一改」（频率更低）；MVP 先跑通实例级，解析链（四级已定）与 M09 契约/测试矩阵不必现在翻倍。

---

## 11. 变更影响面清单（实现时逐项核对）

**后端**
- `platform/models/`：`Host` / `Database` / `Middleware` / `GenericTarget` / `Application`新增 `ScrapePort int` + gorm/json tag（**五类都加字段**，即使 application 暂不用，为一致性；application 解析逻辑不变）。
- `platform/configcenter/generator/targets.go`：`resolveResource` 五类分支端口解析改造 + `exporterPortOr` 语义扩展或新增 `resolvePort`。
- `platform/configcenter/generator/data_source.go`：`LoadExporterPort` 补 `is_default=true` 过滤（缺陷 D2）。
- `platform/config/resource/`：资源 create/update DTO 加 `scrape_port`；M07 Excel 导入模板列。
- `platform/strategy/scrapejob/`：Job 响应 DTO 加「生效端口 + 来源」（**请求体不加端口字段**）。

**前端**
- `ui-custom/web/src/pages/resources/ResourceFormDrawer.tsx`：中间件/数据库/主机表单加「采集端口（选填）」；详情抽屉展示。
- `ui-custom/web/src/pages/.../ScrapeJobFormDrawer.tsx`：只读回显「生效端口」+ 来源标注（含「业务端口兜底 ⚠️」警示，不阻断）+ 跳回 M07 引导。
- 列表列偏好`resourceColumnPrefs.ts`：可选是否展示采集端口。

**不做**
- 不给host 加业务 `port`；不改 `application`/`generic_target` 现有端口语义（D3b 仅修 PRD 表述，代码不动）；不实现网域级覆盖表（维持 v0.2，拍板 Q3）。
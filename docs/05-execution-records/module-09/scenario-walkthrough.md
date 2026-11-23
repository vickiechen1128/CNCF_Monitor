# M09 场景演示脚本（Scenario Walkthrough）

> **状态**：reviewing（技术方实测完成，待需求方复核）
> **用途**：技术方用产品把业务场景走一遍，需求方按“感受”确认/修正；功能清单不能替代本脚本。
> **关联**：[Scenario Link](../../07-design/Module_09_Scenario_Link.md) · [SRS](../../02-product-requirements/Modules/SRS/Module_09_Network_Domain_Access_and_Query_Center_Requirements.md) · [HLD](../../07-design/Module_09_Config_and_Query_Center_High_Level_Design.md)
> **演示环境**：本地（中心 :8080 / Prometheus :9090 / Alertmanager :9093 / UI :5173），PostgreSQL `metric_center`。
> **实测日期**：2026-11-22

---

## SCN-01 新网域接入监控

- **前置**：M06 已登记网域；离线包已构建。
- **步骤**：
  1. 进入「配置与查询中心 → 网域纳管」；
  2. 选择已登记网域，执行纳管，复制一次性接入凭据；
  3. 下载离线包并按安装指引部署采集节点；
  4. 等待节点心跳上线；
  5. 查看配置同步状态与当前配置版本。
- **实测结果**：
  - M06 创建网域 `mc-86105a5b` 成功；
  - M09 纳管成功，返回一次性 Token、4 步安装指引、离线包地址；
  - 模拟边缘心跳成功，自动生成配置版本 `20261122-d6d8`；
  - `GET /api/v3/edge/config` 返回 zip（701B），`If-None-Match` 返回 304；
  - UI「网域纳管」显示已纳管、在线、刚刚；配置产物历史显示当前版本、校验通过。
- **问题**：
  - 修复前：`network_domain_access.last_config_version` 为空，网域列表 `last_config_version` 为空；
  - 修复后：配置同步回写已验证，网域列表/Agent 均显示当前版本。
- **需求方反馈**：已确认满足需求（2026-11-22）；P1 修复后复验。
- **结论**：**pass（P1 复验后）**。

## SCN-02 排查采集节点离线

- **前置**：存在一个已纳管网域，采集节点可被停止/恢复。
- **步骤**：
  1. 停止采集节点，等待离线判定；
  2. 进入「采集节点状态」，查看最后心跳、回传积压、配置版本、组件运行态；
  3. 触发「重启采集进程」与「清空回传积压」；
  4. 恢复节点，观察状态回到在线。
- **实测结果**：
  - 远程指令：restart seq=1、flush backlog seq=1；心跳响应回传相同 seq；
  - 组件状态：`blackbox_exporter` 显示 `crash_loop`、restart_count=3、last_error=`exit status 1`；
  - 回传积压 1.0 MB 可见；
  - 超过心跳阈值后节点显示离线；补发心跳后恢复在线（正常）；
  - UI「采集节点状态」：正常 1 / 部分异常 1 / 离线 0；拨测器显示“崩溃回环”。
- **问题**：
  - 已修复：“配置同步”列显示 `in_sync`；
  - 已修复：“采集器”列使用契约类型 `collector` 后显示 running（首次实测 fixture 误用 `vmagent` 类型）。
- **需求方反馈**：已确认满足需求（2026-11-22）。
- **结论**：**pass（P1/P2 复验后）**。

## SCN-03 查看监控目标状态

- **前置**：有在线采集节点与目标快照；包含 up/down 两种状态。
- **步骤**：
  1. 进入「监控目标状态」；
  2. 按网域、Job、健康状态筛选；
  3. 查看异常目标的最近错误与采集信息；
  4. 查看采集覆盖率四态。
- **实测结果**：
  - 心跳上报 2 个目标：`res-walkthrough-up`（up）、`res-walkthrough-down`（down + connection refused）；
  - UI 目标状态正确显示 **在线 / 离线**；最后采集时间、最后错误可见；
  - API `health=down` 过滤返回 1 条；
  - 修复前：覆盖率接口 `summary.total=0`、`items=[]`，但顶层 `collecting=1`、`deployed_not_collected=1`；修复后顶层与 summary 均为 0。
- **问题**：
  - 已修复：顶层 `collecting/deployed_not_collected/not_monitored` 改为 `summary` 的别名，计数一致；
  - 当前无 M01 Job/M07 资源，覆盖率四态（采集中/部分/已下发未采/未监控）未真正覆盖；
  - 已修复：目标快照超过新鲜度阈值时 `stale=true`，health 保留最后上报值，前端显示“在线/离线（数据陈旧）”。
- **需求方反馈**：已确认满足需求（2026-11-22）；目标状态可用。
- **结论**：**partial**（目标状态通过；覆盖率四态未覆盖）。

## SCN-04 实时指标查询

- **前置**：中心 Prometheus 可查；当前用户被授权一个网域。
- **步骤**：
  1. 进入「指标查询」；
  2. 输入 PromQL，选择即时/区间与时间范围；
  3. 执行查询，查看时序图、结果明细、数据来源与新鲜度；
  4. 用未授权网域条件查询，确认返回空/受限；
  5. 复制 URL 刷新，确认视图可复现。
- **实测结果**：
  - UI 指标查询页正常加载；
  - 默认 `up` 查询 0 条序列，空态提示“查询成功但没有匹配到指标序列”；
  - 改为 `vector(1)` 后返回 1 条序列 / 721 点；表格显示最新/最小/最大/平均/点数；
  - 结果元信息显示覆盖网域 `mc-86105a5b`、新鲜度 0s；
  - URL 变为 `?expr=vector%281%29&from=...&to=...&step=30`，可分享/刷新；
  - API `/api/v1/query`、`/api/v1/query_range` 均返回 Prometheus 原生结构 + 顶层 meta。
- **问题**：
  - 当前没有真实抓取数据，`up` 为空；图表在有数据时（`vector(1)`）可渲染，但真实目标趋势未验证；
  - 未授权网域的空结果未用第二租户/第二网域实测（当前仅 admin + 单网域）。
- **需求方反馈**：已确认满足需求（2026-11-22）。
- **结论**：**pass（基础查询/空态/URL 复现）**；真实数据趋势与越权隔离待补。

## SCN-05 指标中断与采集失败排障

- **前置**：存在抓取失败目标与指标中断窗口。
- **步骤**：
  1. 从告警/目标状态进入指标查询，确认 Job/实例与时间范围已预填；
  2. 查看时序图，区分「抓取失败窗口」与「指标缺失窗口」；
  3. 对照目标状态的最近错误、采集耗时、样本数；
  4. 查看中断前后 CPU 趋势；
  5. 复制 URL 分享/刷新，复现同一视图。
- **实测结果**：
  - 目标状态存在 `down` + `connection refused` 的目标；
  - API 查询不存在指标返回空结果 + 覆盖网域 + 新鲜度；UI 空态可读；
  - 查询 URL 可复现；
  - 告警/目标 → 查询的深链入口未在本轮用真实告警验证。
- **问题**：
  - 没有真实抓取失败窗口/指标中断窗口数据，无法验证“0 值与无数据可区分”“抓取失败窗口 vs 缺失窗口”；
  - 未验证从告警/目标一键进入查询并预填 Job/实例/时间范围；
  - 历史遗留告警/告警窗口叠加依赖 M08/AM 数据，当前 AM 代理 404（`/api/v2/alerts%3F...`）需另查。
- **需求方反馈**：已确认满足需求（2026-11-22）；AM 代理已修复。
- **结论**：**partial**（真实中断窗口/深链未验证）。

---

## P1 修复复验（2026-11-22）

### 配置同步版本回写

- 修复：域快照 `InsertAndActivate` 在同一事务回写 `network_domain_access.last_config_version`；checksum 未变路径增加自愈回写。
- 复验：
  - `POST /api/v3/platform/config-sync/trigger`（scope=domain, wait=true）返回 `version=20261122-d6d8`；
  - 网域列表 `last_config_version=20261122-d6d8`；
  - 补发心跳后 Agent `config_sync_status=in_sync`。
- 结论：**fixed**。

### Alertmanager 代理 404

- 修复：AM 客户端用 `url.Parse` 解析 path+query，再 `ResolveReference`，避免 `?` 被转义成路径。
- 复验：`GET /api/v3/platform/alertmanager/alerts` 返回 200，中心日志不再出现 `/api/v2/alerts%3F...` 404。
- 结论：**fixed**。

---

## P2 修复复验（2026-11-22）

### 采集器列映射

- 结论：**非产品缺陷**。契约组件类型为 `collector`；首次实测 fixture 误用 `vmagent` 类型导致列为空。
- 复验：以 `type=collector` 发送心跳后，Agent `collector_status=running`、`collector_version=v1.0.0`，UI 组件列表可见。
- 结论：**fixed（fixture 修正）**。

### 覆盖率计数口径

- 修复：`/api/v1/health/coverage` 顶层三态字段改为 `summary` 的别名（资源级）：
  - `collecting = summary.collecting`
  - `deployed_not_collected = summary.partial_collecting + summary.pending_down`
  - `not_monitored = summary.not_monitored`
- 复验：无 M01 Job/M07 资源时，顶层计数与 `summary` 均为 0，不再出现 1/1 vs 0 的矛盾。
- 结论：**fixed**。

---

## P3 修复复验（2026-11-22）

### 陈旧目标显示

- 修复：`TargetResponse` 增加 `stale`；快照过期时保留最后上报的 `health`，不再降级为 `unknown`。
- 前端：目标状态页显示“在线（数据陈旧）/ 离线（数据陈旧）”，不影响按 health 筛选。
- 复验/测试：`GET /api/v1/targets` 返回 `health=up/down, stale=true`；`health=up` 过滤仍包含 stale up；`TargetStatusPage.test.tsx` 新增陈旧用例；`query_service_test.go` 断言 stale up 仍为 up + stale=true。
- 结论：**fixed**。

---

## 走查结论

| SCN | 结论 | 说明 |
|-----|------|------|
| SCN-01 | partial | 纳管/心跳/配置生成/下载通；配置同步状态缺口 |
| SCN-02 | pass | 指令/组件/积压/配置同步/采集器均通 |
| SCN-03 | partial | 目标 up/down 通；覆盖率计数已一致，四态未覆盖 |
| SCN-04 | pass（基础） | 查询/空态/数据渲染/URL 复现通；真实趋势与越权待补 |
| SCN-05 | partial | 目标错误/空态通；真实中断窗口与深链未验证 |

## 发现的问题（待排期）

1. ~~**配置同步状态缺口（P1）**~~：已修复并复验（见上节）。
2. ~~**采集器列映射（P2）**~~：已确认 fixture 类型错误；使用契约类型 `collector` 后正常（见上节）。
3. ~~**覆盖率计数不一致（P1/P2）**~~：已修复，顶层字段改为 summary 别名；四态覆盖仍需真实 M01/M07 数据。
4. ~~**陈旧目标显示 unknown（P3）**~~：已修复，增加 `stale` 标记并显示“数据陈旧”。
5. ~~**AM 代理 404（P1/P2）**~~：已修复并复验（见上节）。

## 需求方复核

> 以上为技术方实测结果；需求方已于 2026-11-22 确认 5 个场景满足需求。P1/P2/P3 已修复复验；剩余为真实数据/四态覆盖待补。

| 日期 | 场景 | 参与人 | 结论 | 后续动作 |
|------|------|--------|------|----------|
| 2026-11-22 | SCN-01~05（技术方实测） | 技术方 | 见上表 | P1/P2/P3 已修复并复验；真实数据/四态待补 |
| 2026-11-22 | 需求方复核 | chenrt | 5 个场景满足需求 | 继续推进模板/M01 推广 |

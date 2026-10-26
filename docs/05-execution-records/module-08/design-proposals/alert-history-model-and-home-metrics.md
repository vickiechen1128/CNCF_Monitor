# 历史告警模型加固与首屏指标替换

状态：approved（2026-10-26，用户确认口径）
模块：Module_08 告警收敛与通知管理

## 1. 背景

参考实现（`11.md`）给出了「一行 = 一次告警发生」的历史告警模型。经逐条比对，本次吸收其
核心口径，同时保留本项目已有的多 receiver、诊断字段与 always-2xx 写入口径。

用户确认的关键决策：

- 首屏「告警状态」卡四格替换为：今日告警 / 今日恢复 / 历史遗留告警 / 历史遗留今日恢复。
- 今日告警严格按开始时间；昨天开始、今天仍在持续的不计入今日告警。
- 首次触发就被静默/抑制的告警不补插历史。
- 不保留「通知中 / 静默 / 抑制」次要行。
- 历史告警表时间字段统一按 UTC+8 带偏移存储；`occurrence_key` 归一化使用 UTC 毫秒。
- 其他表的历史时间数据不动，只处理 `alert_events`。

## 2. 数据模型

主表仍为 `alert_events`，在既有字段上增量调整：

| 字段 | 说明 |
|------|------|
| `occurrence_key` | 一次发生的去重键：SHA-256(`fingerprint` + 归一化到 UTC 毫秒的 `starts_at`)。空指纹为空串，不参与唯一约束。 |
| `closed_at` | 记录关闭时刻。所有终态都有值；`resolved` 时等于真实恢复时间 `ends_at`。统计统一用它。 |
| `status` | 七态：firing / silenced / inhibited / resolved / silenced_closed / inhibited_closed / lost。新增 `inhibited_closed` 区分「抑制期间结束」。 |
| `starts_at` / `ends_at` / `last_notified_at` / `created_at` / `updated_at` | 统一按 UTC+8 带偏移存储。 |

约束：

- 未结行（firing/silenced/inhibited）按 `fingerprint` 部分唯一（沿用）。
- 非空 `occurrence_key` 全表部分唯一，兜底 webhook 与对账并发、迟到推送、跨库精度差异。
- `closed_at` 建索引，支撑四指标统计。
- 无指纹报文保持原样落库（不生成兜底指纹），不参与 occurrence 唯一约束。

## 3. 写入链路

### 3.1 Webhook（POST /api/v1/webhooks/alerts）

- 对 Alertmanager 永远 2xx，避免毒消息无限重试；缺口由对账补。
- 先按 `occurrence_key` 找同一次发生：
  - firing：只刷新展示字段与 `last_notified_at`，不新增、不复活已结束的发生。
  - resolved：回填 `status=resolved`、`ends_at=closed_at=AM endsAt`；已 resolved 且已有恢复时间的重复推送幂等忽略。
- `occurrence_key` 未命中时按 `fingerprint` 找回未结行，兼容 resolved 报文 startsAt 缺失/精度不一致。
- resolved 缺少有效 `endsAt` 时不写入、不伪造恢复时间，留给对账按「恢复信息丢失」关闭。
- `mutedBy`（时间区间静音）与 `silencedBy` 同义，归一为静默，不误判成抑制。

### 3.2 分钟级对账

- 对齐未结行状态：静默/时间静音 > 抑制 > 告警中。
- 对账判定关闭后重新活跃：在原行恢复未结束状态，清空 `closed_at`/`ends_at`；已真实 resolved 的不复活。
- 补插只补 `state=active` 的漏记；首次触发就被静默/抑制（`suppressed`）或尚未确定通知状态（`unprocessed`）的不补插。
- 关闭消失行：静默中 → `silenced_closed`；抑制中 → `inhibited_closed`；其余 → `lost`。`ends_at` 留空，`closed_at` 记对账发现时刻。
- 安全阀：
  - AM 不可达：整轮跳过。
  - AM 启动不足 3 分钟：不关行。
  - 行创建不足 2 分钟：不关/不补。
  - 活跃集连续 2 轮为空才允许关行。
  - 单轮待关闭占比 > 50% 且 > 10 条时先缓一轮，连续两轮确认后才执行。

## 4. 指标口径

| 指标 | 口径 |
|------|------|
| 今日告警 | `starts_at` 落在今天自然日内的发生数（严格按开始时间） |
| 今日恢复 | `closed_at` 落在今天的终态数 = 真实恢复 + 恢复时间未知 |
| 历史遗留告警 | 当前未结且 `starts_at` 早于今天 0 点 |
| 历史遗留今日恢复 | `starts_at` 早于今天 0 点且 `closed_at` 落在今天 |

接口：`GET /api/v2/platform/alertmanager/alert-events/stats` 只返回上述四指标及
真实/未知拆分、历史遗留状态拆分；旧 `week_total` / `open_*` 字段按用户要求删除，
不做兼容。所有时间边界先转 UTC+8 再进 SQL，与表内存储一致。

前端首页「告警状态」卡四格只展示上述四指标；今日恢复 / 历史遗留今日恢复的 Tooltip
拆分「真实恢复 N 条 + 恢复时间未知 M 条」。通知中/静默/抑制不再进统计条，仅保留在
「正在告警」行状态与 `/alert-status` 实时视图里。

首页右下「正在告警」列数据来自 Alertmanager（剔除 unprocessed，按开始时间倒序）；
原「最新告警」标题按用户要求改名。原左下「告警规则 · 已触发/观察中」Prometheus
参考行按用户要求移除，首页告警卡只保留「库四指标 + AM 正在告警」。

空态判断用历史四指标 + AM 实时四态兜底：历史表可能尚未写入，不能只看四格是否为 0。

## 5. 与参考实现（11.md）的差异

| 项 | 本次选择 | 原因 |
|----|----------|------|
| `start_time` 双时间字段 | 不引入，只用 `starts_at` | 避免唯一键与统计字段漂移 |
| 时间戳复合唯一键 | 改为 `occurrence_key` 哈希 | 避免跨库/跨通道精度与时区问题 |
| 死信表 + 5xx 重试 | 不引入，保持 always-2xx | MVP 由对账兜底；死信链路需独立设计 |
| `source` / `receiver` / `group_key` / `last_notified_at` | 保留 | 多 receiver 场景有诊断价值 |
| 无指纹 fallback fingerprint | 不生成，原样落库 | 保持既有「无指纹不合并」口径 |
| 状态命名 | 保留 `silenced_closed` / `lost`，新增 `inhibited_closed` | 减少存量数据与前端文案迁移 |
| 保留清理 | 默认 180 天，`ALERT_EVENT_RETENTION_DAYS` 可配 | 参考实现未覆盖，表会无限增长 |
| 旧首页指标兼容 | 不保留，`week_total` / `open_*` 直接删除 | 用户明确要求只保留新四指标 |
| 首页 Prometheus 参考行 | 移除 | 首页告警卡收敛为「库四指标 + AM 正在告警」 |
| 部分唯一索引 | SQLite 部分索引 | 迁 MySQL 时需改为生成列或应用层保证 |

## 6. 迁移与运维

- `AutoMigrate` 增加 `occurrence_key` / `closed_at` 列。
- 迁移只处理 `alert_events`：
  - 时间字段刷成 UTC+8；
  - resolved 回填 `closed_at=ends_at`；其余终态回填 `closed_at=updated_at`；
  - 有指纹行回填 `occurrence_key`。
- 其他表历史时间不重写；后续新写入由各业务自行维护。
- 保留清理：启动先清一次，之后每 24 小时清理 `closed_at` 早于保留期的终态行；未结行永不清理。
- 若存量数据存在重复 `occurrence_key`，唯一索引创建会失败并报错；需先人工清理重复发生。

## 7. 验收

- 后端：webhook 去重/回填/迟到 firing、对账恢复/补插/安全阀/清理、四指标边界与 UTC+8 存储均有单测。
- 前端：首页四格取值与 Tooltip、统计失败降级、空态、历史页七态展示均有测试。
- 全量回归：仅允许本机已知基线失败（`platform/admin/storagelog`、`platform/db TestInitDefaultPath`、
  `platform/strategy/rule` promtool 三态）。

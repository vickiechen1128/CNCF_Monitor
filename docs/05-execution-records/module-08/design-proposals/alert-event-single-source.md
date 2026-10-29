# event 表单一事实源：当前告警 / 首页右栏口径收敛

状态：approved（2026-10-29，用户确认）
模块：Module_08（主）/ Module_05（首页）
关联：`alert-history-model-and-home-metrics.md`（2026-10-26 历史告警模型与首页四指标）

## 1. 背景

同一批告警此前存在三套状态词、多个入口：

- `/alert-status` Tab 1「通知状态」：AM `notify_status` 四态（通知中 / 已静默 / 已抑制 / 待处理）；
- `/alert-status` Tab 2「当前告警」：Prometheus `firing` / `pending`（待处理）；
- `/alert-history`：event 表七态（告警中 / 静默中 / 抑制中 / 已恢复 / 静默期间结束 / 抑制期间结束 / 已结束）；
- 首页四格：event 表统计；首页右栏：AM `notify_status=active`。

突出问题是两个「待处理」含义不同（AM `unprocessed` vs Prom `pending`），以及首页右栏只展示通知中，
与四格（发生量，含静默/抑制/已恢复）看起来互相矛盾。

用户 2026-10-29 决定：**以 `alert_events` 为唯一事实源**，取消 AM 通知状态四态视图。

## 2. 决策

1. **当前告警 = event 表未结三态**：`firing` / `silenced` / `inhibited`，文案统一为
   **告警中 / 静默中 / 抑制中**（与历史告警页一致）。
2. **「待处理」下线**：AM `unprocessed` 不再对外展示；event 表对账本来就把
   `unprocessed` 按 `firing` 处理，因此没有信息丢失。Prom `pending` 文案改为**观察中**。
3. `/alert-status` 页签收敛为：
   - Tab 1「当前告警」：event 表未结三态（三张统计卡 + 服务端筛选/分页）；
   - Tab 2「规则评估」：Prometheus `firing` / `pending`。
4. **首页右栏改为 event 表未结告警**，标题「当前告警」，展示未结三态；
   **取消分页**，改为卡内纵向滚动条展示全部未结告警（桌面约 360px、窄屏约 280px）。
   为一次取满全量，新增不分页接口 `GET /alert-events/current`（见 §3.2）。
5. **不补记「一出生就被静默/抑制」的告警**：用户明确「用户从没收到过通知，不算告警」，
   维持对账只补 `state=active` 的既有逻辑（`reconciler.go`）。
6. 首页四格口径不变，仍来自 `/alert-events/stats`；与当前告警列表同一张表、同一 UTC+8 日界。

## 3. 接口增量（向后兼容）

### 3.1 `GET /api/v2/platform/alertmanager/alert-events`

- `status=open`：新增分组别名，映射未结三态 `firing / silenced / inhibited`；
  仍支持原有七态精确过滤。
- 其余参数、分页、排序、响应结构不变。

### 3.2 `GET /api/v2/platform/alertmanager/alert-events/current`（新增）

- 返回全部未结告警（`firing / silenced / inhibited`），**不分页**：
  `{ "list": [...], "total": N }`。
- 可选 `network_domain` 查询参数（当前首页暂不传）。
- 首页「当前告警」卡一次取满全量，在卡内滚动浏览；历史告警页仍走 §3.1 的分页列表，
  不受本接口影响。

### 3.3 `GET /api/v2/platform/alertmanager/alert-events/stats`

- 新增可选 `network_domain` 查询参数：全部统计指标按网域过滤（当前告警页网域筛选需要）。
- 新增未结计数（不限今天，与 `status=open` 同口径）：
  - `open_total` / `open_firing` / `open_silenced` / `open_inhibited`
- 既有四指标字段不变。

> 说明：2026-10-26 的提案曾按首页需求删除旧 `open_*` 字段；本次因「当前告警」页三张统计卡
> 需要重新引入，语义限定为**当前未结（不限今天）**，与首页四格（按自然日/发生量）区分。

## 4. 影响范围

- `platform/alertmanager/history/handler.go`：`status=open` 分组、`/alert-events/current`
  不分页接口、stats 未结计数与网域过滤；
- `ui-custom/web/src/pages/alerts/AlertStatusPage.tsx`：Tab 1 重写、Tab 2 改名「规则评估」；
- `ui-custom/web/src/pages/home/HomePage.tsx`、`AlertStatusCard.tsx`：右栏改 event 表未结告警，
  取消分页、改为卡内滚动；
- 首页告警卡请求从 3 条链路降为 2 条（stats + current），不再调用 AM 通知状态与 M02 history；
- 后端 `/api/v2/platform/alertmanager/alerts`（notify_status 四态）**保留**：对账内部仍使用
  `alerts.Proxy.ListActiveAlerts`，HTTP 代理仅为兼容保留，前端不再消费。

## 5. 数据时效

event 表由 webhook（通知中告警近实时）+ 分钟级对账写入，当前告警视图最多约 1 分钟滞后；
这是换取「单一事实源 / 状态词统一」的代价，已在产品侧确认接受。

## 6. 验收标准

1. `/alert-status` 默认 Tab 为「当前告警」，三张卡为告警中 / 静默中 / 抑制中，不出现「待处理」。
2. 状态筛选与网域筛选走服务端；切换筛选回到第 1 页。
3. 历史告警页与当前告警页对同一 occurrence 的状态文案一致。
4. 首页右栏出现静默中、抑制中告警；无未结告警时显示「当前无告警」；
   告警超过可视高度时出现卡内滚动条，不再出现分页器；全部未结告警均在列表内。
5. 首页四格与当前告警列表均失败才整卡报错；单条失败局部降级。
6. 首次即被静默/抑制、从未通知过的告警不出现在当前告警与历史告警中（符合用户口径）。

## 7. 后续

- PRD 回写：Module_08 §3.2/§5.4 页签与状态词、Module_05 §3.1 首页告警卡右栏口径。
- 若后续希望「当前告警」严格实时（秒级），需另行设计 AM 实时视图与 event 表的合并策略，
  不在本提案范围。

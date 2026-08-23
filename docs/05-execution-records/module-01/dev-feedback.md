# Module_01 开发反馈（dev-feedback）

> 本文件记录开发/规划阶段发现的 PRD / 原型空白或需修订点，供 PM 在 `design/module-mvp-demo` 上按版本化迭代收割。①类（PRD 文档问题）记录于此，由 chenrt 在 design 分支修订后合入 develop 回流；②类（实现矛盾）必须事前走 CR，不以本文件兜底。

## 2026-08-23（Phase 3 规划派生）

### F-01：PRD §5.6 ExporterInstallationConfirmation 主键维度过时（① 类，已决策）
- **位置**：`Module_01_Metric_Collection_Center.md` §5.6 数据模型
- **问题**：§5.6 定义安装确认唯一维度为 `resource × exporter_template_id`（不分 Job），与 §6.2.5 API、§8 状态机、Phase 3 UI 动线（在某 Job 的已选实例上确认）矛盾。
- **已决策实现口径（用户批准）**：主键维度改为 `resource_id × scrape_job_id`，FK scrape_job_id→ScrapeJob.id；`exporter_template_id` 降为冗余缓存（来自 ScrapeJob，不参与唯一性）。
- **待 PRD 修订**：
  1. §5.6：主键维度与职责边界由「resource×exporter、不分 Job」改为「resource×ScrapeJob」；
  2. §5.6：状态枚举名与 §8 统一为 `unconfirmed / confirmed / not_applicable`（原 §5.6 枚举名不一致）；
  3. §6.2.5：路径保持不变，说明里「确认记录（5.6）」引用上下文对齐到 Job 维度（其本身已正确，仅需随 §5.6 同步说明）。
- **收割方式**：chenrt 在 `design/module-mvp-demo` 按上述修订 PRD + Change Log，合入 develop 后回流开发侧。

### F-02：ScrapeJob 网域「已纳管」校验依赖 M09 字段（① 类，已决策临时口径）
- **位置**：Module_01 §5.4 `network_domain_id` 必填口径、§8/§9 网域约束；Module_01 §1 边界（M09 负责配置生成）
- **问题**：`NetworkDomain.is_monitored` 为 M09（Phase 4 配置中心）维护字段，M09 尚未开发；本期 ScrapeJob 校验若硬依赖该字段会形成空依赖。
- **已决策临时口径（用户批准）**：MVP 由 seed 将 default 及示例 edge 域 `is_monitored=true` 预置，后端校验 `is_monitored=true` + `status=enabled`（非冻结）；M09 落地后由 M09 自然接管该字段维护。
- **待 PRD 修订**：在 §5.4/§9 补一句「is_monitored 由 M09 维护，MVP 阶段 seed 预置已纳管」的过渡说明（可选，用于消除评审疑问）。

## 收割状态
- [ ] F-01 已收割（chenrt 修订 PRD §5.6 / §6.2.5）
- [ ] F-02 已收割（chenrt 修订 PRD §5.4 / §9）
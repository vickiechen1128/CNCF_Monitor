# PR 描述（design → develop：M11 部署拓扑与 Agent 升级策略第五轮拍板回填）

> PR 标题：`docs(module-11): M11 PRD v0.4 第五轮拍板回填——Agent 自升级 {v0.3} 引入、中继选型约束、方案 A 部署形态收口`
>
> 本描述基于 `origin/develop...design/module-mvp-demo` 整理；本次 PR 全部为 **docs（纯文档）变更**，无生产代码改动。

---

## Summary

第五轮（2026-09-20）用户拍板 M11 design proposal 全部待决决策（D1 = a、D2 = a、D3 = b、D4 = b），将结论回填至：

- **PRD** `Module_11_Edge_Access_and_Agent_Delivery.md`：v0.2 → **v0.4**
- **Design proposal** `edge-delivery-topology-and-agent-upgrade.md`：proposed（待拍板）→ **approved**

覆盖议题：Agent 自升级策略从「不做（风险保守）」改为 **{v0.3} 拉模式自升级（默认关闭 + 规模门槛）**；中继选型一句话硬约束；部署形态方案 A 与 A′ 备选正式入 PRD。

---

## 变更内容（按文件分组）

### 1. Design proposal：`edge-delivery-topology-and-agent-upgrade.md`（approved）

- 状态 `proposed → approved`，日期追加第五轮；触发新增第⑤轮说明
- §1 结论摘要 #3：Agent 自升级改为「**（第五轮拍板 D3 = b）{v0.3} 引入**：拉模式自升级，默认关闭 + 规模门槛触发（节点数 ≥ 10 或年升级 ≥ 3 次），ed25519 签名 + 原子回滚 + 按网域灰度」
- §1.1 因果链新增第⑤步（剩余拍板 → D1-D4 结论）
- §3.4 冲突声明收口：`待拍板 §8-D3` → `（第五轮拍板 D3 = b）`，明确需在 module-11 新建设计决策记录并更新 PRD 旧口径
- §8.1 改题为「（第五轮）已拍板决策」：D1=a（入 PRD §1.2/§7.2）、D2=a（§1.2 演进备选）、D3=b（§3.3/§4.4）、D4=b（§6.1 一句话硬约束）
- §9.1 改题「（v0.2 → v0.4）」并新增执行状态：C1-C5 已随 v0.3 回填，D1-D4 已随 v0.4 回填；#5 按 D4 = b 收口为 §6.1 一句话约束，不新增子节

### 2. PRD：`Module_11_Edge_Access_and_Agent_Delivery.md`（v0.2 → v0.4）

- §3.3 功能表：
  - 「完整升级流程」行补充 `{v0.3}` 起规模门槛内由 Agent 拉模式自升级承载
  - 「Agent 自升级」行由「**不做**」改为「{v0.3} 引入拉模式自升级（默认关闭）：心跳带版本 → 中心返回最新版本与签名包下载地址 → 验签 → 原子替换 → systemd 重启，启动失败回滚上一版本；按网域灰度；规模门槛 = 节点数 ≥ 10 或年升级 ≥ 3 次，低于门槛维持人工引导（升级链路见 §4.4）」
- §4.4 升级流程（{v0.3}）拆为「默认人工引导」与「拉模式自升级」两段
- §6.1 新增一行：中继场景（仅网闸实测不穿透时引入）管理面必须**应用层反向代理**、数据面必须**存储转发**（带持久化队列），**禁用 L4/TCP 纯端口转发**（D4 = b）
- §9.2 技术验收新增：规模门槛内拉模式自升级（验签拒绝安装 / 启动失败回滚 / 升级结果进心跳）P1 {v0.3}
- Change Log 新增 v0.4 行，压缩 v0.3 行，v0.1 迁出（保留最近 3 版）
- 头部版本 v0.2 → v0.4，关联 PRD 版本标注同步

> 说明：v0.3（四轮讨论结论：方案 A 部署形态、MVP 不引 PostgreSQL、采集器强制 vmagent 单一化、`wal_backlog_bytes` → `queue_backlog_bytes`、中心 remote_write 接收端）与 v0.4（第五轮拍板）均在本 PR 内一次回填到位。

---

## 参考文档

- PRD：`docs/02-product-requirements/Modules/Module_11_Edge_Access_and_Agent_Delivery.md` v0.4
- Design proposal：`docs/05-execution-records/module-11/design-proposals/edge-delivery-topology-and-agent-upgrade.md`（approved）
- 关联决策：`docs/05-execution-records/module-09/design-decisions.md`（决策 5 / 9 / 86 / 87）
- 原型：`docs/prototypes/module-09/`（与 M11 共用）

---

## 测试结果

- 纯文档变更（docs 层），无生产代码，无需编译/单元测试。
- 提交前已核对：Change Log 保留最近 3 版（v0.4/v0.3/v0.2）✓、§3 说明列无 CLI 参数名/API 路径/环境变量名 ✓、版本差量花括号形态 {v0.3} ✓、PRD 与 proposal 版本对齐（v0.4）✓、§3.3 升级链路引用指向有效章节 §4.4 ✓。

---

## 合并后动作

1. `design/module-mvp-demo` 合入 `develop`（本次仅文档变更，合入后 develop 上 M11 PRD 为 v0.4）。
2. 开发侧回填项待办（proposal §9.2/9.3/9.4/9.5）：`module-11` 新建设计决策记录、dev-feedback.md、task-sequence.yaml 增 T11-20~24、api-contract-snapshot 契约扩展（latest_agent_version / agent_download_url）、原型同步。

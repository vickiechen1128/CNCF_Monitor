# prototype-designer 执行记录：module-09

## 任务

基于 `docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md` 生成分模块独立原型。

## 输出

- PRD 文件路径：`docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md`
- PRD 状态：ready
- PRD 版本：v1.1
- 原型目录：`docs/prototypes/module-09/`
- 对齐决策记录：`docs/05-execution-records/module-09/design-decisions.md`
- 技术缺口记录：无

## 原型页面清单

- 网域管理
- Agent 状态
- 配置生成
- 下发记录

## 本地启动方式

```bash
cd docs/prototypes/module-09
pnpm install
pnpm dev
```

访问地址：http://localhost:5173/

## 验证结果

- `pnpm exec tsc --noEmit`：通过
- `pnpm run build`：通过
- `pnpm run lint`：通过

## 已知问题/下一步建议

- 原型阶段使用本地 mock 数据，未接入真实后端 API。
- 后续进入 feat/module-09 开发时，需冻结 PRD 并按 micro-task 序列执行。

---

## 评审记录：M09 dev-feedback 吸收（2026-09-30）

> 评审身份：prototype-designer（PRD / 原型 Owner）
> 评审对象：`docs/05-execution-records/module-09/dev-feedback.md`（§1–§10 + F-13～F-37 全量）+ 已 landed 实现
> 输入：dev-feedback 全文 / 收割状态 + M09 PRD v2.1 + M11 PRD v0.7 + M08 PRD v1.18
> **结论：部分吸收（Absorb residual only）** —— 大量条目已收割 / 属 M11 领域 / 属 ② 实现偏差不入 PRD；本轮只吸收「残余口径项」4 类，M09 PRD v2.1 → v2.2。

### 一、事实核对（M09 / M11 分界，逐条）

| 核对点 | 结果 |
|---|---|
| M09 已在 v2.0 按「决策 86」1 拆 2；网域纳管 / 采集节点状态 / edge 协议 / EdgeAgent 模型迁往 M11 | ✅ M09 PRD §5.1 明示「M11 维护监控纳管字段：`channel` / `agent_type` / `remote_write_url` / `token` / `center_endpoint` / 运行态字段」 |
| dev-feedback 中标注「已收割于 v1.50」的条目是否真已落 M09 PRD | ✅ §5 / §6 / F-13～F-15 / F-17～F-19 / §9 / §10 / F-28 / F-31 逐条比对，正文确有对应口径 |
| §8 dev-feedback 原文标注「PRD 无需改动」（`instance` 放行） | ✅ 属实（§3.5.1 仅禁 `__` 前缀）——本轮以「1 条口径补充 + 1 条验收固化」收口，防同型缺口（决策 3.26 已发生过一次）复现 |
| F-37 归属 | ⚠️ **M11 领域**：M09 §5.1 明示 `center_endpoint` 由 M11 维护；M09 PRD 无「配置包下载地址」正文 |
| F-26 / F-27 归属 | ⚠️ **M11 领域**（网域详情「采集节点情况」、安装指引双分支 + Edge Sync Agent v0.2 口径） |

### 二、逐项结论

**A. 本轮吸收进 M09 PRD（v2.2）**

| 来源 | 结论 | PRD 落点 |
|---|---|---|
| §3 promtool / blackbox 校验态（① 空白判定） | **吸收**（口径固化） | §3.2.3 / §6.1 / §9.2 |
| §4 `source_version` 语义 + 版本查询双 ref 兼容（契约口径确认） | **吸收** | §5.2 / §6.2.2 / §9.2 / §10 |
| §8 `instance` labels 放行 + `validation_message` 透传 | **吸收**（口径固化 + 字段新增） | §6.1 / §3.2.3 / §5.2 / §9.2 / §10 |
| F-25 `alerting` 段不参与 diff（② 实现偏差，但需产品口径） | **吸收**（新增注入段变更对象 `prom_alerting`） | §3.1.1 / §5.2 / §10 |
| F-35 归因口径「工具存在但不可执行 → `pending` + `platform_fault`」 | **吸收**（与「工具缺失」同口径） | §3.2.3 / §6.1 / §9.2 |
| F-36 跨 M08 边界（`receivers` 双作者命名空间 + 桥地址演进 + `route` 归属分层） | **吸收**（新增子节，对齐 M08 PRD v1.18 §4.1.1） | §7.1.5 |

**B. 已收割（不需重复吸收）**：§5 禁用网域纳管（v1.57 / v1.72 + 决策 62/82）、§6 自动变更检测 30s 轮询（v1.50）、F-13～F-15、F-17～F-19（v1.50 + 决策 43/44/45）、§9 pending 出口 + 归因（v1.50）、§10 target 端口（v1.50 + 决策 46）、F-28 `channel` 硬编码（v2.1）、F-31 空 targets（v2.1）。

**C. M11 领域（不入 M09 PRD）**：§1 list 不返回明文 token（契约口径确认，前端消费 `token_masked`）、F-26 网域详情「采集节点情况」、F-27 安装指引双分支 + Edge Sync Agent v0.2、F-29 下载入口（已回写 M11 PRD v0.6）、F-30 token 入口（已回写 M11 PRD v0.6）、F-37 `center_endpoint` 消费。

**D. 不入 PRD（② 实现偏差 / 内部实现 / 交付侧）**：§2 部署路由 param 名统一、F-18 闭环（旧构建）、F-21～F-24（已修正）、F-32 StrictMode 转圈、F-33 中心一体化包自定义端口（交付侧）、F-34 `$var` 全角吞字。

**E. 跨模块（已由他模块吸收）**：F-36 的 M08 侧（`receivers` 双作者 / 桥地址演进）已由 M08 PRD v1.18 §4.1.1 吸收；M09 侧以 §7.1.5 记录边界。

### 三、跨模块缺口提示（已按用户指示补录 M11，见下「四」）

1. **F-37 与 M11 PRD 冲突**：F-37 已落地「中心消费 `NetworkDomain.CenterEndpoint` 生成下载 URL（反代 / Host 推导降为 fallback）」，但 M11 PRD v0.7 §5.1 / §6.2 原写「`center_endpoint` 为 {v0.4+} 预留、当前不消费」「`config_download_url` 合成不依赖 `center_endpoint`」——文字与实现相反。**→ 已补录（2026-09-30，M11 PRD v0.7 → v0.8）**：`center_endpoint` 回归为优先消费，详见下「四」。
2. **F-26 / F-27 疑似 M11 PRD 缺口**：两 F 均属 M11 领域且已在代码落地，但 M11 PRD 未见对应条目。**→ 已补录（2026-09-30）**：网域详情「采集节点情况」区块、安装指引双分支 + Edge Sync Agent v0.2 口径，详见下「四」。

### 四、M11 侧补录执行结果（v0.7 → v0.8，2026-09-30）

承接上述跨模块缺口，按用户指示将三条补录追加进 `docs/02-product-requirements/Modules/Module_11_Edge_Access_and_Agent_Delivery.md`：

| 补录项 | 落点 | 处置 |
|---|---|---|
| F-37 `center_endpoint` 消费回归 | §5.1（所有者声明 + 字段行）/ §3.1 地址语义行 / §6.1 / §6.2 合成规则 / §9.2 / §10 | `center_endpoint` 由「不消费」**回归为优先消费**（优先取 `scheme://host`，空 / 非法回落 authority），与 agent `CENTER_ENDPOINT` 同源；**显式标注 v0.7 曾收敛为不消费、本版按 F-37 回归**（该字段口径的反复须留痕，防再次漂移） |
| F-26 网域详情抽屉 | §3.1 新增功能项行 / §11.3 / §9.1 | 新增独立「采集节点情况」区块（4 行，local 恒 `-`，纯前端信息补全） |
| F-27 安装指引双分支 | §3.1 新增功能项行 / §11.3 / §9.1 | 中心直连域「免部署可跳过」/ 采集节点域 4 步动线 + Edge Sync Agent {v0.2} 交付口径 |

> 注：F-37 的补录是**对 v0.7 修订的反转**（v0.7 曾据「实现未消费」把 PRD 收敛为 authority-only；F-37 又把实现改回消费）。本次以已落地的 F-37 实现为准回写，并在 §6.2 明文保留两次口径变更，供后续评审判断是否需固化决策。

### 五、M09 PRD 回写执行结果（v2.1 → v2.2）

- 已按上表将获准内容吸收进 `docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md`：头部版本 / 日期、Change Log、§3.1.1、§3.2.3、§5.2、§6.1、§6.2.2、新增 §7.1.5、§9.2、§10。
- **不在 design 分支新增 dev-feedback 条目**（按项目约定，`dev-feedback.md` 以 `feat/*` 为唯一权威写入点，本 worktree 的 `develop` / `design` 副本为只读镜像）。
- 本轮未新增 / 修改原型页面（§3.1.1「告警投递」变更对象、§6.1 `instance` 放行、`validation_message` 均为口径与字段层，原型已有承载位）。

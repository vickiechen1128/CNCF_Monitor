# 设计决策记录：module-08

## 会议/对齐信息

- 日期：2026-08-02
- 参与 Agent：prototype-designer、orchestrator
- 触发原因：基于现有 PRD 生成可点击原型并验证设计理解

## 关键决策

### 决策 1：原型风格与呈现方式

- 问题：原型采用何种视觉风格以便领导/业务方快速理解产品形态？
- 结论：采用火山引擎 Volcengine 设计 Token（主色 #0ECDEB、头部 #0B1B2A）作为原型风格，保持企业级云产品观感。
- 依据：用户需求 / 火山引擎品牌色参考
- 影响范围：docs/prototypes/module-08/ 全部页面

### 决策 2：模块原型独立拆分

- 问题：全模块统一原型还是按模块独立原型？
- 结论：按 prototype-designer 规范，每个模块产出独立的 Vite + React 原型项目，便于后续按模块评审、冻结与开发。
- 依据：`.kimi/agents/prototype-designer.md` 目录规则
- 影响范围：docs/prototypes/module-01/ ~ module-10/

### 决策 3：当前 PRD 范围确认

- 问题：当前 PRD 是否足以支撑原型验证？
- 结论：PRD v1.0 已覆盖本模块核心数据模型、页面与 MVP 边界，原型按 PRD 实现，未发现 [待验证] 技术缺口。
- 依据：docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md
- 影响范围：原型页面范围

## 待确认项

- [ ] 领导评审后对页面信息架构的反馈
- [ ] 是否需要针对 MVP 范围进一步裁剪页面字段

## 关联文档

- `docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md`
- `docs/prototypes/module-08/`

---

## 补充对齐：2026-08-15（M01/M08/M09 告警规则职责三轴重构）

- **参与 Agent**：用户、backend-developer
- **触发原因**：用户发现 M01「规则编辑」与 M08「告警规则管理」命名重叠、`MonitoringRule` 与 `AlertingRule`/`RecordingRule` 字段重复、M08 与 M09 均声明生成 `rules.yml`、入口不统一，确认按三轴重构边界。
- **关联模块**：Module_01、Module_08、Module_09、Module_02。

### 关键决策

#### 决策 4：M08 收缩为「告警收敛与通知管理」

- **问题**：M08 同时负责规则编辑 UI、规则生命周期管理、`rules.yml` 生成与 Alertmanager 配置，与 M01 规则内容创作、M09 配置唯一生成者冲突；用户原意是 M08 复用 Alertmanager 更适合做告警收敛、分发工作。
- **结论**：
  1. M08 模块名称由「告警规则管理」改为 **「告警收敛与通知管理」**；
  2. M08 只负责 **Alertmanager 域**：接收人/路由/静默/抑制/通知状态；不再负责规则内容创作、规则分组、`rules.yml` 生成与下发；
  3. 规则内容创作归 M01（`MonitoringRule` 单一权威记录），规则按网域分组生成 `rules.yml` 归 M09；
  4. `alertmanager.yml` 由 M08 直接写文件并触发 reload，MVP 单域阶段不进入 M09 配置变更确认流程（调整频繁、风险低）。
- **依据**：单一职责原则；M09 已是配置唯一生成者；M08 复用 Alertmanager 更适合收敛/分发；用户原意。
- **影响范围**：M08 PRD v1.3 全部重写；M01 PRD 5.5 / 1 / 3.2 / 6 边界表；M09 PRD 3.3 / 3.4 / 6.2 / 配置包结构；全局 Roadmap/术语映射/依赖文档链接。

### 已确认项

- [x] M08 收缩为「告警收敛与通知管理」，规则相关职责移交 M01/M09（用户确认）。
- [x] `alertmanager.yml` 由 M08 直写 reload，MVP 单域不进入 M09 审批（用户确认）。
- [x] M08 数据模型由 `AlertingRule`/`RuleGroup`/`RecordingRule` 改为 `Receiver`/`Route`/`Silence`/`InhibitionRule`/`AlertmanagerConfigVersion`（用户确认）。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（待原型验证）。
- [ ] v0.4+ 多网域边缘 Alertmanager 配置分发方式（由 M08 直接推还是随 M09 配置包下发）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`
- `docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md`
- `docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md`
- `docs/05-execution-records/module-01/design-decisions.md`（决策 3.57）
- `docs/05-execution-records/module-09/design-decisions.md`

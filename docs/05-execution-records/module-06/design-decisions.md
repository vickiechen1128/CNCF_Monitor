# 设计决策记录：module-06

## 会议/对齐信息

- 日期：2026-08-02
- 参与 Agent：prototype-designer、orchestrator
- 触发原因：基于现有 PRD 生成可点击原型并验证设计理解

## 关键决策

### 决策 1：原型风格与呈现方式

- 问题：原型采用何种视觉风格以便领导/业务方快速理解产品形态？
- 结论：采用火山引擎 Volcengine 设计 Token（主色 #0ECDEB、头部 #0B1B2A）作为原型风格，保持企业级云产品观感。
- 依据：用户需求 / 火山引擎品牌色参考
- 影响范围：docs/prototypes/module-06/ 全部页面

### 决策 2：模块原型独立拆分

- 问题：全模块统一原型还是按模块独立原型？
- 结论：按 prototype-designer 规范，每个模块产出独立的 Vite + React 原型项目，便于后续按模块评审、冻结与开发。
- 依据：`.kimi/agents/prototype-designer.md` 目录规则
- 影响范围：docs/prototypes/module-01/ ~ module-10/

### 决策 3：当前 PRD 范围确认

- 问题：当前 PRD 是否足以支撑原型验证？
- 结论：PRD v1.0 已覆盖本模块核心数据模型、页面与 MVP 边界，原型按 PRD 实现，未发现 [待验证] 技术缺口。
- 依据：docs/02-product-requirements/Modules/Module_06_Multi_Tenant.md
- 影响范围：原型页面范围

## 待确认项

- [ ] 领导评审后对页面信息架构的反馈
- [ ] 是否需要针对 MVP 范围进一步裁剪页面字段

## 关联文档

- `docs/02-product-requirements/Modules/Module_06_Multi_Tenant.md`
- `docs/prototypes/module-06/`

---

## 补充对齐：2026-08-15（M06 网域行政层与 M09 监控纳管层拆分）

- **参与 Agent**：prototype-designer
- **触发原因**：用户指出 M06「网域生命周期管理」与 M09「网域注册页」存在功能重叠，需明确职责边界。
- **关联模块**：Module_09、Module_01、Module_07。

### 关键决策

#### 决策 4：M06 作为 NetworkDomain 行政 Owner

- **问题**：M06 与 M09 各自应管理 `NetworkDomain` 的哪些字段和流程？
- **结论**：
  1. **M06 是网域的行政 Owner**：负责创建、编辑、禁用、删除网域，以及将网域分配给租户、设置配额。
  2. M06 网域创建/编辑表单只维护行政信息：`id`（可自动生成）、`name`、`tenant_id`、`status`；**不包含**监控参数（`agent_type`、`remote_write_url`、WAL 参数等）。
  3. `Tenant.network_domain_ids` 表示「该租户被授权可使用的网域列表」，但**不等于**这些网域都已接入监控；真正的「已纳管」状态由 M09 维护。
  4. `platform_admin` 租户拥有 `default` 管理域，系统预置且默认视为已存在；`default` 的监控纳管状态由 M09 特殊处理（中心 Prometheus 直接采集，不部署 Edge Agent）。
- **依据**：M06 是权限与平台管理模块，必须先确认租户对网域的拥有权；M09 是监控运维模块，只在用户有实际监控需求时执行纳管。
- **影响范围**：M06 PRD 3.1 / 5.1；网域创建/编辑页字段；租户详情页「被授权网域」展示。

#### 决策 5：租户内按网域授权的 RBAC 预留 {v1.0+}

- **问题**：用户提出「按不同域对人分权限管理」，是否把网域抬到租户之上？
- **结论**：
  1. **权限顶层仍是 Tenant**；网域不作为最高权限边界。
  2. v1.0+ 或外部 IAM 接入后，可在租户内角色策略中增加 `network_domain_id` scope，实现「某用户在医院 A 专网是 editor、在医院 B 专网是 viewer」。
  3. MVP / v0.2 阶段不做细粒度按域授权，仅保证租户级数据隔离。
- **依据**：M06 PRD 关键约束已明确「MetricCenter 不存在跨租户的全局平台管理员身份」。
- **影响范围**：M06 PRD 3.1 / 5.1；用户/角色权限设计（v1.0+）。

### 已确认项（2026-08-15）

- [x] M06 作为 `NetworkDomain` 行政 Owner，M09 作为监控纳管层（用户确认）。
- [x] 权限顶层仍是 Tenant，网域仅作为租户内二级授权维度（v1.0+）（用户确认）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_06_Multi_Tenant.md`
- `docs/05-execution-records/module-09/design-decisions.md`（决策 25/26/27/28，跨模块主记录）

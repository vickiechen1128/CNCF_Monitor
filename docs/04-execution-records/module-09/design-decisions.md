# 设计决策记录：module-09

## 会议/对齐信息

- 日期：2026-08-02
- 参与 Agent：prototype-designer、orchestrator
- 触发原因：基于现有 PRD 生成可点击原型并验证设计理解

## 关键决策

### 决策 1：原型风格与呈现方式

- 问题：原型采用何种视觉风格以便领导/业务方快速理解产品形态？
- 结论：采用火山引擎 Volcengine 设计 Token（主色 #0ECDEB、头部 #0B1B2A）作为原型风格，保持企业级云产品观感。
- 依据：用户需求 / 火山引擎品牌色参考
- 影响范围：docs/prototypes/module-09/ 全部页面

### 决策 2：模块原型独立拆分

- 问题：全模块统一原型还是按模块独立原型？
- 结论：按 prototype-designer 规范，每个模块产出独立的 Vite + React 原型项目，便于后续按模块评审、冻结与开发。
- 依据：`.kimi/agents/prototype-designer.md` 目录规则
- 影响范围：docs/prototypes/module-01/ ~ module-10/

### 决策 3：当前 PRD 范围确认

- 问题：当前 PRD 是否足以支撑原型验证？
- 结论：PRD v1.0 已覆盖本模块核心数据模型、页面与 MVP 边界，原型按 PRD 实现，未发现 [待验证] 技术缺口。
- 依据：docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md
- 影响范围：原型页面范围

## 待确认项

- [ ] 领导评审后对页面信息架构的反馈
- [ ] 是否需要针对 MVP 范围进一步裁剪页面字段

## 关联文档

- `docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md`
- `docs/prototypes/module-09/`

---

## 决策：网域模式与配置下发中心行为（2026-08-03）

### 背景

用户提出新需求：

- **单一网域用户**：在配置下发中心不应按网域划分管理，也不需要查看监控代理节点状态。
- **多网域用户**：需先配置不同网域，再接入各网域下的监控代理节点；完成后才能在资源管理、监控策略进行配置，并将配置下发到对应监控代理节点。

### 决策记录

| # | 决策 | 依据 | 影响范围 |
|---|------|------|----------|
| 1 | 网域生命周期与 Agent 管理归属 **Module_09** | `NetworkDomain` 数据模型唯一 Owner 为 Module_09；配置生成/预览/下发/Agent 接入均由本模块负责 | Module_09 PRD、数据模型、API |
| 2 | 单网域/多网域通过 `feature_flags.multi_site_enabled` 切换 | [02_Product_Roadmap.md](../../02-product-requirements/02_Product_Roadmap.md) 已定义该开关；避免对单机用户造成认知负担 | 前端菜单、后端权限、UI 渲染 |
| 3 | 单网域模式隐藏「网域管理」与「Agent 状态」入口 | 单网域场景无物理隔离 Edge Agent，网域与 Agent 状态页对用户无意义 | Module_09 前端页面、门户菜单 |
| 4 | 数据模型始终保留 `default` 网域 | 保证单网域与多网域切换时资源归属不中断，所有资源必须有 `network_domain_id` | `NetworkDomain` 模型、`Resource.network_domain_id` |
| 5 | 从单网域切换到多网域时，现有资源自动归属 `default` | `default` 作为初始网域，用户可后续迁移或保留作为中心直接采集域 | 迁移逻辑、后端初始化 |
| 6 | 配置下发中心在单网域模式下只面向中心 Prometheus | 不展示网域选择器、不展示多网域分发；确认后仅触发中心 `/-/reload` | 配置下发 UI、`ConfigDeployment.target_type` |
| 7 | 多网域模式下，配置下发中心按网域展示草稿/diff/下发记录 | 每个网域独立 `ConfigDraft` / `ConfigVersion` / `ConfigDeployment` | 配置下发 UI、配置包拉取 |
| 8 | 单网域模式下 Edge Sync Agent 协议接口不面向用户暴露 | **后端保留协议能力，仅 UI 隐藏**；便于单网域向多网域平滑扩展 | Edge Sync Agent API、鉴权、UI |

### 待确认项（已确认）

| 问题 | 决策 | 落地位置 |
|------|------|----------|
| `multi_site_enabled` 是平台级还是租户级开关？ | **租户级开关**，体现在 `Tenant.multi_site_enabled`；与“1 租户 : N 网域”上层设计关联更合理 | Module_06 `Tenant` 模型、Module_09 3.11 节 |
| 单网域模式下 Edge Sync Agent 协议如何处理？ | **后端保留协议能力，仅 UI 隐藏**；便于用户从单网域扩展到多网域时无需重新部署 Agent，符合产品交付“全套多网域、按需使用”的定位 | Module_09 3.11 节 |
| `default` 网域是否可编辑/删除？ | **允许修改 `name` / `description`** 以匹配用户云区域命名；**类型定义为 `management`（管理域），禁止删除** | Module_09 4.1 节 `domain_type` 字段 |
| Module_07 在单网域模式下是否隐藏「网域」列？ | **不隐藏**；网域即云区域，是从 CMDB/Excel 代入的必要字段 | Module_07 3.1、5.4 节 |

### 关联文档

- `docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md`
- `docs/02-product-requirements/Modules/Module_06_Multi_Tenant.md`
- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`

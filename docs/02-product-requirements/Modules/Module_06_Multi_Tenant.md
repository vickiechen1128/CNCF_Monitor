# Module 06: 系统与平台管理（含多租户）

> **模块类型**: 企业级能力模块  
> **依赖文档**: [00_Global_Architecture.md](../00_Global_Architecture.md)、[03_Functional_Architecture.md](../03_Functional_Architecture.md)、[Module_03_Gateway_and_Auth.md](Module_03_Gateway_and_Auth.md)  
> **目标用户**: 运维架构师、平台管理员  
> **版本**: v2.0  
> **更新日期**: 2026-07-20

---

## 1. 模块目标

提供 MetricCenter 平台级管理能力，包括租户/用户/角色生命周期、权限策略、审计日志展示与归档、平台全局策略、数据存储管理。网关层鉴权、请求级审计事件收集由 [Module_03](Module_03_Gateway_and_Auth.md) 负责。

> **MVP 阶段**：本模块不做。MetricCenter 在 MVP 阶段以单租户模式运行，所有资源与配置全局可见；时序存储直接使用 Prometheus TSDB，不做独立存储管理 UI。  
> **v1.0 阶段**：引入完整的多租户、权限、审计与平台配置能力。

---

## 2. 用户故事

- ARCH-01：创建和管理租户
- ARCH-05：管理用户权限与角色

---

## 3. 核心功能

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **多租户管理** | 创建、编辑、禁用租户 | P2 |
| **用户与权限** | 租户内用户增删改查、角色/权限策略分配 | P2 |
| **数据隔离** | 租户只能查看本租户数据 | P2 |
| **资源配额** | 限制租户的采集目标数、查询 QPS、存储时长 | P2 |
| **数据存储管理** | TSDB 状态查看、Retention、平台级 Remote Write 转发开关 | P2 |
| **审计日志** | 展示/归档关键操作、配置变更、登录日志；请求级审计事件由 Module_03 收集 | P2 |
| **平台配置** | 全局 scrape 策略限制、通知默认配置 | P2 |

---

### 3.1 租户与网域关系

- 1 个租户（Tenant）可以拥有 N 个网域（NetworkDomain）。
- 1 个网域通常只属于 1 个租户；全局共享网域可归属 `platform_admin` 租户。
- 示例：租户“卫健委”拥有“医院 A 专网”和“医院 B 专网”。

| 关系 | 说明 | 示例 |
|------|------|------|
| 1 租户 : N 网域 | 一个租户可管理多个隔离网域 | 卫健委 → 医院 A 专网、医院 B 专网 |
| 1 网域 : 1 租户 | 单个网域通常只归属一个租户 | 医院 A 专网 → 卫健委 |
| 全局网域 | `platform_admin` 租户可拥有全局共享网域 | `default` 默认网域 |

---

## 4. 隔离方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| 单实例 + tenant label | 成本低，部署简单 | 需要修改查询注入 label |
| 多实例隔离 | 完全隔离，安全性高 | 资源成本高，管理复杂 |

**建议第一版采用单实例 + tenant label 方案。**

在“单实例 + tenant label”方案下，查询需同时注入 `tenant` 与 `network_domain` 两个维度，确保租户只能看到其拥有的网域数据。

---

## 4.1 平台管理子能力

### 4.1.1 数据存储管理

| 功能 | 说明 |
|------|------|
| TSDB 状态查看 | 展示 Prometheus TSDB 状态（通过 `/api/v1/status/tsdb`），只读 |
| Retention 配置 | 设置数据保留周期 |
| Remote Write 转发开关 | 平台级开关：是否启用中心到长期存储的转发；具体 Edge Agent Remote Write 参数由 Module_09 负责，Ingestion Gateway 接收点由 Module_10 负责 |

### 4.1.2 审计日志

| 功能 | 说明 |
|------|------|
| 操作记录 | 记录资源、配置、规则的增删改查 |
| 变更追踪 | 展示配置 Diff 与操作人 |
| 登录日志 | 记录用户登录行为 |

### 4.1.3 平台配置

| 功能 | 说明 |
|------|------|
| 全局 scrape 策略限制 | 平台级最小/最大 `scrape_interval`、`scrape_timeout` 限制；具体 Job/模板默认值由 Module_01/07 定义 |
| 通知默认配置 | 默认接收人、告警模板 |

---

## 5. 数据模型

### 5.1 租户（Tenant）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | ✅ | 租户唯一标识 |
| name | string | ✅ | 租户展示名 |
| network_domain_ids | []string | ❌ | 该租户拥有的网域 ID 列表 |
| is_platform_admin | bool | ✅ | 是否为平台管理员租户，默认 `false` |
| status | enum | ✅ | active / suspended / disabled |
| created_at | datetime | ✅ | 创建时间 |
| updated_at | datetime | ✅ | 更新时间 |

---

## 6. 依赖

- `platform/gateway/tenant/`
- `platform/gateway/auth/`
- `platform/models/`
- [Module 03: 网关与认证](Module_03_Gateway_and_Auth.md)

---

## 7. 验收标准

- [ ] 租户 A 用户只能看到本租户的目标和指标
- [ ] 平台管理员可以管理所有租户
- [ ] 支持租户内用户角色分配
- [ ] 关键操作记录审计日志
- [ ] 可查看 TSDB 状态与 Retention 配置
- [ ] 可配置 Remote Write 转发目标
- [ ] 可维护平台全局 scrape 默认值
- [ ] 1 个租户可关联多个网域，1 个网域默认只归属 1 个租户
- [ ] 平台管理员租户可管理所有网域

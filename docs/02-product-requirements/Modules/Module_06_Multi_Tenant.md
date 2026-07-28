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

## 4. 隔离方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| 单实例 + tenant label | 成本低，部署简单 | 需要修改查询注入 label |
| 多实例隔离 | 完全隔离，安全性高 | 资源成本高，管理复杂 |

**建议第一版采用单实例 + tenant label 方案。**

---

## 5. 平台管理子能力

### 5.1 数据存储管理

| 功能 | 说明 |
|------|------|
| TSDB 状态查看 | 展示 Prometheus TSDB 状态（通过 `/api/v1/status/tsdb`），只读 |
| Retention 配置 | 设置数据保留周期 |
| Remote Write 转发开关 | 平台级开关：是否启用中心到长期存储的转发；具体 Edge Agent Remote Write 参数由 Module_09 负责，Ingestion Gateway 接收点由 Module_10 负责 |

### 5.2 审计日志

| 功能 | 说明 |
|------|------|
| 操作记录 | 记录资源、配置、规则的增删改查 |
| 变更追踪 | 展示配置 Diff 与操作人 |
| 登录日志 | 记录用户登录行为 |

### 5.3 平台配置

| 功能 | 说明 |
|------|------|
| 全局 scrape 策略限制 | 平台级最小/最大 `scrape_interval`、`scrape_timeout` 限制；具体 Job/模板默认值由 Module_01/07 定义 |
| 通知默认配置 | 默认接收人、告警模板 |

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

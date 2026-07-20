# Module 03: 网关与认证

> **模块类型**: 基础设施模块  
> **依赖文档**: [00_Global_Architecture.md](../00_Global_Architecture.md)、[03_Functional_Architecture.md](../03_Functional_Architecture.md)  
> **目标用户**: 运维架构师、所有平台用户  
> **版本**: v2.0  
> **更新日期**: 2026-07-20

---

## 1. 模块目标

作为 MetricCenter 的统一入口，提供 API 路由、查询代理、配置管理 API 转发能力。

MVP 阶段**不实现完整认证鉴权与多租户隔离**，仅作为请求入口和代理层，便于快速验证业务链路。认证与多租户在 v1.0 阶段补齐。

> **与 Module 08 的边界**：告警状态查询 `/api/v1/alerts` 由 Gateway 代理到 Prometheus；功能 Owner 为 [Module 08: 告警规则管理](Module_08_Alerting_Rule_Management.md)。

---

## 2. 用户故事

- OPS-03：通过统一入口执行 PromQL 查询
- OPS-08：通过统一入口管理采集配置
- ARCH-01：未来需要支持多租户（v1.0）
- ARCH-05：未来需要管理用户权限与角色（v1.0）

---

## 3. 核心功能

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 统一入口 | 所有请求通过 Gateway 进入 | P0 |
| 查询代理 | 将查询请求转发到 Prometheus，统一返回格式 | P0 |
| 配置管理 API 路由 | 将配置相关请求路由到 `platform/config/` | P0 |
| 认证鉴权 | 支持 Token / Session / SSO | P2（MVP 不做） |
| 多租户路由 | 根据租户身份路由或注入 tenant label | P2（MVP 不做） |
| 审计日志 | 记录关键操作与查询 | P2（MVP 不做） |

---

## 4. 权限模型（v1.0 阶段）

| 角色 | 权限 |
|------|------|
| platform_admin | 管理租户、用户、全局配置 |
| tenant_admin | 管理租户内用户、发现源、采集目标 |
| operator | 查看目标、执行查询、配置告警 |
| viewer | 只读访问指标与看板 |

---

## 5. 依赖

- `platform/gateway/`
- `platform/models/`

---

## 6. 验收标准

- [ ] 所有前端请求通过 Gateway 统一入口
- [ ] 查询请求正确代理到 Prometheus
- [ ] 配置管理 API 正确路由到 `platform/config/`
- [ ] MVP 阶段允许无认证访问（开发期便利，生产环境需前置 Nginx/Basic Auth）

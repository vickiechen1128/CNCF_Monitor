# Module 07 v3 安全审查（B6-3）

> **结论**：PASS（带遗留风险，已登记）
> **审查范围**：v3 resource / dictionary / label / import handler、domain 校验、migration、references adapter
> **审查方式**：代码审查 + 自动化测试（`go test -race`）

---

## 1. 鉴权与越权

| 检查 | 结论 |
|---|---|
| v3 路由是否挂全局认证 | ✅ `main.go` 在 `r.Use(auth.AuthMiddleware(...))` 之后挂 `/api/v3/platform/*` |
| v3 是否被加入 PublicPathPrefixes | ✅ 未加入；仅 v2 edge / webhook 豁免 |
| 资源写接口是否需要登录 | ✅ 继承全局认证 |
| 字典 / app-platform-rel 写接口是否需要登录 | ✅ 继承全局认证 |
| 是否要求管理员 | ⚠️ 未额外挂 `RequireAdmin`，与 v2 资源/字典写接口口径一致；如产品要求管理员专属，后续加中间件 |
| 跨租户隔离 | ⚠️ v3 查询目前未按 `tenant_id` 过滤（MVP 单租户）；多租户前必须补 |

**结论**：无未鉴权写接口；管理员粒度与租户隔离为已知遗留。

---

## 2. 凭证与敏感信息

| 检查 | 结论 |
|---|---|
| `connection_string` 是否落明文 | ✅ v3 domain/repository 使用 `connection_secret_ref`，不存明文 |
| API 是否回显 secret | ✅ 响应只含 `connection_secret_ref`（引用），不含明文 |
| 日志是否打印 secret | ✅ 未发现 |
| secret ref 解析 / 加密 | ⚠️ 尚未实现；当前仅保存引用，后续接 secret store 或 AES-GCM |
| `NotifyChannel` 等旧模块凭证 | 非 M07 v3 范围；沿用旧模块脱敏口径 |

**结论**：v3 已移除明文连接串；secret ref 解析为后续任务。

---

## 3. SSRF / URL 校验

| 检查 | 结论 |
|---|---|
| `health_check_url` | ✅ domain 校验 scheme ∈ http/https/tcp，host 非空 |
| `api_url` | ✅ domain 校验 scheme ∈ http/https，host 非空 |
| `instance_ip` | ✅ host/database/middleware 要求 IPv4；generic_target 允许域名 |
| 导入 URL | ✅ 走同一 domain 校验 |
| DNS rebinding / 内网地址 | ⚠️ 未做 allowlist / 私网地址拦截；由 M01 生成侧与部署网络策略兜底 |

**结论**：基础 scheme/host 校验通过；allowlist 为遗留。

---

## 4. 上传与导入

| 检查 | 结论 |
|---|---|
| 文件大小 | ✅ 10MB 上限 |
| 文件扩展名 | ✅ 仅 `.xlsx` |
| 解析器 | ✅ excelize；无宏执行 |
| 路径穿越 | ✅ 不落盘，仅内存解析 |
| 行级错误 | ✅ 返回结构化错误，不泄露内部路径 |
| MIME sniffing | ⚠️ 未校验 Content-Type / 文件魔数；excelize 解析失败会拒绝 |

**结论**：上传面可控；MIME 校验为低风险遗留。

---

## 5. SQL / 注入

| 检查 | 结论 |
|---|---|
| GORM 参数化 | ✅ 所有 where 条件使用参数 |
| keyword LIKE | ✅ 参数化 |
| 动态列名 | ✅ 仅固定 category switch，无用户输入拼列 |
| 原始 SQL | ✅ v3 代码无用户输入拼接 SQL |

**结论**：未发现注入风险。

---

## 6. 标签策略

| 检查 | 结论 |
|---|---|
| key 规则 | ✅ 小写字母/数字/下划线、禁止 `__`、禁止内置 key |
| 写边界 | ✅ 仅 application / interface_service |
| 唯一索引 | ✅ `(resource_id,key,source)` 部分唯一 |
| 软删后重加 | ✅ 部分唯一索引允许 |
| system 标签落库 | ✅ 不落库（由生成侧计算） |

**结论**：通过。

---

## 7. 审计与可观测性

| 检查 | 结论 |
|---|---|
| `resource_audit_logs` 表 | ✅ v3 schema 已建 |
| 写链路 | ⚠️ 尚未接入 create/update/delete/import |
| 导入 operator | ✅ 从认证上下文取 `auth.CurrentUsername`，缺失回落 `platform_admin` |
| 结构化日志 | ⚠️ 未统一加 `resource_id` / `operation` 字段 |

**结论**：审计表已就绪，写链路为 B6 遗留。

---

## 8. 测试证据

```bash
GOPROXY=off go test -race ./platform/modules/m07/...   # 通过
GOPROXY=off go vet ./platform/modules/m07/...          # 通过
```

并发判重、事务回滚、唯一索引、软删、标签唯一、导入边界均有测试。

---

## 9. 遗留风险清单

| # | 风险 | 级别 | 处置 |
|---|---|---|---|
| S-1 | v3 未按 `tenant_id` 过滤 | 中（多租户前必须修） | 多租户阶段补 repository scope |
| S-2 | 字典写接口未要求 admin | 低（与 v2 一致） | 产品确认后加 `RequireAdmin` |
| S-3 | `connection_secret_ref` 解析/加密未实现 | 中 | B6 后续或部署前补 secret store |
| S-4 | URL 无 allowlist / 私网拦截 | 中 | 生成侧/部署网络策略兜底，后续加 allowlist |
| S-5 | 上传未校验 MIME/魔数 | 低 | 可加 `http.DetectContentType` |
| S-6 | 审计写链路未接 | 中 | B6 后续补 `resource_audit_logs` |
| S-7 | PG 集成测试未在本机执行 | 中 | CI / 本地设 `METRIC_CENTER_TEST_POSTGRES_DSN` |

**审查结论**：PASS；S-1 / S-3 / S-6 为 handover 前应关闭项，其余可登记为后续。
